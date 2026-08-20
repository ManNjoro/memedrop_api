import type { Request, Response } from 'express';
import { cloudinary } from '../lib/cloudinary.js';
import { currentUserId } from '../middleware/requireAuth.js';

export async function createUploadSignature(req: Request, res: Response) {
  const { mediaType } = req.body as { mediaType: 'image' | 'video' };
  const userId = currentUserId(req);

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `memedrop/${mediaType}s`;
  const publicId = `${userId}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

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