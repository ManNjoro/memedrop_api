import type { Request, Response } from 'express';
import { eq, desc, count } from 'drizzle-orm';
import { clerkClient } from '@clerk/express';
import { db } from '../db/index.js';
import { users, memes } from '../db/schema.js';
import { ApiError } from '../middleware/errorHandler.js';
import { currentUserId } from '../middleware/requireAuth.js';

/**
 * POST /api/users/sync
 * Upserts the authenticated user's row into Neon from their live Clerk
 * record. The Clerk webhook (user.created) does this too, but webhooks are
 * asynchronous and can lag a few hundred ms to a few seconds behind — long
 * enough for a just-signed-up user to hit their own Profile tab before the
 * row exists. Calling this right after signUp.finalize() closes that gap;
 * the webhook remains the source of truth for updates made outside the app
 * (e.g. changing username in the Clerk-hosted account portal).
 */
export async function syncCurrentUser(req: Request, res: Response) {
  const userId = currentUserId(req);
  const clerkUser = await clerkClient.users.getUser(userId);

  if (!clerkUser.username) {
    throw new ApiError(400, 'This account has no username set yet.');
  }

  const [user] = await db
    .insert(users)
    .values({ id: userId, username: clerkUser.username, avatarUrl: clerkUser.imageUrl })
    .onConflictDoUpdate({
      target: users.id,
      set: { username: clerkUser.username, avatarUrl: clerkUser.imageUrl, updatedAt: new Date() },
    })
    .returning();

  res.json(user);
}

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