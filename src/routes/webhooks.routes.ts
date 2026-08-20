import { Router } from 'express';
import { handleClerkWebhook } from '../controllers/webhooks.controller.js';

const router = Router();

router.post('/clerk', handleClerkWebhook);

export default router;