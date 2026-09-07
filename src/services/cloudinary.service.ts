import { db } from "../db/index.js";
import { memes } from "../db/schema.js";
import { cloudinary } from "../lib/cloudinary.js";
import { logger } from "../logger/logger.js";


const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function cleanupDanglingMedia() {
  // Get all Cloudinary public IDs currently referenced by Neon
  const referencedMedia = await db
    .select({
      cloudinaryPublicId: memes.cloudinaryPublicId,
    })
    .from(memes);

  const referencedIds = new Set(
    referencedMedia.map((media) => media.cloudinaryPublicId)
  );

  const cutoffTime = Date.now() - CLEANUP_AGE_MS;

  let checked = 0;
  let skipped = 0;
  let deleted = 0;
  let failed = 0;

  // Images and videos use different Cloudinary resource types
  for (const resourceType of ['image', 'video'] as const) {
    let nextCursor: string | undefined;

    do {
      const result = await cloudinary.api.resources({
        resource_type: resourceType,
        type: 'upload',
        prefix: `memedrop/${resourceType}s/`,
        max_results: 500,
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
      });

      for (const resource of result.resources) {
        checked++;

        // Cloudinary returns created_at as an ISO date string
        const createdAt = new Date(resource.created_at).getTime();

        // Don't delete recently uploaded assets.
        // This gives the database transaction time to complete.
        if (createdAt > cutoffTime) {
          skipped++;

          logger.info(
            `Skipping recent ${resourceType}: ${resource.public_id} (created at ${resource.created_at})`
          );

          continue;
        }

        // Asset is old enough, so now check whether Neon references it
        if (referencedIds.has(resource.public_id)) {
          continue;
        }

        // Asset is old enough AND has no Neon reference
        try {
          await cloudinary.uploader.destroy(resource.public_id, {
            resource_type: resourceType,
          });

          deleted++;

          logger.info(
            `Deleted dangling ${resourceType}: ${resource.public_id}`
          );
        } catch (error) {
          failed++;

          logger.error(
            `Failed to delete dangling ${resourceType}, ${resource.public_id}: ${error}`
          );
        }
      }

      nextCursor = result.next_cursor;
    } while (nextCursor);
  }

  return {
    checked,
    skipped,
    deleted,
    failed,
  };
}