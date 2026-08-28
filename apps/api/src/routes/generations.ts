import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../middleware/error.js';
import { clientIp, currentUser, requireAuth } from '../middleware/context.js';
import { generationLimiter } from '../middleware/security.js';
import { logActivity } from '../services/activity.js';
import {
  cancelGeneration, createGeneration, deleteGeneration, getGeneration, listGenerations,
} from '../services/generations.js';
import { paginationSchema, scopedUserId, str, viewerOf } from './helpers.js';

export const generationsRouter = Router();
generationsRouter.use(requireAuth);

const createSchema = z.object({
  modelKey: z.string().min(1, 'Modele requis.'),
  params: z.record(z.unknown()).optional(),
  outputCount: z.coerce.number().int().min(1).max(16).optional(),
});

generationsRouter.post('/', generationLimiter, asyncRoute(async (req, res) => {
  const input = createSchema.parse(req.body);
  const viewer = viewerOf(req);
  const user = currentUser(req);
  const result = createGeneration({
    viewer,
    modelKey: input.modelKey,
    params: input.params ?? {},
    outputCount: input.outputCount,
  });
  logActivity({
    organizationId: viewer.organizationId,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'generation.created',
    entityType: 'generation',
    entityId: result.batchId,
    metadata: {
      modelKey: input.modelKey,
      outputCount: result.generations.length,
      creditCost: result.creditCost,
    },
    ip: clientIp(req),
  });
  res.status(201).json(result);
}));

/**
 * Historique. Un collaborateur ne voit que ses generations ; un administrateur
 * peut cibler un collaborateur (`userId`) ou tout voir (`userId=all`).
 */
generationsRouter.get('/', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const { page, pageSize } = paginationSchema.parse(req.query);
  res.json(
    listGenerations({
      organizationId: user.organization_id,
      userId: scopedUserId(req),
      state: str(req.query.state) as never,
      modelKey: str(req.query.modelKey),
      kind: str(req.query.kind),
      search: str(req.query.search),
      from: str(req.query.from),
      to: str(req.query.to),
      sort: (str(req.query.sort) as 'recent' | 'oldest' | 'cost') ?? 'recent',
      page,
      pageSize,
    }),
  );
}));

generationsRouter.get('/:generationId', asyncRoute(async (req, res) => {
  res.json({ generation: getGeneration(req.params.generationId, viewerOf(req)) });
}));

generationsRouter.post('/:generationId/cancel', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const generation = cancelGeneration(req.params.generationId, viewerOf(req));
  logActivity({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'generation.cancelled',
    entityType: 'generation',
    entityId: generation.id,
    ip: clientIp(req),
  });
  res.json({ generation });
}));

generationsRouter.delete('/:generationId', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  deleteGeneration(req.params.generationId, viewerOf(req));
  logActivity({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'generation.deleted',
    entityType: 'generation',
    entityId: req.params.generationId,
    ip: clientIp(req),
  });
  res.json({ ok: true });
}));
