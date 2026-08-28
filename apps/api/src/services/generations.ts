import {
  computeCreditCost,
  type TransportKey,
  type Generation,
  type GenerationAsset,
  type ModelSummary,
  type ParamValue,
  type PersistedGenerationState,
} from '@nova/shared';
import { db, nowIso, parseJson, tx } from '../db/index.js';
import { env } from '../env.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { id } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { signPayload } from '../lib/crypto.js';
import * as kie from '../providers/kie/client.js';
import { applyLedgerEntry, assertCanSpend } from './credits.js';
import { deleteFileById, mirrorRemoteFile, resolveFileUrls, toStoredFile, getFileRow } from './files.js';
import { getEnabledModel, getModelByKey } from './models.js';
import { getSettings } from './organizations.js';
import { buildProviderInput, validateParams } from './paramValidation.js';

export interface Viewer {
  organizationId: string;
  userId: string;
  role: string;
}

interface GenerationRow {
  id: string; organization_id: string; user_id: string; model_id: string | null;
  model_key: string; model_name: string; kind: string; state: PersistedGenerationState;
  prompt: string; params_json: string; provider_input_json: string;
  credit_cost: number; credits_refunded: number; external_task_id: string | null;
  error_code: string | null; error_message: string | null; error_detail_json: string | null;
  progress: number; batch_id: string | null; batch_index: number; batch_size: number;
  workflow_run_id: string | null; workflow_step_id: string | null; attempt_count: number;
  next_poll_at: string | null; deadline_at: string | null;
  created_at: string; started_at: string | null; completed_at: string | null; updated_at: string;
  user_name?: string | null; user_email?: string | null;
}

interface AssetRow {
  id: string; generation_id: string; file_id: string | null; kind: string; role: string;
  url: string; mime_type: string | null; size_bytes: number | null; width: number | null;
  height: number | null; duration_ms: number | null; position: number; created_at: string;
  gallery_item_id?: string | null;
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

function assetToDto(row: AssetRow): GenerationAsset {
  return {
    id: row.id,
    generationId: row.generation_id,
    kind: row.kind as 'input' | 'output',
    role: row.role,
    // Un asset recopie localement est servi par l'API (URL stable et protegee) ;
    // sinon on renvoie l'URL provider.
    url: row.file_id ? `/api/files/${row.file_id}/content` : row.url,
    remoteUrl: row.url || null,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    position: row.position,
    inGallery: Boolean(row.gallery_item_id),
    galleryItemId: row.gallery_item_id ?? null,
    createdAt: row.created_at,
  };
}

const selectAssets = db.prepare(`
  SELECT a.*, g.id AS gallery_item_id
  FROM generation_assets a
  LEFT JOIN gallery_items g ON g.asset_id = a.id
  WHERE a.generation_id = ?
  ORDER BY a.kind DESC, a.position ASC
`);

export function toGenerationDto(row: GenerationRow): Generation {
  const assets = (selectAssets.all(row.id) as AssetRow[]).map(assetToDto);
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? undefined,
    userEmail: row.user_email ?? undefined,
    modelKey: row.model_key,
    modelName: row.model_name,
    kind: row.kind as Generation['kind'],
    state: row.state,
    prompt: row.prompt,
    params: parseJson<Record<string, unknown>>(row.params_json, {}),
    outputCount: assets.filter((a) => a.kind === 'output').length,
    creditCost: row.credit_cost,
    creditsRefunded: row.credits_refunded,
    externalTaskId: row.external_task_id,
    // `error_detail_json` n'est jamais expose : il reste pour le diagnostic serveur.
    errorCode: row.error_code,
    errorMessage: row.error_message,
    progress: row.progress,
    workflowRunId: row.workflow_run_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    assets,
  };
}

function rowById(generationId: string): GenerationRow | undefined {
  return db.prepare(`
    SELECT g.*, u.name AS user_name, u.email AS user_email
    FROM generations g LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ?
  `).get(generationId) as GenerationRow | undefined;
}

/** Lecture avec controle d'appartenance (isolation des espaces). */
export function getGeneration(generationId: string, viewer: Viewer): Generation {
  const row = rowById(generationId);
  if (!row || row.organization_id !== viewer.organizationId) throw notFound('Generation introuvable.');
  if (viewer.role !== 'admin' && row.user_id !== viewer.userId) {
    throw forbidden("Cette generation appartient a un autre collaborateur.");
  }
  return toGenerationDto(row);
}

