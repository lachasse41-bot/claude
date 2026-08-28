import { Router } from 'express';
import { adminRouter } from './admin.js';
import { authRouter } from './auth.js';
import { filesRouter } from './files.js';
import { galleryRouter } from './gallery.js';
import { generationsRouter } from './generations.js';
import { meRouter } from './me.js';
import { modelsRouter } from './models.js';
import { webhooksRouter } from './webhooks.js';
import { workflowsRouter } from './workflows.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/models', modelsRouter);
apiRouter.use('/files', filesRouter);
apiRouter.use('/generations', generationsRouter);
apiRouter.use('/gallery', galleryRouter);
apiRouter.use('/workflows', workflowsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/webhooks', webhooksRouter);
