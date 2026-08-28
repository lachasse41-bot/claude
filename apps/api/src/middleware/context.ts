import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@nova/shared';
import { env } from '../env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { resolveSession } from '../services/auth.js';
import { toPublicUser, type UserRow } from '../services/users.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { user: UserRow; sessionId: string };
      requestId?: string;
    }
  }
}

export function currentUser(req: Request): UserRow {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
}

export function actorInfo(req: Request) {
  const user = currentUser(req);
  return {
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    ip: clientIp(req),
  };
}

export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.ip ?? '';
}

/** Charge la session si presente, sans exiger l'authentification. */
export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[env.sessionCookieName];
  if (typeof token === 'string' && token.length > 0) {
    const resolved = resolveSession(token);
    if (resolved) req.auth = resolved;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized());
  next();
}

/** Controle d'acces par role, applique cote serveur sur chaque route protegee. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.user.role)) {
      return next(forbidden('Cette action est reservee aux administrateurs.'));
    }
    next();
  };
}

export function publicUserOf(req: Request) {
  return toPublicUser(currentUser(req));
}
