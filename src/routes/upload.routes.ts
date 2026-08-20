import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { uploadSignatureSchema } from '../validators/memes.validators.js';
import { createUploadSignature } from '../controllers/upload.controller.js';

const router = Router();

router.post('/signature', requireAuth, validate(uploadSignatureSchema), createUploadSignature);

export default router;