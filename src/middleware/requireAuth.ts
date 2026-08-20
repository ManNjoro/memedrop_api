import type { Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth.isAuthenticated || !auth.userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

/** Convenience accessor for the authenticated user's Clerk id inside a route handler. */
export function currentUserId(req: Request): string {
  const auth = getAuth(req);
  if (!auth.userId) throw new Error('currentUserId() called on an unauthenticated request');
  return auth.userId;
}