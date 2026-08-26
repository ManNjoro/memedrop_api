import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { listSavedMemes } from '../controllers/memes.controller.js';

const router = Router();

router.get('/', requireAuth, listSavedMemes);

export default router;