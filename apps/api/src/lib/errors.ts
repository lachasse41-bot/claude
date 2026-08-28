import type { ApiErrorCode } from '@nova/shared';

/**
 * Erreur applicative. `message` est destine a l'utilisateur final : il ne doit
 * jamais contenir de secret ni de detail technique du provider.
 * `internal` reste cote serveur (journalisation/diagnostic).
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields?: Record<string, string>;
  readonly internal?: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { status?: number; fields?: Record<string, string>; internal?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? defaultStatus(code);
    this.fields = opts.fields;
    this.internal = opts.internal;
  }
}

function defaultStatus(code: ApiErrorCode): number {
  switch (code) {
    case 'validation_error': return 400;
    case 'authentication_error': return 401;
    case 'permission_error': return 403;
    case 'not_found': return 404;
    case 'conflict': return 409;
    case 'insufficient_credits': return 402;
    case 'rate_limited': return 429;
    case 'provider_error': return 502;
    case 'provider_timeout': return 504;
    case 'provider_not_configured': return 503;
    case 'upload_error': return 400;
    default: return 500;
  }
}

export const badRequest = (m: string, fields?: Record<string, string>) =>
  new AppError('validation_error', m, { fields });
export const unauthorized = (m = 'Authentification requise.') => new AppError('authentication_error', m);
export const forbidden = (m = "Vous n'avez pas acces a cette ressource.") => new AppError('permission_error', m);
export const notFound = (m = 'Ressource introuvable.') => new AppError('not_found', m);
export const conflict = (m: string) => new AppError('conflict', m);
