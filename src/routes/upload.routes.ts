import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { uploadSignatureSchema, cleanupUploadSchema } from '../validators/memes.validators.js';
import { createUploadSignature, cleanupUpload } from '../controllers/upload.controller.js';

const router = Router();

router.post('/signature', requireAuth, validate(uploadSignatureSchema), createUploadSignature);
router.post('/cleanup', requireAuth, validate(cleanupUploadSchema), cleanupUpload);

export default router;