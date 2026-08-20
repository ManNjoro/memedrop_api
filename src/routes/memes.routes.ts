import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { createMemeSchema, memeQuerySchema } from '../validators/memes.validators.js';
import { createMeme, listMemes, getMeme, recordDownload } from '../controllers/memes.controller.js';

const router = Router();

router.get('/', validate(memeQuerySchema, 'query'), listMemes);
router.get('/:id', getMeme);
router.post('/', requireAuth, validate(createMemeSchema), createMeme);
router.post('/:id/download', recordDownload);

export default router;