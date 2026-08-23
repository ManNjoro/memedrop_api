// src/controllers/memes.controller.ts
import type { Request, Response } from 'express';
import { and, desc, asc, eq, ilike, sql, lt, gt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memes, tags, memeTags, users } from '../db/schema.js';
import { currentUserId } from '../middleware/requireAuth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { cloudinary } from '../lib/cloudinary.js';
import type { CreateMemeInput, MemeQuery } from '../validators/memes.validators.js';

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
  const sortDir = sort === 'oldest' ? asc : desc;

  if (cursor && (sort === 'newest' || sort === 'oldest')) {
    conditions.push(sort === 'oldest' ? gt(memes.createdAt, new Date(cursor)) : lt(memes.createdAt, new Date(cursor)));
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
      createdAt: memes.createdAt,
      uploaderId: users.id,
      uploaderUsername: users.username,
      uploaderAvatarUrl: users.avatarUrl,
    })
    .from(memes)
    .innerJoin(users, eq(memes.uploaderId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sortDir(sortColumn))
    .limit(limit);

  const nextCursor = results.length === limit ? results[results.length - 1].createdAt.toISOString() : null;

  res.json({ memes: results, nextCursor });
}

/** GET /api/memes/:id */
export async function getMeme(req: Request<{ id: string }>, res: Response) {
  const { id } = req.params;

  const meme = await db.query.memes.findFirst({
    where: eq(memes.id, id),
    with: {
      uploader: { columns: { id: true, username: true, avatarUrl: true } },
      memeTags: { with: { tag: { columns: { name: true } } } },
    },
  });

  if (!meme) throw new ApiError(404, 'Meme not found.');

  res.json({
    ...meme,
    tags: meme.memeTags.map((mt) => mt.tag.name),
    memeTags: undefined,
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