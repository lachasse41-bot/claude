import path from 'node:path';
import fs from 'node:fs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './env.js';
import { attachSession } from './middleware/context.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiLimiter, originGuard, requestId } from './middleware/security.js';
import { apiRouter } from './routes/index.js';

export function createApp(): express.Express {
  const app = express();

  // Derriere un reverse proxy (deploiement type), l'IP reelle vient de
  // X-Forwarded-For ; necessaire pour la limitation de debit et les journaux.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Le frontend est servi separement en developpement ; la CSP applicable
      // est definie sur les reponses HTML plus bas.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true); // outils non-navigateur
        callback(null, env.webOrigins.includes(origin.replace(/\/$/, '')));
      },
      credentials: true,
    }),
  );

  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter);
  app.use(originGuard);
  app.use(attachSession);

  app.use('/api', apiRouter);

  // Deploiement mono-processus : l'API sert aussi le frontend compile.
  if (env.serveWeb && fs.existsSync(env.webDistPath)) {
    app.use(express.static(env.webDistPath, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(env.webDistPath, 'index.html'));
    });
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
