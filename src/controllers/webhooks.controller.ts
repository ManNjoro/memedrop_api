import type { Request, Response } from 'express';
import { Webhook } from 'svix';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { ApiError } from '../middleware/errorHandler.js';

type ClerkUserPayload = {
  id: string;
  username: string | null;
  image_url: string | null;
};

/**
 * POST /api/webhooks/clerk
 * Configure this URL in Clerk Dashboard > Webhooks, subscribed to
 * user.created / user.updated / user.deleted. This is how the `users`
 * table in Neon stays in sync with Clerk without the mobile app ever
 * needing to tell our API "hey, I just signed up."
 *
 * Requires the raw request body (see app.ts) — svix signs the exact bytes
 * Clerk sent, so a body already parsed to JSON and re-stringified won't
 * verify.
 */
export async function handleClerkWebhook(req: Request, res: Response) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) throw new ApiError(500, 'CLERK_WEBHOOK_SIGNING_SECRET is not configured.');

  const svixId = req.header('svix-id');
  const svixTimestamp = req.header('svix-timestamp');
  const svixSignature = req.header('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new ApiError(400, 'Missing svix headers.');
  }

  const wh = new Webhook(signingSecret);
  let event: { type: string; data: ClerkUserPayload };
  try {
    event = wh.verify(req.body as Buffer, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as typeof event;
  } catch {
    throw new ApiError(400, 'Webhook signature verification failed.');
  }

  switch (event.type) {
    case 'user.created':
    case 'user.updated': {
      const { id, username, image_url } = event.data;
      if (!username) break; // shouldn't happen since sign-up requires a username, but guard anyway
      await db
        .insert(users)
        .values({ id, username, avatarUrl: image_url })
        .onConflictDoUpdate({
          target: users.id,
          set: { username, avatarUrl: image_url, updatedAt: new Date() },
        });
      break;
    }
    case 'user.deleted': {
      const { id } = event.data;
      if (id) await db.delete(users).where(eq(users.id, id));
      break;
    }
  }

  res.status(200).json({ received: true });
}