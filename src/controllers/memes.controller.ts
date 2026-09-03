import type { Request, Response } from 'express';
import { and, or, desc, asc, eq, ilike, sql, lt, gt } from 'drizzle-orm';
import { getAuth } from '@clerk/express';
import { db } from '../db/index.js';
import { memes, tags, memeTags, users, likes, savedMemes } from '../db/schema.js';
import { currentUserId } from '../middleware/requireAuth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { cloudinary } from '../lib/cloudinary.js';
import type { CreateMemeInput, MemeQuery } from '../validators/memes.validators.js';

/**
 * Opaque pagination cursor. Carries both the value of whatever column the
 * current sort orders by (createdAt for newest/oldest, likesCount for
 * most_popular, downloadsCount for most_downloaded) AND the row's id as a
 * tiebreaker — a single-column cursor isn't enough once many rows can tie
 * on the same likesCount/downloadsCount value (extremely common early on,
 * when most memes sit at 0), since SQL gives no stable ordering guarantee
 * across ties without a unique secondary sort key.
 */
type CursorPayload = { value: string; id: string };

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed?.value === 'string' && typeof parsed?.id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * POST /api/memes
 * Called after the client has already uploaded the file directly to
 * Cloudinary using a signature from POST /api/upload/signature. This just
 * persists the resulting metadata to Neon.
 */
