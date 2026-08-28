import { createApp } from './app.js';
import { bootstrap } from './db/bootstrap.js';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { startWorker, stopWorker } from './services/worker.js';

// Le schema est applique a l'ouverture de la base (voir db/index.ts).
bootstrap();

const app = createApp();
const server = app.listen(env.port, env.host, () => {
  logger.info('API demarree', {
    port: env.port,
    env: env.nodeEnv,
    publicBaseUrl: env.publicBaseUrl,
    webOrigins: env.webOrigins,
  });
});

startWorker();

function shutdown(signal: string): void {
  logger.info('Arret en cours', { signal });
  stopWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Promesse rejetee non geree', { reason: String(reason) });
});
