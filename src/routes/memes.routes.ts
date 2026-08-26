import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { createMemeSchema, memeQuerySchema } from '../validators/memes.validators.js';
import {
  createMeme,
  listMemes,
  getMeme,
  recordDownload,
  recordView,
  deleteMeme,
  likeMeme,
  unlikeMeme,
  saveMeme,
  unsaveMeme,
} from '../controllers/memes.controller.js';

const router = Router();

router.get('/', validate(memeQuerySchema, 'query'), listMemes);
router.get('/:id', getMeme);
router.post('/', requireAuth, validate(createMemeSchema), createMeme);
router.post('/:id/download', recordDownload);
router.post('/:id/view', recordView);
router.post('/:id/like', requireAuth, likeMeme);
router.delete('/:id/like', requireAuth, unlikeMeme);
router.post('/:id/save', requireAuth, saveMeme);
router.delete('/:id/save', requireAuth, unsaveMeme);
router.delete('/:id', requireAuth, deleteMeme);

export default router;