import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../middleware/error.js';
import { clientIp, currentUser, requireAuth } from '../middleware/context.js';
import { logActivity } from '../services/activity.js';
import { listSessions, revokeSession } from '../services/auth.js';
import { getBalance, listTransactions } from '../services/credits.js';
import { collaboratorOverview } from '../services/analytics.js';
import { updateUserProfile } from '../services/users.js';
import { nameSchema, paginationSchema, sessionUser, str } from './helpers.js';

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get('/', asyncRoute(async (req, res) => {
  res.json({ user: sessionUser(currentUser(req)) });
}));

const profileSchema = z.object({
  name: nameSchema.optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide.').optional(),
});

meRouter.patch('/', asyncRoute(async (req, res) => {
  const patch = profileSchema.parse(req.body);
  const user = currentUser(req);
  updateUserProfile(user.id, patch);
  logActivity({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'user.profile_updated',
    entityType: 'user',
    entityId: user.id,
    ip: clientIp(req),
  });
  const { getUserById } = await import('../services/users.js');
  res.json({ user: sessionUser(getUserById(user.id)!) });
}));

/** Tableau de bord du collaborateur : uniquement ses propres donnees. */
meRouter.get('/overview', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const days = Math.min(90, Math.max(7, Number.parseInt(String(req.query.days ?? '30'), 10) || 30));
  res.json(collaboratorOverview(user.organization_id, user.id, days));
}));

meRouter.get('/credits', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const { page, pageSize } = paginationSchema.parse(req.query);
  res.json({
    summary: getBalance(user.id),
    transactions: listTransactions({
      organizationId: user.organization_id,
      userId: user.id,
      from: str(req.query.from),
      to: str(req.query.to),
      page,
      pageSize,
    }),
  });
}));

meRouter.get('/sessions', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  res.json({
    sessions: listSessions(user.id).map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
      ip: s.ip,
      userAgent: s.user_agent,
      current: s.id === req.auth?.sessionId,
    })),
  });
}));

meRouter.delete('/sessions/:sessionId', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const owned = listSessions(user.id).some((s) => s.id === req.params.sessionId);
  if (owned) revokeSession(req.params.sessionId);
  res.json({ ok: true });
}));
