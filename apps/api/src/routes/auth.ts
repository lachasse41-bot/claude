import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { asyncRoute } from '../middleware/error.js';
import { clientIp, currentUser, requireAuth } from '../middleware/context.js';
import { authLimiter, registerLimiter } from '../middleware/security.js';
import {
  acceptInvitation, authenticate, consumePasswordReset, createPasswordReset,
  createSession, previewInvitation, revokeSession,
} from '../services/auth.js';
import { logActivity } from '../services/activity.js';
import { sendEmail } from '../services/mailer.js';
import { passwordResetEmail } from '../services/emailTemplates.js';
import { getUserById } from '../services/users.js';
import {
  clearSessionCookie, emailSchema, nameSchema, passwordSchema, sessionUser, setSessionCookie,
} from './helpers.js';

export const authRouter = Router();

/**
 * L'application est mono-organisation par deploiement : l'organisation
 * courante est la premiere creee. Le schema reste multi-organisation pour
 * permettre une extension ulterieure sans migration.
 */
function primaryOrganizationId(): string {
  const row = db.prepare('SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined;
  if (!row) throw new AppError('internal_error', "Aucune organisation n'est configuree.");
  return row.id;
}

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Mot de passe requis.'),
});

authRouter.post('/login', authLimiter, asyncRoute(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const organizationId = primaryOrganizationId();
  const user = authenticate(organizationId, email, password);
  const session = createSession(user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
  setSessionCookie(res, session.token, session.expiresAt);
  logActivity({
    organizationId,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    ip: clientIp(req),
  });
  res.json({ user: sessionUser(user) });
}));

authRouter.post('/logout', asyncRoute(async (req, res) => {
  if (req.auth) {
    revokeSession(req.auth.sessionId);
    logActivity({
      organizationId: req.auth.user.organization_id,
      actorUserId: req.auth.user.id,
      actorName: req.auth.user.name,
      actorEmail: req.auth.user.email,
      action: 'auth.logout',
      ip: clientIp(req),
    });
  }
  clearSessionCookie(res);
  res.json({ ok: true });
}));

authRouter.get('/session', asyncRoute(async (req, res) => {
  if (!req.auth) return res.json({ user: null });
  res.json({ user: sessionUser(req.auth.user) });
}));

/* --------------------------- Invitations --------------------------- */

authRouter.get('/invitation', asyncRoute(async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) throw badRequest("Jeton d'invitation manquant.");
  res.json({ invitation: previewInvitation(token) });
}));

const registerSchema = z.object({
  token: z.string().min(10, "Jeton d'invitation invalide."),
  name: nameSchema,
  password: passwordSchema,
});

/**
 * Inscription : uniquement sur invitation valide.
 * Aucun compte ne peut etre cree sans autorisation prealable d'un
 * administrateur (exigence d'appartenance a l'organisation).
 */
authRouter.post('/register', registerLimiter, asyncRoute(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const created = acceptInvitation(input);
  const row = getUserById(created.id)!;
  const session = createSession(row.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
  setSessionCookie(res, session.token, session.expiresAt);
  logActivity({
    organizationId: row.organization_id,
    actorUserId: row.id,
    actorName: row.name,
    actorEmail: row.email,
    action: 'auth.register',
    entityType: 'user',
    entityId: row.id,
    metadata: { role: row.role },
    ip: clientIp(req),
  });
  res.status(201).json({ user: sessionUser(row) });
}));

/* ------------------------ Mot de passe oublie ---------------------- */

/**
 * Demande de reinitialisation.
 * La reponse est volontairement identique dans tous les cas : elle ne revele
 * ni l'existence du compte, ni le succes de l'envoi. Seul le journal serveur
 * porte le detail.
 */
authRouter.post('/forgot-password', authLimiter, asyncRoute(async (req, res) => {
  const { email } = z.object({ email: emailSchema }).parse(req.body);
  const organizationId = primaryOrganizationId();
  const ticket = createPasswordReset(email);

  if (ticket) {
    const resetUrl = `${env.webOrigins[0] ?? env.publicBaseUrl}/reset-password?token=${ticket.token}`;
    const delivery = await sendEmail({
      organizationId,
      to: ticket.email,
      kind: 'password_reset',
      message: passwordResetEmail({
        name: ticket.name,
        resetUrl,
        expiresAt: ticket.expiresAt,
      }),
    });

    if (!delivery.delivered) {
      // Sans service d'e-mail, le lien reste seulement dans le journal serveur :
      // un administrateur peut le transmettre. Il n'est jamais renvoye au client
      // en production, sous peine de permettre la prise de controle d'un compte
      // a partir de la seule connaissance d'une adresse.
      logger.warn('Lien de reinitialisation non distribue', {
        email: ticket.email,
        reason: delivery.reason,
        resetUrl,
      });
    }

    logActivity({
      organizationId,
      action: 'auth.password_reset_requested',
      actorEmail: ticket.email,
      metadata: { emailDelivered: delivery.delivered },
      ip: clientIp(req),
    });

    if (!env.isProd && !delivery.delivered) {
      // Confort de developpement uniquement : permet de derouler le parcours
      // complet sans serveur SMTP. Jamais actif en production.
      return res.json({ ok: true, devResetUrl: resetUrl });
    }
  }
  res.json({ ok: true });
}));

const resetSchema = z.object({
  token: z.string().min(10, 'Jeton invalide.'),
  password: passwordSchema,
});

authRouter.post('/reset-password', authLimiter, asyncRoute(async (req, res) => {
  const { token, password } = resetSchema.parse(req.body);
  const user = consumePasswordReset(token, password);
  logActivity({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'auth.password_reset',
    entityType: 'user',
    entityId: user.id,
    ip: clientIp(req),
  });
  res.json({ ok: true });
}));

/* --------------------------- Mot de passe -------------------------- */

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis.'),
  newPassword: passwordSchema,
});

authRouter.post('/change-password', requireAuth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = currentUser(req);
  const usersService = await import('../services/users.js');
  if (!usersService.verifyPassword(currentPassword, user.password_hash)) {
    throw unauthorized('Mot de passe actuel incorrect.');
  }
  usersService.changePassword(user.id, newPassword);
  // Les autres sessions sont invalidees ; celle en cours est renouvelee.
  usersService.revokeAllSessions(user.id);
  const session = createSession(user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
  setSessionCookie(res, session.token, session.expiresAt);
  logActivity({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: user.id,
    ip: clientIp(req),
  });
  res.json({ ok: true });
}));

export { primaryOrganizationId };
