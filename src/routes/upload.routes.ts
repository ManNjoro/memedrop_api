import { Router } from 'express';
import { cleanupUpload, createUploadSignature } from '../controllers/upload.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { cleanupUploadSchema, uploadSignatureSchema } from '../validators/memes.validators.js';

const router = Router();

router.post('/signature', requireAuth, validate(uploadSignatureSchema), createUploadSignature);
router.post('/cleanup', requireAuth, validate(cleanupUploadSchema), cleanupUpload);

export default router;