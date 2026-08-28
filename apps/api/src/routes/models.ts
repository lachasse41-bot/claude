import { Router } from 'express';
import { computeCreditCost } from '@nova/shared';
import { asyncRoute } from '../middleware/error.js';
import { currentUser, requireAuth } from '../middleware/context.js';
import { getEnabledModel, listModels } from '../services/models.js';
import { validateParams } from '../services/paramValidation.js';

export const modelsRouter = Router();
modelsRouter.use(requireAuth);

/**
 * Catalogue des modeles actifs.
 * Le frontend construit ses formulaires uniquement a partir de cette reponse :
 * ajouter un modele cote administration suffit a le rendre utilisable.
 */
modelsRouter.get('/', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  res.json({ models: listModels(user.organization_id) });
}));

modelsRouter.get('/:modelKey', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  res.json({ model: getEnabledModel(user.organization_id, req.params.modelKey) });
}));

/**
 * Estimation du cout avant lancement.
 * Le calcul cote serveur fait foi : l'estimation affichee dans l'interface
 * ne peut pas etre manipulee pour contourner le systeme de credits.
 */
modelsRouter.post('/:modelKey/estimate', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const model = getEnabledModel(user.organization_id, req.params.modelKey);
  const outputCount = Math.min(
    model.outputs.max,
    Math.max(model.outputs.min, Number.parseInt(String(req.body?.outputCount ?? model.outputs.default), 10) || model.outputs.default),
  );
  const injected = (req.body?.injectedFileCounts ?? {}) as Record<string, number>;
  const resolved = validateParams(model, req.body?.params, injected);
  res.json({
    unitCost: computeCreditCost(model, resolved.values, 1),
    totalCost: computeCreditCost(model, resolved.values, 1) * outputCount,
    outputCount,
  });
}));
