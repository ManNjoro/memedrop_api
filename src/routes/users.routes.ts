import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getUserProfile, getUserMemes, syncCurrentUser } from '../controllers/users.controller.js';

const router = Router();

// Must come before '/:username' — otherwise Express would treat "sync" as a username.
router.post('/sync', requireAuth, syncCurrentUser);

router.get('/:username', getUserProfile);
router.get('/:username/memes', getUserMemes);

export default router;