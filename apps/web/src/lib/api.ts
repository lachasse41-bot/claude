import type { ApiErrorBody, ApiErrorCode } from '@nova/shared';

/**
 * Client HTTP unique de l'application.
 * Toutes les requetes passent par l'API : le frontend ne connait aucune cle
 * secrete et n'appelle jamais KIE.ai directement.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'internal_error';
    this.fields = body?.error?.fields ?? {};
  }

  /** Message court adapte a un toast. */
  get title(): string {
    switch (this.code) {
      case 'insufficient_credits': return 'Credits insuffisants';
      case 'permission_error': return 'Acces refuse';
      case 'authentication_error': return 'Session expiree';
      case 'validation_error': return 'Verifiez le formulaire';
      case 'provider_not_configured': return 'Connexion IA non configuree';
      case 'provider_timeout': return 'Delai depasse';
      case 'provider_error': return 'Service de generation indisponible';
      case 'rate_limited': return 'Trop de requetes';
      case 'conflict': return 'Action impossible';
      case 'upload_error': return 'Fichier refuse';
      case 'not_found': return 'Introuvable';
      default: return 'Une erreur est survenue';
    }
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Corps multipart (televersement) : le Content-Type est laisse au navigateur. */
  form?: FormData;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    // Le cookie de session est httpOnly : il est envoye automatiquement et
    // reste inaccessible au JavaScript.
    credentials: 'same-origin',
    body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, payload as ApiErrorBody | null, 'Requete en erreur.');
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
};

/** Construit une chaine de requete en ignorant les valeurs vides. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}
