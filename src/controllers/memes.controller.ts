import type { Request, Response } from 'express';
import { and, desc, asc, eq, ilike, sql, lt, gt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memes, tags, memeTags, users } from '../db/schema.js';
import { currentUserId } from '../middleware/requireAuth.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { CreateMemeInput, MemeQuery } from '../validators/memes.validators.js';

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

export async function listMemes(req: Request, res: Response) {
  const { q, mediaType, sort, cursor, limit } = req.query as unknown as MemeQuery;

  const conditions = [];
  if (mediaType) conditions.push(eq(memes.mediaType, mediaType));
  if (q) {
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