import { z } from 'zod';

export const uploadSignatureSchema = z.object({
  mediaType: z.enum(['image', 'video']),
});

export const cleanupUploadSchema = z.object({
  publicId: z.string().min(1),
  mediaType: z.enum(['image', 'video']),
});

export const createMemeSchema = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(280).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(8).optional().default([]),
  mediaType: z.enum(['image', 'video']),
  cloudinaryPublicId: z.string().min(1),
  mediaUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  durationSec: z.number().int().positive().max(60).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const memeQuerySchema = z.object({
  q: z.string().trim().optional(),
  mediaType: z.enum(['image', 'video']).optional(),
  sort: z.enum(['newest', 'oldest', 'most_downloaded', 'most_popular']).default('newest'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateMemeInput = z.infer<typeof createMemeSchema>;
export type MemeQuery = z.infer<typeof memeQuerySchema>;