export async function createMeme(req: Request, res: Response) {
  const input = req.body as CreateMemeInput;
  const uploaderId = currentUserId(req);

  const meme = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(memes)
      .values({
        uploaderId,
        title: input.title,
        description: input.description,
        mediaType: input.mediaType,
        cloudinaryPublicId: input.cloudinaryPublicId,
        mediaUrl: input.mediaUrl,
        thumbnailUrl: input.thumbnailUrl,
        durationSec: input.durationSec,
        width: input.width,
        height: input.height,
      })
      .returning();

    if (input.tags.length > 0) {
      const cleanTags = [...new Set(input.tags.map((t) => t.toLowerCase().replace(/^#/, '')))];

      for (const name of cleanTags) {
        const [tag] = await tx
          .insert(tags)
          .values({ name })
          .onConflictDoNothing({ target: tags.name })
          .returning();

        const tagId = tag?.id ?? (await tx.query.tags.findFirst({ where: eq(tags.name, name) }))!.id;
        await tx.insert(memeTags).values({ memeId: created.id, tagId }).onConflictDoNothing();
      }
    }

    return created;
  });

  res.status(201).json(meme);
}

/**
 * GET /api/memes
 * Powers Home, Explore's "Trending now", and Search Results.
 * q + mediaType + sort + cursor-based pagination.
 */
export async function listMemes(req: Request, res: Response) {
  const { q, mediaType, sort, cursor, limit } = req.query as unknown as MemeQuery;

  const conditions = [];
  if (mediaType) conditions.push(eq(memes.mediaType, mediaType));
  if (q) {
    // Matches title, or any tag the meme has, via a correlated subquery.
    conditions.push(
      sql`(${ilike(memes.title, `%${q}%`)} OR EXISTS (
        SELECT 1 FROM ${memeTags}
        JOIN ${tags} ON ${tags.id} = ${memeTags.tagId}
        WHERE ${memeTags.memeId} = ${memes.id} AND ${tags.name} ILIKE ${`%${q}%`}
      ))`
    );
  }

  const sortColumn =
    sort === 'most_downloaded' ? memes.downloadsCount :
    sort === 'most_popular' ? memes.likesCount :
    memes.createdAt;
  // Every mode except "oldest" sorts descending — including most_popular
  // and most_downloaded, which both want the highest counts first.
  const sortDir = sort === 'oldest' ? asc : desc;
  const isNumericSort = sort === 'most_popular' || sort === 'most_downloaded';

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      const cursorValue = isNumericSort ? Number(decoded.value) : new Date(decoded.value);
      // Tuple comparison (sortColumn, id) vs (cursorValue, cursor.id), matching
      // the ORDER BY below exactly — this is what makes pagination advance
      // correctly even when many rows share the same sortColumn value.
      conditions.push(
        sort === 'oldest'
          ? or(gt(sortColumn, cursorValue as never), and(eq(sortColumn, cursorValue as never), gt(memes.id, decoded.id)))
          : or(lt(sortColumn, cursorValue as never), and(eq(sortColumn, cursorValue as never), lt(memes.id, decoded.id)))
      );
    }
  }

  const results = await db
    .select({
      id: memes.id,
      title: memes.title,
      mediaType: memes.mediaType,
      mediaUrl: memes.mediaUrl,
      thumbnailUrl: memes.thumbnailUrl,
      durationSec: memes.durationSec,
      width: memes.width,
      height: memes.height,
      downloadsCount: memes.downloadsCount,
      likesCount: memes.likesCount,
      viewsCount: memes.viewsCount,
      createdAt: memes.createdAt,
      uploaderId: users.id,
      uploaderUsername: users.username,
      uploaderAvatarUrl: users.avatarUrl,
    })
    .from(memes)
    .innerJoin(users, eq(memes.uploaderId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    // id as a secondary sort key is required, not cosmetic — it's what
    // gives ties a stable, deterministic order that the cursor's tuple
    // comparison above can actually rely on.
    .orderBy(sortDir(sortColumn), sortDir(memes.id))
    .limit(limit);

  const last = results[results.length - 1];
  const nextCursor =
    results.length === limit && last
      ? encodeCursor({
          value: isNumericSort
            ? String(sort === 'most_popular' ? last.likesCount : last.downloadsCount)
            : last.createdAt.toISOString(),
          id: last.id,
        })
      : null;

  res.json({ memes: results, nextCursor });
}

/**
 * GET /api/memes/:id
 * Public — but clerkMiddleware() still populates req.auth when a valid
 * token is present even on routes that don't require it, so a signed-in
 * viewer gets isLiked/isSaved back too (for a filled vs. outline heart/
 * bookmark), while an anonymous viewer just gets false for both.
 */
export async function getMeme(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const viewerId = getAuth(req).userId ?? null;

  const meme = await db.query.memes.findFirst({
    where: eq(memes.id, id),
    with: {
      uploader: { columns: { id: true, username: true, avatarUrl: true } },
      memeTags: { with: { tag: { columns: { name: true } } } },
    },
  });

  if (!meme) throw new ApiError(404, 'Meme not found.');

  let isLiked = false;
  let isSaved = false;
  if (viewerId) {
    const [likeRow, savedRow] = await Promise.all([
      db.query.likes.findFirst({ where: and(eq(likes.memeId, id), eq(likes.userId, viewerId)) }),
      db.query.savedMemes.findFirst({ where: and(eq(savedMemes.memeId, id), eq(savedMemes.userId, viewerId)) }),
    ]);
    isLiked = !!likeRow;
    isSaved = !!savedRow;
  }

  res.json({
    ...meme,
    tags: meme.memeTags.map((mt) => mt.tag.name),
    memeTags: undefined,
    isLiked,
    isSaved,
  });
}

/** POST /api/memes/:id/download — fire-and-forget counter increment, no auth required. */
export async function recordDownload(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const [updated] = await db
    .update(memes)
    .set({ downloadsCount: sql`${memes.downloadsCount} + 1` })
    .where(eq(memes.id, id))
    .returning({ downloadsCount: memes.downloadsCount });

  if (!updated) throw new ApiError(404, 'Meme not found.');
  res.json({ downloadsCount: updated.downloadsCount });
}

/**
 * POST /api/memes/:id/view — fire-and-forget counter increment, no auth
 * required. Intentionally simple (one increment per call, no dedup) to
 * match the same pattern as downloads — a person refreshing the same meme
 * a few times inflating the count by a handful is an acceptable trade-off
 * for an MVP. If that becomes a real problem later, the fix is a `views`
 * table keyed by (memeId, viewerId or device id, day) so repeats within a
 * window don't double-count — not necessary to build until it's needed.
 */
export async function recordView(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const [updated] = await db
    .update(memes)
    .set({ viewsCount: sql`${memes.viewsCount} + 1` })
    .where(eq(memes.id, id))
    .returning({ viewsCount: memes.viewsCount });

  if (!updated) throw new ApiError(404, 'Meme not found.');
  res.json({ viewsCount: updated.viewsCount });
}

/**
 * POST /api/memes/:id/like — auth required. Idempotent: liking an
 * already-liked meme is a no-op rather than an error, so the client can
 * always just call this on tap without checking state first.
 */
export async function likeMeme(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const userId = currentUserId(req);

  const meme = await db.query.memes.findFirst({ where: eq(memes.id, id), columns: { id: true } });
  if (!meme) throw new ApiError(404, 'Meme not found.');

  const likesCount = await db.transaction(async (tx) => {
    const inserted = await tx.insert(likes).values({ userId, memeId: id }).onConflictDoNothing().returning();
    if (inserted.length > 0) {
      await tx.update(memes).set({ likesCount: sql`${memes.likesCount} + 1` }).where(eq(memes.id, id));
    }
    const [row] = await tx.select({ likesCount: memes.likesCount }).from(memes).where(eq(memes.id, id));
    return row.likesCount;
  });

  res.json({ liked: true, likesCount });
}

/** DELETE /api/memes/:id/like — auth required. Idempotent, mirrors likeMeme. */
export async function unlikeMeme(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const userId = currentUserId(req);

  const likesCount = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(likes)
      .where(and(eq(likes.memeId, id), eq(likes.userId, userId)))
      .returning();
    if (deleted.length > 0) {
      // GREATEST(...) guards against ever going negative if counts ever
      // drift out of sync with the likes table for any reason.
      await tx
        .update(memes)
        .set({ likesCount: sql`GREATEST(${memes.likesCount} - 1, 0)` })
        .where(eq(memes.id, id));
    }
    const [row] = await tx.select({ likesCount: memes.likesCount }).from(memes).where(eq(memes.id, id));
    return row?.likesCount ?? 0;
  });

  res.json({ liked: false, likesCount });
}

