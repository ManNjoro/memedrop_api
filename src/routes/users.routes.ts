import { Router } from 'express';
import { getUserProfile, getUserMemes } from '../controllers/users.controller.js';

const router = Router();

router.get('/:username', getUserProfile);
router.get('/:username/memes', getUserMemes);

export default router;