/* ------------------------------------------------------------------ */
/* Creation                                                            */
/* ------------------------------------------------------------------ */

export interface CreateGenerationInput {
  viewer: Viewer;
  modelKey: string;
  params: unknown;
  outputCount?: number;
  workflow?: { runId: string; stepId: string };
  /**
   * URL de fichiers deja disponibles (sorties d'une etape de workflow).
   * Elles sont fusionnees avec les fichiers televerses pour construire le
   * payload provider, et comptent dans les bornes min/max du parametre.
   */
  injectedFileUrls?: Record<string, string[]>;
  /** Ignore la limite de generations simultanees (execution de workflow). */
  bypassConcurrencyLimit?: boolean;
}

export interface CreateGenerationResult {
  batchId: string;
  generations: Generation[];
  creditCost: number;
}

/**
 * Cree une demande de generation.
 * ---------------------------------------------------------------------------
 * Deroule :
 *   1. verification du modele (actif) et validation serveur des parametres
 *   2. resolution des fichiers de reference (appartenance verifiee)
 *   3. calcul du cout et verification du solde
 *   4. creation de N lignes `generations` + debit atomique des credits
 *   5. soumission asynchrone au provider (une tache par sortie demandee)
 *
 * Le cout est debite a la reservation puis rembourse automatiquement si
 * aucune sortie n'est produite (echec, annulation, delai depasse).
 */
export function createGeneration(input: CreateGenerationInput): CreateGenerationResult {
  const { viewer } = input;
  const model = getEnabledModel(viewer.organizationId, input.modelKey);
  const settings = getSettings(viewer.organizationId);

  const requested = Math.floor(input.outputCount ?? model.outputs.default);
  if (!Number.isFinite(requested) || requested < model.outputs.min || requested > model.outputs.max) {
    throw badRequest(
      `Le nombre de generations doit etre compris entre ${model.outputs.min} et ${model.outputs.max}.`,
      { outputCount: `Valeur autorisee : ${model.outputs.min} a ${model.outputs.max}.` },
    );
  }

  const running = countRunning(viewer.organizationId, viewer.userId);
  if (!input.bypassConcurrencyLimit && running >= settings.maxConcurrentGenerationsPerUser) {
    throw conflict(
      `Vous avez deja ${running} generation(s) en cours (limite : ${settings.maxConcurrentGenerationsPerUser}). Attendez qu'elles se terminent.`,
    );
  }

  const injected = input.injectedFileUrls ?? {};
  const injectedCounts = Object.fromEntries(
    Object.entries(injected).map(([k, v]) => [k, v.length]),
  );
  const resolved = validateParams(model, input.params, injectedCounts);

  // Resolution des fichiers : garantit que l'utilisateur possede bien chaque
  // fichier reference avant d'en exposer une URL publique signee.
  const fileUrls: Record<string, string[]> = {};
  const inputFileIds: Record<string, string[]> = {};
  for (const [paramId, ids] of Object.entries(resolved.fileIds)) {
    if (!ids.length) continue;
    const { urls, rows } = resolveFileUrls(ids, viewer);
    fileUrls[paramId] = urls;
    inputFileIds[paramId] = rows.map((r) => r.id);
  }
  for (const [paramId, urls] of Object.entries(injected)) {
    if (!urls.length) continue;
    fileUrls[paramId] = [...(fileUrls[paramId] ?? []), ...urls];
  }

  const providerInput = buildProviderInput(model, resolved.values, fileUrls);

  /*
   * Deux facons d'obtenir plusieurs sorties :
   *  - `provider` : le modele en produit plusieurs dans une seule tache
   *    (ex. `max_images` chez Seedream) — une seule ligne, un seul appel ;
   *  - `fanout`   : une tache par sortie, valable pour tous les modeles.
   */
  const providerSideOutputs = model.outputs.mode === 'provider' && Boolean(model.outputs.field);
  if (providerSideOutputs) {
    providerInput[model.outputs.field!] = requested;
  }
  const taskCount = providerSideOutputs ? 1 : requested;
  const unitCost = providerSideOutputs
    ? computeCreditCost(model, resolved.values, requested)
    : computeCreditCost(model, resolved.values, 1);
  const totalCost = unitCost * taskCount;

  assertCanSpend(viewer.userId, totalCost);

  const batchId = id('bat');
  const now = nowIso();
  const deadline = new Date(Date.now() + model.timeoutSeconds * 1000).toISOString();

  const created = tx(() => {
    const ids: string[] = [];
    for (let index = 0; index < taskCount; index += 1) {
      const generationId = id('gen');
      db.prepare(`
        INSERT INTO generations (
          id, organization_id, user_id, model_id, model_key, model_name, kind, state,
          prompt, params_json, provider_input_json, credit_cost, external_task_id,
          progress, batch_id, batch_index, batch_size, workflow_run_id, workflow_step_id,
          next_poll_at, deadline_at, created_at, updated_at
        ) VALUES (
          @id, @organizationId, @userId, @modelId, @modelKey, @modelName, @kind, 'queued',
          @prompt, @params, @providerInput, @creditCost, NULL,
          0, @batchId, @batchIndex, @batchSize, @workflowRunId, @workflowStepId,
          @nextPollAt, @deadlineAt, @now, @now
        )
      `).run({
        id: generationId,
        organizationId: viewer.organizationId,
        userId: viewer.userId,
        modelId: model.id,
        modelKey: model.key,
        modelName: model.name,
        kind: model.kind,
        prompt: resolved.prompt,
        params: JSON.stringify(resolved.values),
        providerInput: JSON.stringify(providerInput),
        creditCost: unitCost,
        batchId,
        batchIndex: index,
        batchSize: taskCount,
        workflowRunId: input.workflow?.runId ?? null,
        workflowStepId: input.workflow?.stepId ?? null,
        nextPollAt: now,
        deadlineAt: deadline,
        now,
      });

      // Traçabilite des references utilisees pour cette generation.
      let position = 0;
      for (const [paramId, ids2] of Object.entries(inputFileIds)) {
        for (const fileId of ids2) {
          const file = getFileRow(fileId);
          db.prepare(`
            INSERT INTO generation_assets (id, generation_id, file_id, kind, role, url,
                                           mime_type, size_bytes, position, created_at)
            VALUES (?, ?, ?, 'input', ?, '', ?, ?, ?, ?)
          `).run(id('ast'), generationId, fileId, paramId, file?.mime_type ?? null, file?.size_bytes ?? null, position, now);
          position += 1;
        }
      }
      ids.push(generationId);
    }

    applyLedgerEntry({
      organizationId: viewer.organizationId,
      userId: viewer.userId,
      type: 'debit',
      amount: totalCost,
      reason: `Generation ${model.name} (${requested} sortie${requested > 1 ? 's' : ''})`,
      generationId: ids[0],
      modelKey: model.key,
      actorUserId: viewer.userId,
    });

    return ids;
  });

  // Soumission au provider hors transaction : une erreur reseau ne doit pas
  // annuler la trace de la demande, elle bascule la generation en `failed`.
  for (const generationId of created) {
    void submitToProvider(generationId, model).catch((error) => {
      logger.error('Soumission au provider impossible', { generationId, error: String(error) });
    });
  }

  return {
    batchId,
    generations: created.map((gid) => toGenerationDto(rowById(gid)!)),
    creditCost: totalCost,
  };
}