/** POST /api/memes/:id/save — auth required, idempotent. No counter to maintain; saves are private to each viewer. */
export async function saveMeme(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const userId = currentUserId(req);

  const meme = await db.query.memes.findFirst({ where: eq(memes.id, id), columns: { id: true } });
  if (!meme) throw new ApiError(404, 'Meme not found.');

  await db.insert(savedMemes).values({ userId, memeId: id }).onConflictDoNothing();
  res.json({ saved: true });
}

/** DELETE /api/memes/:id/save — auth required, idempotent. */
export async function unsaveMeme(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const userId = currentUserId(req);

  await db.delete(savedMemes).where(and(eq(savedMemes.memeId, id), eq(savedMemes.userId, userId)));
  res.json({ saved: false });
}

/**
 * GET /api/saved — auth required. Returns the signed-in viewer's saved
 * memes in the same flattened shape as GET /api/memes, so the mobile app's
 * existing toCardMeme() mapper works unchanged for the Saved tab.
 */
export async function listSavedMemes(req: Request, res: Response) {
  const userId = currentUserId(req);

  const results = await db
    .select({
      id: memes.id,
      title: memes.title,
      mediaType: memes.mediaType,
      mediaUrl: memes.mediaUrl,
      thumbnailUrl: memes.thumbnailUrl,
      durationSec: memes.durationSec,
      width: memes.width,
      height: memes.height,
      downloadsCount: memes.downloadsCount,
      likesCount: memes.likesCount,
      viewsCount: memes.viewsCount,
      createdAt: memes.createdAt,
      uploaderId: users.id,
      uploaderUsername: users.username,
      uploaderAvatarUrl: users.avatarUrl,
    })
    .from(savedMemes)
    .innerJoin(memes, eq(savedMemes.memeId, memes.id))
    .innerJoin(users, eq(memes.uploaderId, users.id))
    .where(eq(savedMemes.userId, userId))
    .orderBy(desc(savedMemes.savedAt));

  res.json({ memes: results });
}

/**
 * DELETE /api/memes/:id
 * Only the uploader can delete their own meme. Removes the asset from
 * Cloudinary first, then the row from Neon — memeTags and savedMemes rows
 * for it are cleaned up automatically via ON DELETE CASCADE in the schema.
 */
export async function deleteMeme(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;
  const userId = currentUserId(req);

  const meme = await db.query.memes.findFirst({ where: eq(memes.id, id) });
  if (!meme) throw new ApiError(404, 'Meme not found.');
  if (meme.uploaderId !== userId) throw new ApiError(403, 'You can only delete your own memes.');

  try {
    await cloudinary.uploader.destroy(meme.cloudinaryPublicId, {
      resource_type: meme.mediaType === 'video' ? 'video' : 'image',
    });
  } catch (err) {
    // Don't let a Cloudinary hiccup block deletion — an orphaned Cloudinary
    // asset is a much smaller problem than a meme the user can't remove.
    console.error(`Failed to delete Cloudinary asset ${meme.cloudinaryPublicId}:`, err);
  }

  await db.delete(memes).where(eq(memes.id, id));

  res.status(204).send();
}