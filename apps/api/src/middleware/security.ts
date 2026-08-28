import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { id } from '../lib/ids.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Protection CSRF : le cookie de session est SameSite=Lax, ce qui bloque deja
 * les requetes inter-sites les plus courantes. On exige en plus une origine
 * connue sur toute requete mutante, ce qui couvre les formulaires cross-site.
 */
export function originGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) return next();
  // Les webhooks provider ne proviennent pas d'un navigateur : ils sont
  // authentifies par un jeton signe dans l'URL (voir routes/webhooks).
  if (req.path.startsWith('/api/webhooks/')) return next();

  const origin = req.headers.origin ?? '';
  const referer = req.headers.referer ?? '';
  const allowed = [...env.webOrigins, env.publicBaseUrl];

  if (!origin && !referer) {
    // Client non-navigateur (tests, scripts) : autorise uniquement hors production.
    if (!env.isProd) return next();
    return next(new AppError('permission_error', 'Origine de la requete manquante.'));
  }
  const source = origin || referer;
  if (allowed.some((a) => source === a || source.startsWith(`${a}/`))) return next();
  next(new AppError('permission_error', 'Origine de la requete non autorisee.'));
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = id('req');
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

const limiterOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError('rate_limited', 'Trop de tentatives. Reessayez dans quelques minutes.'));
  },
};

/** Limitation stricte sur les points d'entree sensibles (bruteforce). */
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, ...limiterOptions });
export const registerLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, ...limiterOptions });
export const generationLimiter = rateLimit({ windowMs: 60_000, limit: 40, ...limiterOptions });
export const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, ...limiterOptions });
