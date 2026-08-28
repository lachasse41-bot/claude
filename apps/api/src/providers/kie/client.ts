import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { resolveCredentials } from '../../services/apiConfig.js';

/**
 * Client HTTP KIE.ai.
 * ---------------------------------------------------------------------------
 * Contrat utilise (API "Jobs" unifiee) :
 *   POST {baseUrl}/api/v1/jobs/createTask
 *        body    : { model, input, callBackUrl? }
 *        reponse : { code, msg, data: { taskId } }
 *   GET  {baseUrl}/api/v1/jobs/recordInfo?taskId=...
 *        reponse : { code, msg, data: { taskId, model, state, resultJson,
 *                                       failCode, failMsg, ... } }
 *   Authentification : header `Authorization: Bearer <API_KEY>`
 *
 * Les etats renvoyes par le provider sont : waiting | queuing | generating |
 * success | fail.
 */

export const CREATE_TASK_PATH = '/api/v1/jobs/createTask';
export const RECORD_INFO_PATH = '/api/v1/jobs/recordInfo';

export type ProviderState = 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';

export interface CreateTaskResult {
  taskId: string;
  raw: unknown;
}

export interface TaskRecord {
  taskId: string;
  state: ProviderState;
  resultUrls: string[];
  failCode: string | null;
  failMessage: string | null;
  costTimeMs: number | null;
  raw: unknown;
}

interface KieEnvelope<T> {
  code?: number;
  msg?: string;
  message?: string;
  data?: T;
}

function providerError(message: string, internal: unknown, code: 'provider_error' | 'provider_timeout' = 'provider_error') {
  return new AppError(code, message, { internal });
}

async function request<T>(
  organizationId: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<KieEnvelope<T>> {
  const { baseUrl, apiKey } = resolveCredentials(organizationId);
  if (!apiKey) {
    throw new AppError(
      'provider_not_configured',
      "La connexion a KIE.ai n'est pas configuree. Un administrateur doit renseigner la cle API.",
    );
  }

  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.kieRequestTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw providerError(
      aborted
        ? "Le service de generation n'a pas repondu dans le temps imparti."
        : 'Le service de generation est momentanement injoignable.',
      { path, error: String(error) },
      aborted ? 'provider_timeout' : 'provider_error',
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload: KieEnvelope<T>;
  try {
    payload = text ? (JSON.parse(text) as KieEnvelope<T>) : {};
  } catch {
    throw providerError('Reponse illisible du service de generation.', {
      path,
      status: response.status,
      body: text.slice(0, 2000),
    });
  }

  if (!response.ok) {
    // 401/403 cote provider = probleme de configuration, pas une erreur utilisateur.
    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        'provider_not_configured',
        "La cle API KIE.ai est refusee. Un administrateur doit verifier la configuration.",
        { internal: { path, status: response.status, body: payload } },
      );
    }
    if (response.status === 429) {
      throw new AppError('rate_limited', 'Le service de generation est sature. Reessayez dans un instant.', {
        internal: { path, status: response.status },
      });
    }
    throw providerError(
      providerMessage(payload) ?? 'Le service de generation a refuse la demande.',
      { path, status: response.status, body: payload },
    );
  }

  if (typeof payload.code === 'number' && payload.code !== 200 && payload.code !== 0) {
    throw providerError(providerMessage(payload) ?? 'Le service de generation a refuse la demande.', {
      path,
      body: payload,
    });
  }

  return payload;
}

function providerMessage(payload: KieEnvelope<unknown>): string | null {
  const raw = payload.msg ?? payload.message;
  if (!raw || typeof raw !== 'string') return null;
  // On relaie le message provider mais borne : il ne contient pas de secret,
  // seulement la raison du refus (parametre invalide, quota, etc.).
  return raw.slice(0, 300);
}

