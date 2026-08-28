import type { Request, Response } from 'express';
import { z } from 'zod';
import type { SessionUser } from '@nova/shared';
import { env } from '../env.js';
import { getBalance } from '../services/credits.js';
import { getOrganization } from '../services/organizations.js';
import { toPublicUser, type UserRow } from '../services/users.js';
import { currentUser } from '../middleware/context.js';
import type { Viewer } from '../services/generations.js';

export const passwordSchema = z
  .string()
  .min(10, 'Le mot de passe doit contenir au moins 10 caracteres.')
  .max(200, 'Mot de passe trop long.')
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Le mot de passe doit contenir au moins une lettre et un chiffre.',
  });

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .email('Adresse e-mail invalide.');

export const nameSchema = z.string().trim().min(2, 'Nom trop court.').max(80, 'Nom trop long.');

export function setSessionCookie(res: Response, token: string, expiresAt: string): void {
  res.cookie(env.sessionCookieName, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    expires: new Date(expiresAt),
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.sessionCookieName, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
  });
}

export function sessionUser(row: UserRow): SessionUser {
  const organization = getOrganization(row.organization_id);
  return {
    ...toPublicUser(row),
    organizationName: organization.name,
    credits: getBalance(row.id),
  };
}

export function viewerOf(req: Request): Viewer {
  const user = currentUser(req);
  return { organizationId: user.organization_id, userId: user.id, role: user.role };
}

/**
 * Portee de lecture : un administrateur peut cibler un collaborateur precis
 * (ou tous) ; un collaborateur est toujours restreint a ses propres donnees.
 */
export function scopedUserId(req: Request): string | null {
  const user = currentUser(req);
  if (user.role !== 'admin') return user.id;
  const requested = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (requested === 'all') return null;
  if (requested) return requested;
  return null;
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
