import { Router } from 'express';
import { verifySignature } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { asyncRoute } from '../middleware/error.js';
import { syncGeneration } from '../services/generations.js';

export const webhooksRouter = Router();

/**
 * Callback KIE.ai (`callBackUrl`).
 * ---------------------------------------------------------------------------
 * Le corps de la requete n'est PAS considere comme une source de verite : il
 * sert uniquement de signal pour declencher immediatement une verification
 * aupres de l'API (`recordInfo`). Un tiers ne peut donc pas forcer un etat.
 * L'URL contient une signature HMAC liee a l'identifiant de la generation.
 */
webhooksRouter.post('/kie/:generationId', asyncRoute(async (req, res) => {
  const { generationId } = req.params;
  const signature = String(req.query.signature ?? '');
  if (!verifySignature(`callback.${generationId}`, signature)) {
    logger.warn('Callback provider rejete : signature invalide', { generationId });
    return res.status(403).json({ ok: false });
  }
  // Reponse immediate : le provider ne doit pas attendre notre traitement.
  res.json({ ok: true });
  void syncGeneration(generationId).catch((error) => {
    logger.error('Synchronisation post-callback impossible', { generationId, error: String(error) });
  });
}));
