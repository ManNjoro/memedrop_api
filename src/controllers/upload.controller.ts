import type { Request, Response } from 'express';
import { cloudinary } from '../lib/cloudinary.js';
import { currentUserId } from '../middleware/requireAuth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { logger } from '../logger/logger.js';

/**
 * POST /api/upload/signature
 * body: { mediaType: 'image' | 'video' }
 *
 * Returns everything the client needs to POST the file straight to
 * Cloudinary's upload API (no file bytes ever touch this server, which
 * matters on Vercel's request body size limits). The signature commits the
 * client to the exact params we signed here — folder and public_id can't be
 * tampered with client-side, since any change invalidates the signature.
 */
export async function createUploadSignature(req: Request, res: Response) {
  const { mediaType } = req.body as { mediaType: 'image' | 'video' };
  const userId = currentUserId(req);

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `memedrop/${mediaType}s`;
  const publicId = `${userId}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

  // Only params that affect the signature go here. Anything the client sends
  // to Cloudinary outside of this set (api_key, file, resource_type, and the
  // signature/timestamp themselves) doesn't need to be signed.
  const paramsToSign = {
    timestamp,
    folder,
    public_id: publicId,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET!
  );

  res.json({
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    folder,
    publicId,
    resourceType: mediaType === 'video' ? 'video' : 'image',
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${
      mediaType === 'video' ? 'video' : 'image'
    }/upload`,
  });
}

/**
 * POST /api/upload/cleanup
 * body: { publicId: string, mediaType: 'image' | 'video' }
 *
 * Best-effort cleanup for the gap between "file landed on Cloudinary" and
 * "POST /api/memes saved it to Neon" — if the second step fails (network
 * drop, expired auth token, server error, etc.), the client calls this to
 * delete the now-orphaned Cloudinary asset rather than leaving it billed
 * against storage with nothing in the app ever pointing to it.
 *
 * publicId always starts with the uploader's Clerk user id (see
 * createUploadSignature above) — checking that prefix here is a cheap
 * defense against one user cleaning up (or being tricked into deleting)
 * another user's asset, without needing a database lookup.
 */
export async function cleanupUpload(req: Request, res: Response) {
  const { publicId, mediaType } = req.body as { publicId: string; mediaType: 'image' | 'video' };
  const userId = currentUserId(req);

  if (!publicId.startsWith(`${userId}-`)) {
    throw new ApiError(403, 'You can only clean up your own uploads.');
  }

  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: mediaType === 'video' ? 'video' : 'image',
    });
  } catch (err) {
    // Don't fail the request over this — it's best-effort. Worst case, an
    // orphaned asset sits in Cloudinary until a future reconciliation pass.
    logger.error(`Failed to clean up orphaned Cloudinary asset ${publicId}: ${err}`);
  }

  res.status(204).send();
}