export function countRunning(organizationId: string, userId: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM generations
     WHERE organization_id = ? AND user_id = ? AND state IN ('queued','processing')`,
  ).get(organizationId, userId) as { c: number };
  return row.c;
}

/* ------------------------------------------------------------------ */
/* Soumission provider                                                 */
/* ------------------------------------------------------------------ */

/** URL de callback signee : le provider ne peut pas usurper une generation. */
export function callbackUrlFor(generationId: string): string {
  return `${env.publicBaseUrl}/api/webhooks/kie/${generationId}?signature=${signPayload(`callback.${generationId}`)}`;
}

/**
 * Reserve la soumission d'une generation.
 * La soumission peut etre declenchee simultanement par la creation et par le
 * worker de sondage. Cette mise a jour conditionnelle est atomique : une seule
 * des deux tentatives passe, ce qui garantit qu'une seule tache est creee chez
 * le provider (et donc facturee une seule fois).
 * `staleAfterMs` permet de reprendre une soumission interrompue par un arret
 * du processus.
 */
function claimForSubmission(generationId: string, staleAfterMs = 60_000): boolean {
  const staleBefore = new Date(Date.now() - staleAfterMs).toISOString();
  const result = db.prepare(`
    UPDATE generations SET started_at = ?, updated_at = ?
    WHERE id = ? AND state = 'queued' AND external_task_id IS NULL
      AND (started_at IS NULL OR started_at < ?)
  `).run(nowIso(), nowIso(), generationId, staleBefore);
  return result.changes === 1;
}

export async function submitToProvider(generationId: string, preloaded?: ModelSummary): Promise<void> {
  const row = rowById(generationId);
  if (!row || row.state !== 'queued' || row.external_task_id) return;
  if (!claimForSubmission(generationId)) return;

  const payload = parseJson<Record<string, unknown>>(row.provider_input_json, {});

  try {
    // Resolu ici (et non avant) pour qu'une desactivation du modele entre la
    // creation et la soumission fasse echouer proprement la generation, avec
    // remboursement, plutot que de la laisser en attente jusqu'au delai maximum.
    const model = preloaded ?? getEnabledModel(row.organization_id, row.model_key);
    const task = await kie.createTask({
      organizationId: row.organization_id,
      transport: model.transport,
      model: model.providerModel,
      payload,
      callbackUrl: callbackUrlFor(generationId),
    });
    db.prepare(`
      UPDATE generations
      SET external_task_id = ?, progress = 10, next_poll_at = ?, updated_at = ?
      WHERE id = ? AND state = 'queued'
    `).run(task.taskId, new Date(Date.now() + env.pollIntervalMs).toISOString(), nowIso(), generationId);
    logger.info('Tache provider creee', { generationId, taskId: task.taskId, model: model.providerModel });
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError('provider_error', "Le lancement de la generation a echoue.", { internal: error });
    failGeneration(generationId, appError.code, appError.message, appError.internal ?? String(error));
  }
}

/* ------------------------------------------------------------------ */
/* Transitions d'etat                                                  */
/* ------------------------------------------------------------------ */

/**
 * Rembourse integralement une generation qui n'a produit aucun resultat.
 * Idempotent : un remboursement deja effectue n'est jamais rejoue.
 */
function refundIfUnproductive(row: GenerationRow, reason: string): void {
  if (row.credits_refunded > 0 || row.credit_cost <= 0) return;
  const outputs = db.prepare(
    "SELECT COUNT(*) AS c FROM generation_assets WHERE generation_id = ? AND kind = 'output'",
  ).get(row.id) as { c: number };
  if (outputs.c > 0) return; // des resultats existent : le cout reste du.

  applyLedgerEntry({
    organizationId: row.organization_id,
    userId: row.user_id,
    type: 'refund',
    amount: row.credit_cost,
    reason,
    generationId: row.id,
    modelKey: row.model_key,
  });
  db.prepare('UPDATE generations SET credits_refunded = ? WHERE id = ?').run(row.credit_cost, row.id);
}

export function failGeneration(
  generationId: string,
  code: string,
  userMessage: string,
  internalDetail: unknown,
): void {
  const row = rowById(generationId);
  if (!row || ['completed', 'failed', 'cancelled'].includes(row.state)) return;

  tx(() => {
    db.prepare(`
      UPDATE generations
      SET state = 'failed', error_code = ?, error_message = ?, error_detail_json = ?,
          completed_at = ?, updated_at = ?, next_poll_at = NULL, progress = 100
      WHERE id = ?
    `).run(
      code,
      userMessage.slice(0, 400),
      JSON.stringify({ detail: internalDetail, at: nowIso() }).slice(0, 8000),
      nowIso(), nowIso(), generationId,
    );
    refundIfUnproductive(row, 'Remboursement : generation echouee');
  });
  logger.warn('Generation en echec', { generationId, code });
}

export function cancelGeneration(generationId: string, viewer: Viewer): Generation {
  const row = rowById(generationId);
  if (!row || row.organization_id !== viewer.organizationId) throw notFound('Generation introuvable.');
  if (viewer.role !== 'admin' && row.user_id !== viewer.userId) {
    throw forbidden("Cette generation appartient a un autre collaborateur.");
  }
  if (['completed', 'failed', 'cancelled'].includes(row.state)) {
    throw conflict('Cette generation est deja terminee.');
  }

  tx(() => {
    db.prepare(`
      UPDATE generations SET state = 'cancelled', completed_at = ?, updated_at = ?,
             next_poll_at = NULL, progress = 100, error_message = ?
      WHERE id = ?
    `).run(nowIso(), nowIso(), "Generation annulee par l'utilisateur.", generationId);
    refundIfUnproductive(row, 'Remboursement : generation annulee');
  });

  return toGenerationDto(rowById(generationId)!);
}

/* ------------------------------------------------------------------ */
/* Reconciliation avec le provider                                     */
/* ------------------------------------------------------------------ */

/**
 * Transport a utiliser pour suivre une generation.
 * Si le modele a ete supprime du catalogue depuis, on retombe sur l'API Jobs,
 * qui couvre la majorite des modeles.
 */
function transportOf(row: GenerationRow): TransportKey {
  try {
    return getModelByKey(row.organization_id, row.model_key).transport;
  } catch {
    return 'jobs';
  }
}

const PROGRESS_BY_STATE: Record<kie.ProviderState, number> = {
  waiting: 15, queuing: 25, generating: 60, success: 100, fail: 100,
};

/**
 * Applique l'etat renvoye par le provider a une generation.
 * Appele par le worker de sondage ET par le webhook de callback.
 */
export async function syncGeneration(generationId: string): Promise<void> {
  const row = rowById(generationId);
  if (!row || !['queued', 'processing'].includes(row.state)) return;

  if (!row.external_task_id) {
    // Soumission pas encore aboutie. `submitToProvider` ne relance rien si une
    // soumission est deja en cours (reservation atomique) ; il reprend en
    // revanche une soumission interrompue par un arret du processus.
    if (row.attempt_count >= 3) {
      failGeneration(generationId, 'provider_error', "Le lancement de la generation a echoue.", {
        reason: 'no_task_id_after_retries',
      });
      return;
    }
    db.prepare('UPDATE generations SET attempt_count = attempt_count + 1, next_poll_at = ? WHERE id = ?')
      .run(new Date(Date.now() + env.pollIntervalMs).toISOString(), generationId);
    await submitToProvider(generationId);
    return;
  }

  if (row.deadline_at && new Date(row.deadline_at).getTime() < Date.now()) {
    failGeneration(
      generationId,
      'provider_timeout',
      "La generation a depasse le delai maximum et a ete interrompue. Les credits ont ete rembourses.",
      { deadline: row.deadline_at, taskId: row.external_task_id },
    );
    return;
  }

  let record: kie.TaskRecord;
  try {
    // Le transport est resolu depuis le modele : les endpoints dedies (Veo,
    // Suno) n'ont pas la meme URL de suivi que l'API Jobs.
    record = await kie.getTask(row.organization_id, row.external_task_id, transportOf(row));
  } catch (error) {
    const attempts = row.attempt_count + 1;
    db.prepare('UPDATE generations SET attempt_count = ?, next_poll_at = ?, updated_at = ? WHERE id = ?')
      .run(attempts, new Date(Date.now() + Math.min(60_000, 5_000 * attempts)).toISOString(), nowIso(), generationId);
    // Les erreurs transitoires n'invalident pas la generation : seul le delai
    // maximum (deadline) fait basculer en echec.
    if (attempts >= 20) {
      const appError = error instanceof AppError ? error : null;
      failGeneration(
        generationId,
        appError?.code ?? 'provider_error',
        appError?.message ?? "Le suivi de la generation a echoue.",
        { error: String(error) },
      );
    }
    return;
  }

  if (record.state === 'fail') {
    failGeneration(
      generationId,
      'provider_error',
      record.failMessage
        ? `La generation a echoue : ${record.failMessage}`
        : 'La generation a echoue chez le fournisseur de modeles.',
      { failCode: record.failCode, failMessage: record.failMessage, taskId: record.taskId },
    );
    return;
  }

  if (record.state === 'success') {
    await completeGeneration(row, record);
    return;
  }

  const state: PersistedGenerationState = record.state === 'waiting' ? 'queued' : 'processing';
  db.prepare(`
    UPDATE generations SET state = ?, progress = ?, attempt_count = 0, next_poll_at = ?, updated_at = ?
    WHERE id = ? AND state IN ('queued','processing')
  `).run(
    state, PROGRESS_BY_STATE[record.state],
    new Date(Date.now() + env.pollIntervalMs).toISOString(), nowIso(), generationId,
  );
}

async function completeGeneration(row: GenerationRow, record: kie.TaskRecord): Promise<void> {
  if (record.resultUrls.length === 0) {
    failGeneration(row.id, 'provider_error', "Le fournisseur n'a renvoye aucun resultat exploitable.", {
      taskId: record.taskId,
    });
    return;
  }

  // Recopie locale (best effort) avant enregistrement, pour que la galerie
  // reste consultable si l'URL provider expire.
  const assets: Array<{ url: string; fileId: string | null; mime: string | null; size: number | null }> = [];
  for (const url of record.resultUrls) {
    const mirrored = await mirrorRemoteFile({
      organizationId: row.organization_id,
      userId: row.user_id,
      url,
    });
    assets.push({
      url,
      fileId: mirrored?.id ?? null,
      mime: mirrored?.mimeType ?? null,
      size: mirrored?.sizeBytes ?? null,
    });
  }

  const current = rowById(row.id);
  if (!current || ['completed', 'failed', 'cancelled'].includes(current.state)) return;

  tx(() => {
    let position = 0;
    for (const asset of assets) {
      db.prepare(`
        INSERT INTO generation_assets (id, generation_id, file_id, kind, role, url,
                                       mime_type, size_bytes, position, created_at)
        VALUES (?, ?, ?, 'output', 'result', ?, ?, ?, ?, ?)
      `).run(id('ast'), row.id, asset.fileId, asset.url, asset.mime, asset.size, position, nowIso());
      position += 1;
    }
    db.prepare(`
      UPDATE generations SET state = 'completed', progress = 100, completed_at = ?,
             updated_at = ?, next_poll_at = NULL, error_code = NULL, error_message = NULL
      WHERE id = ?
    `).run(nowIso(), nowIso(), row.id);
  });

  logger.info('Generation terminee', { generationId: row.id, outputs: assets.length });
}

/** Selectionne les generations a sonder lors d'un tick du worker. */
export function dueForPolling(limit: number): string[] {
  const rows = db.prepare(`
    SELECT id FROM generations
    WHERE state IN ('queued','processing')
      AND (next_poll_at IS NULL OR next_poll_at <= ?)
    ORDER BY next_poll_at ASC LIMIT ?
  `).all(nowIso(), limit) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------ */
/* Listes                                                              */
/* ------------------------------------------------------------------ */

export interface ListGenerationsOptions {
  organizationId: string;
  /** null => toutes (administrateur uniquement) */
  userId: string | null;
  state?: PersistedGenerationState;
  modelKey?: string;
  kind?: string;
  search?: string;
  from?: string;
  to?: string;
  sort?: 'recent' | 'oldest' | 'cost';
  page?: number;
  pageSize?: number;
}

export function listGenerations(opts: ListGenerationsOptions) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 24));
  const where = ['g.organization_id = @organizationId'];
  const params: Record<string, unknown> = { organizationId: opts.organizationId };

  if (opts.userId) { where.push('g.user_id = @userId'); params.userId = opts.userId; }
  if (opts.state) { where.push('g.state = @state'); params.state = opts.state; }
  if (opts.modelKey) { where.push('g.model_key = @modelKey'); params.modelKey = opts.modelKey; }
  if (opts.kind) { where.push('g.kind = @kind'); params.kind = opts.kind; }
  if (opts.from) { where.push('g.created_at >= @from'); params.from = opts.from; }
  if (opts.to) { where.push('g.created_at <= @to'); params.to = opts.to; }
  if (opts.search) {
    where.push('(g.prompt LIKE @search OR g.model_name LIKE @search)');
    params.search = `%${opts.search}%`;
  }
  const clause = where.join(' AND ');
  const orderBy = { recent: 'g.created_at DESC', oldest: 'g.created_at ASC', cost: 'g.credit_cost DESC' }[
    opts.sort ?? 'recent'
  ];

  const total = db.prepare(`SELECT COUNT(*) AS c FROM generations g WHERE ${clause}`).get(params) as { c: number };
  const rows = db.prepare(`
    SELECT g.*, u.name AS user_name, u.email AS user_email
    FROM generations g LEFT JOIN users u ON u.id = g.user_id
    WHERE ${clause} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as GenerationRow[];

  return {
    items: rows.map(toGenerationDto),
    total: total.c,
    page,
    pageSize,
    hasMore: page * pageSize < total.c,
  };
}

export function deleteGeneration(generationId: string, viewer: Viewer): void {
  const row = rowById(generationId);
  if (!row || row.organization_id !== viewer.organizationId) throw notFound('Generation introuvable.');
  if (viewer.role !== 'admin' && row.user_id !== viewer.userId) {
    throw forbidden("Cette generation appartient a un autre collaborateur.");
  }
  if (['queued', 'processing'].includes(row.state)) {
    throw conflict('Annulez la generation avant de la supprimer.');
  }
  const files = db.prepare(
    "SELECT file_id FROM generation_assets WHERE generation_id = ? AND kind = 'output' AND file_id IS NOT NULL",
  ).all(generationId) as Array<{ file_id: string }>;

  tx(() => {
    db.prepare('DELETE FROM generations WHERE id = ?').run(generationId);
  });
  // Fichiers de sortie associes (les references televersees sont conservees).
  for (const f of files) deleteFileById(f.file_id);
}

export { toStoredFile };
