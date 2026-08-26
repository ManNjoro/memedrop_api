import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';
import uploadRoutes from './routes/upload.routes.js';
import memesRoutes from './routes/memes.routes.js';
import usersRoutes from './routes/users.routes.js';
import savedRoutes from './routes/saved.routes.js';
import webhookRoutes from './routes/webhooks.routes.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { httpLogger } from './logger/httpLogger.js';
import { logger } from './logger/logger.js';

function createApp() {
  const app = express();

  const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));

  // Webhook route needs the raw body for svix signature verification —
  // must be registered BEFORE express.json() below, and only for this path,
  // or every other route would receive an unparsed body too.
  app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

  app.use(express.json());

  // Populates req.auth on every request when a valid session is present;
  // routes decide individually whether to require it (see requireAuth.ts).
  app.use(clerkMiddleware());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/upload', uploadRoutes);
  app.use('/api/memes', memesRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/saved', savedRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

const port = Number(process.env.PORT ?? 4000);

const app = createApp();
app.use(httpLogger)

app.listen(port, () => {
  logger.info(`MemeDrop API listening on http://localhost:${port}`);
});