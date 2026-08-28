import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@nova/shared';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: { code: 'not_found', message: `Route inconnue : ${req.method} ${req.path}`, requestId: req.requestId },
  };
  res.status(404).json(body);
}

/**
 * Gestionnaire d'erreurs unique.
 * Regle : aucun detail interne (stack, reponse provider, secret) ne sort d'ici.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let body: ApiErrorBody = {
    error: {
      code: 'internal_error',
      message: "Une erreur inattendue s'est produite. L'equipe technique a ete notifiee.",
      requestId: req.requestId,
    },
  };

  if (err instanceof AppError) {
    status = err.status;
    body = {
      error: { code: err.code, message: err.message, fields: err.fields, requestId: req.requestId },
    };
  } else if (err instanceof ZodError) {
    status = 400;
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      fields[issue.path.join('.') || '_'] = issue.message;
    }
    body = {
      error: {
        code: 'validation_error',
        message: 'Certains champs sont invalides.',
        fields,
        requestId: req.requestId,
      },
    };
  } else if (err instanceof multer.MulterError) {
    status = 400;
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Fichier trop volumineux.'
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'Trop de fichiers envoyes en une seule fois.'
          : "Le televersement du fichier a echoue.";
    body = { error: { code: 'upload_error', message, requestId: req.requestId } };
  }

  const level = status >= 500 ? 'error' : 'warn';
  logger[level]('Requete en erreur', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    status,
    code: body.error.code,
    userId: req.auth?.user.id,
    // Details internes : conserves uniquement dans le journal serveur.
    detail: err instanceof AppError ? err.internal : err instanceof Error ? err.stack : String(err),
  });

  res.status(status).json(body);
}

/** Enveloppe un handler async pour propager les rejets vers `errorHandler`. */
export function asyncRoute<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req as T, res, next).catch(next);
  };
}