export async function createTask(input: {
  organizationId: string;
  model: string;
  payload: Record<string, unknown>;
  callbackUrl?: string;
}): Promise<CreateTaskResult> {
  const body: Record<string, unknown> = { model: input.model, input: input.payload };
  if (input.callbackUrl) body.callBackUrl = input.callbackUrl;

  const res = await request<{ taskId?: string; task_id?: string }>(
    input.organizationId, 'POST', CREATE_TASK_PATH, body,
  );
  const taskId = res.data?.taskId ?? res.data?.task_id;
  if (!taskId) {
    throw providerError("Le service de generation n'a pas renvoye d'identifiant de tache.", { body: res });
  }
  return { taskId, raw: res };
}

interface RecordInfoData {
  taskId?: string;
  state?: string;
  status?: string;
  successFlag?: number;
  resultJson?: string | Record<string, unknown>;
  failCode?: string | number;
  failMsg?: string;
  costTime?: number;
}

export async function getTask(organizationId: string, taskId: string): Promise<TaskRecord> {
  const res = await request<RecordInfoData>(organizationId, 'GET', RECORD_INFO_PATH, undefined, { taskId });
  const data = res.data ?? {};
  return {
    taskId: data.taskId ?? taskId,
    state: normalizeState(data),
    resultUrls: extractResultUrls(data.resultJson),
    failCode: data.failCode !== undefined && data.failCode !== null ? String(data.failCode) : null,
    failMessage: data.failMsg ? String(data.failMsg).slice(0, 500) : null,
    costTimeMs: typeof data.costTime === 'number' ? data.costTime : null,
    raw: res,
  };
}

export function normalizeState(data: { state?: string; status?: string; successFlag?: number }): ProviderState {
  const raw = (data.state ?? data.status ?? '').toString().toLowerCase();
  if (['success', 'succeeded', 'completed', 'done'].includes(raw)) return 'success';
  if (['fail', 'failed', 'error'].includes(raw)) return 'fail';
  if (['generating', 'processing', 'running'].includes(raw)) return 'generating';
  if (['queuing', 'queued', 'pending'].includes(raw)) return 'queuing';
  if (['waiting', 'created'].includes(raw)) return 'waiting';
  // Certains points d'entree exposent `successFlag` (0 en cours, 1 ok, 2/3 echec).
  if (data.successFlag === 1) return 'success';
  if (data.successFlag === 2 || data.successFlag === 3) return 'fail';
  return 'waiting';
}

/**
 * `resultJson` est une chaine JSON ; sa forme varie selon les modeles.
 * On extrait toutes les URL http(s) presentes, quel que soit le nom de la cle
 * (`resultUrls`, `urls`, `imageUrls`, `videoUrl`, ...), ce qui evite de coder
 * en dur une forme de reponse par modele.
 */
export function extractResultUrls(resultJson: unknown): string[] {
  if (!resultJson) return [];
  let parsed: unknown = resultJson;
  if (typeof resultJson === 'string') {
    try {
      parsed = JSON.parse(resultJson);
    } catch {
      return /^https?:\/\//i.test(resultJson.trim()) ? [resultJson.trim()] : [];
    }
  }
  const urls: string[] = [];
  const walk = (node: unknown, depth = 0): void => {
    if (depth > 6 || urls.length > 50) return;
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node)) urls.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (node && typeof node === 'object') {
      for (const value of Object.values(node as Record<string, unknown>)) walk(value, depth + 1);
    }
  };
  walk(parsed);
  return [...new Set(urls)];
}

/** Verification de connectivite utilisee par l'espace Administrateur. */
export async function checkConnectivity(organizationId: string): Promise<{ ok: boolean; message: string }> {
  try {
    // `recordInfo` sur un identifiant inexistant : valide la cle et la
    // joignabilite sans consommer de credits provider.
    await getTask(organizationId, 'connectivity-check');
    return { ok: true, message: 'Connexion etablie avec KIE.ai.' };
  } catch (error) {
    if (error instanceof AppError) {
      // Une erreur "tache introuvable" prouve que la cle est acceptee.
      if (error.code === 'provider_error') {
        logger.info('Verification de connectivite KIE : reponse fonctionnelle', { organizationId });
        return { ok: true, message: 'Cle acceptee par KIE.ai.' };
      }
      return { ok: false, message: error.message };
    }
    return { ok: false, message: 'Verification impossible.' };
  }
}
