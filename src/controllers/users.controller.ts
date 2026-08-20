import type { Request, Response } from 'express';
import { eq, desc, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, memes } from '../db/schema.js';
import { ApiError } from '../middleware/errorHandler.js';

/** GET /api/users/:username — public profile info only, no email/private data. */
export async function getUserProfile(req: Request<{ username: string }>, res: Response) {
  const { username } = req.params;

  const user = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (!user) throw new ApiError(404, 'User not found.');

  const [{ memeCount }] = await db
    .select({ memeCount: count() })
    .from(memes)
    .where(eq(memes.uploaderId, user.id));

  res.json({
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    memeCount,
  });
}

/** GET /api/users/:username/memes — grid for both own profile and public creator profile. */
export async function getUserMemes(req: Request<{ username: string }>, res: Response) {
  const { username } = req.params;

  const user = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (!user) throw new ApiError(404, 'User not found.');

  const results = await db
    .select()
    .from(memes)
    .where(eq(memes.uploaderId, user.id))
    .orderBy(desc(memes.createdAt));

  res.json({ memes: results });
}