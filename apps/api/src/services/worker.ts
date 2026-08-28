import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { dueForPolling, syncGeneration } from './generations.js';
import { advanceRuns } from './workflows.js';
import { purgeExpiredSessions } from './auth.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let ticks = 0;

/**
 * Worker de reconciliation.
 * ---------------------------------------------------------------------------
 * Le webhook KIE.ai accelere la mise a jour, mais le sondage reste la source
 * de verite : il fonctionne meme si l'API n'est pas joignable depuis Internet
 * et rattrape tout callback perdu.
 */
export async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const ids = dueForPolling(env.pollBatchSize);
    if (ids.length) {
      await Promise.allSettled(ids.map((generationId) => syncGeneration(generationId)));
    }
    advanceRuns();

    ticks += 1;
    // Nettoyage periodique (environ toutes les heures).
    if (ticks % Math.max(1, Math.floor(3_600_000 / env.pollIntervalMs)) === 0) {
      const purged = purgeExpiredSessions();
      if (purged) logger.info('Sessions expirees purgees', { purged });
    }
  } catch (error) {
    logger.error('Erreur dans le worker de generation', { error: String(error) });
  } finally {
    running = false;
  }
}

export function startWorker(): void {
  if (!env.workerEnabled || timer) return;
  timer = setInterval(() => void tick(), env.pollIntervalMs);
  timer.unref();
  logger.info('Worker de generation demarre', { intervalMs: env.pollIntervalMs });
}

export function stopWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
