import {
  computeCreditCost,
  type Workflow,
  type WorkflowInputBinding,
  type WorkflowRun,
  type WorkflowRunSummary,
  type WorkflowStep,
  type WorkflowStepRun,
} from '@nova/shared';
import { db, nowIso, parseJson, tx } from '../db/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { id } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { assertCanSpend } from './credits.js';
import { signedPublicUrl } from './files.js';
import { cancelGeneration, createGeneration, toGenerationDto, type Viewer } from './generations.js';
import { getEnabledModel } from './models.js';
import { validateParams } from './paramValidation.js';

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

interface WorkflowRow {
  id: string; organization_id: string; user_id: string; name: string; description: string;
  created_at: string; updated_at: string; user_name?: string | null;
}
interface StepRow {
  id: string; workflow_id: string; position: number; name: string; type: string;
  model_key: string; prompt: string; params_json: string; inputs_json: string; created_at: string;
}

function stepToDto(row: StepRow, modelName?: string): WorkflowStep {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    position: row.position,
    name: row.name,
    type: 'generation',
    modelKey: row.model_key,
    modelName,
    prompt: row.prompt,
    params: parseJson<Record<string, unknown>>(row.params_json, {}),
    inputs: parseJson<WorkflowInputBinding[]>(row.inputs_json, []),
  };
}

function loadSteps(workflowId: string): StepRow[] {
  return db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY position ASC')
    .all(workflowId) as StepRow[];
}

function estimateCredits(organizationId: string, steps: StepRow[]): number {
  let total = 0;
  for (const step of steps) {
    try {
      const model = getEnabledModel(organizationId, step.model_key);
      total += computeCreditCost(model, parseJson<Record<string, unknown>>(step.params_json, {}), 1);
    } catch {
      // Modele desactive ou supprime : ignore dans l'estimation, signale a l'execution.
    }
  }
  return total;
}

function workflowToDto(row: WorkflowRow): Workflow {
  const steps = loadSteps(row.id);
  const lastRun = db.prepare(
    'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1',
  ).get(row.id) as RunRow | undefined;
  const runCount = (db.prepare('SELECT COUNT(*) AS c FROM workflow_runs WHERE workflow_id = ?')
    .get(row.id) as { c: number }).c;

  const modelNames = new Map<string, string>();
  for (const step of steps) {
    if (modelNames.has(step.model_key)) continue;
    try {
      modelNames.set(step.model_key, getEnabledModel(row.organization_id, step.model_key).name);
    } catch {
      modelNames.set(step.model_key, step.model_key);
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? undefined,
    name: row.name,
    description: row.description,
    steps: steps.map((s) => stepToDto(s, modelNames.get(s.model_key))),
    estimatedCredits: estimateCredits(row.organization_id, steps),
    lastRun: lastRun ? runSummaryToDto(lastRun) : null,
    runCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWorkflows(organizationId: string, userId: string | null): Workflow[] {
  const rows = db.prepare(`
    SELECT w.*, u.name AS user_name FROM workflows w LEFT JOIN users u ON u.id = w.user_id
    WHERE w.organization_id = @organizationId
      ${userId ? 'AND w.user_id = @userId' : ''}
    ORDER BY w.updated_at DESC
  `).all(userId ? { organizationId, userId } : { organizationId }) as WorkflowRow[];
  return rows.map(workflowToDto);
}

export function getWorkflow(workflowId: string, viewer: Viewer): Workflow {
  const row = db.prepare(`
    SELECT w.*, u.name AS user_name FROM workflows w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = ?
  `).get(workflowId) as WorkflowRow | undefined;
  if (!row || row.organization_id !== viewer.organizationId) throw notFound('Workflow introuvable.');
  if (viewer.role !== 'admin' && row.user_id !== viewer.userId) {
    throw forbidden('Ce workflow appartient a un autre collaborateur.');
  }
  return workflowToDto(row);
}

function requireOwnedWorkflow(workflowId: string, viewer: Viewer): WorkflowRow {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as WorkflowRow | undefined;
  if (!row || row.organization_id !== viewer.organizationId) throw notFound('Workflow introuvable.');
  if (row.user_id !== viewer.userId) throw forbidden('Ce workflow appartient a un autre collaborateur.');
  return row;
}

/* ------------------------------------------------------------------ */
/* Ecriture                                                            */
/* ------------------------------------------------------------------ */

export interface StepInput {
  name: string;
  modelKey: string;
  prompt?: string;
  params?: Record<string, unknown>;
  inputs?: WorkflowInputBinding[];
}

export interface WorkflowInput {
  name: string;
  description?: string;
  steps: StepInput[];
}

/**
 * Valide la structure d'un workflow.
 * Chaque etape est validee contre la definition de son modele : un workflow
 * enregistre est donc toujours executable (sauf desactivation ulterieure du
 * modele, cas gere a l'execution).
 */
function validateWorkflowInput(organizationId: string, input: WorkflowInput): void {
  const fields: Record<string, string> = {};
  if (!input.name?.trim()) fields.name = 'Nom obligatoire.';
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    fields.steps = 'Un workflow doit comporter au moins une etape.';
  }
  if (input.steps?.length > 10) fields.steps = '10 etapes au maximum.';

  input.steps?.forEach((step, index) => {
    if (!step.name?.trim()) fields[`steps.${index}.name`] = "Nom de l'etape obligatoire.";
    let model;
    try {
      model = getEnabledModel(organizationId, step.modelKey);
    } catch {
      fields[`steps.${index}.modelKey`] = 'Modele inconnu ou desactive.';
      return;
    }
    for (const binding of step.inputs ?? []) {
      const spec = model.params.find((p) => p.id === binding.paramId);
      if (!spec || spec.type !== 'files') {
        fields[`steps.${index}.inputs`] = `Le parametre "${binding.paramId}" n'accepte pas de fichier.`;
        continue;
      }
      if (binding.source === 'step') {
        if (binding.stepIndex === undefined || binding.stepIndex < 0 || binding.stepIndex >= index) {
          fields[`steps.${index}.inputs`] =
            'Une etape ne peut reprendre que les sorties d une etape precedente.';
        }
      }
    }
    // Les parametres sont valides en tenant compte des fichiers injectes par
    // les liaisons d'entree (ils ne sont pas connus a la sauvegarde).
    const injected = Object.fromEntries(
      (step.inputs ?? []).map((b) => [b.paramId, b.limit ?? 1]),
    );
    try {
      validateParams(model, { ...(step.params ?? {}), prompt: step.prompt ?? '' }, injected);
    } catch (error) {
      if (error instanceof AppError && error.fields) {
        for (const [key, message] of Object.entries(error.fields)) {
          fields[`steps.${index}.params.${key}`] = message;
        }
      } else {
        fields[`steps.${index}.params`] = 'Parametres invalides pour ce modele.';
      }
    }
  });

  if (Object.keys(fields).length) throw badRequest('Workflow invalide.', fields);
}

function writeSteps(workflowId: string, steps: StepInput[]): void {
  db.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').run(workflowId);
  steps.forEach((step, index) => {
    db.prepare(`
      INSERT INTO workflow_steps (id, workflow_id, position, name, type, model_key, prompt,
                                  params_json, inputs_json, created_at)
      VALUES (?, ?, ?, ?, 'generation', ?, ?, ?, ?, ?)
    `).run(
      id('wfs'), workflowId, index, step.name.trim().slice(0, 120), step.modelKey,
      (step.prompt ?? '').slice(0, 5000),
      JSON.stringify(step.params ?? {}),
      JSON.stringify(step.inputs ?? []),
      nowIso(),
    );
  });
}

export function createWorkflow(input: WorkflowInput, viewer: Viewer): Workflow {
  validateWorkflowInput(viewer.organizationId, input);
  const workflowId = id('wkf');
  tx(() => {
    db.prepare(`
      INSERT INTO workflows (id, organization_id, user_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflowId, viewer.organizationId, viewer.userId, input.name.trim().slice(0, 120),
      (input.description ?? '').slice(0, 500), nowIso(), nowIso(),
    );
    writeSteps(workflowId, input.steps);
  });
  return getWorkflow(workflowId, viewer);
}

export function updateWorkflow(workflowId: string, input: WorkflowInput, viewer: Viewer): Workflow {
  requireOwnedWorkflow(workflowId, viewer);
  validateWorkflowInput(viewer.organizationId, input);
  tx(() => {
    db.prepare('UPDATE workflows SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
      input.name.trim().slice(0, 120), (input.description ?? '').slice(0, 500), nowIso(), workflowId,
    );
    writeSteps(workflowId, input.steps);
  });
  return getWorkflow(workflowId, viewer);
}

export function duplicateWorkflow(workflowId: string, viewer: Viewer): Workflow {
  const source = getWorkflow(workflowId, viewer);
  return createWorkflow(
    {
      name: `${source.name} (copie)`.slice(0, 120),
      description: source.description,
      steps: source.steps.map((s) => ({
        name: s.name,
        modelKey: s.modelKey,
        prompt: s.prompt,
        params: s.params,
        inputs: s.inputs,
      })),
    },
    viewer,
  );
}

export function deleteWorkflow(workflowId: string, viewer: Viewer): void {
  requireOwnedWorkflow(workflowId, viewer);
  const running = db.prepare(
    "SELECT COUNT(*) AS c FROM workflow_runs WHERE workflow_id = ? AND state IN ('queued','running')",
  ).get(workflowId) as { c: number };
  if (running.c > 0) throw conflict('Une execution est en cours. Attendez sa fin avant de supprimer.');
  db.prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

interface RunRow {
  id: string; organization_id: string; user_id: string; workflow_id: string; state: string;
  current_step: number; total_steps: number; credit_cost: number; error_message: string | null;
  context_json: string; created_at: string; started_at: string | null; finished_at: string | null;
  workflow_name?: string | null;
}
interface StepRunRow {
  id: string; run_id: string; step_id: string; position: number; name: string; model_key: string;
  state: string; generation_id: string | null; error_message: string | null;
  started_at: string | null; finished_at: string | null;
}

function runSummaryToDto(row: RunRow): WorkflowRunSummary {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name ?? undefined,
    userId: row.user_id,
    state: row.state as WorkflowRunSummary['state'],
    currentStep: row.current_step,
    totalSteps: row.total_steps,
    errorMessage: row.error_message,
    creditCost: row.credit_cost,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

function stepRunToDto(row: StepRunRow): WorkflowStepRun {
  const generationRow = row.generation_id
    ? (db.prepare(`
        SELECT g.*, u.name AS user_name, u.email AS user_email
        FROM generations g LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ?
      `).get(row.generation_id) as Parameters<typeof toGenerationDto>[0] | undefined)
    : undefined;
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    position: row.position,
    name: row.name,
    modelKey: row.model_key,
    state: row.state as WorkflowStepRun['state'],
    generationId: row.generation_id,
    generation: generationRow ? toGenerationDto(generationRow) : null,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function getRun(runId: string, viewer: Viewer): WorkflowRun {
  const row = db.prepare(`
    SELECT r.*, w.name AS workflow_name FROM workflow_runs r
    LEFT JOIN workflows w ON w.id = r.workflow_id WHERE r.id = ?
  `).get(runId) as RunRow | undefined;
  if (!row || row.organization_id !== viewer.organizationId) throw notFound('Execution introuvable.');
  if (viewer.role !== 'admin' && row.user_id !== viewer.userId) {
    throw forbidden('Cette execution appartient a un autre collaborateur.');
  }
  const steps = db.prepare('SELECT * FROM workflow_step_runs WHERE run_id = ? ORDER BY position ASC')
    .all(runId) as StepRunRow[];
  return { ...runSummaryToDto(row), steps: steps.map(stepRunToDto) };
}

export function listRuns(organizationId: string, userId: string | null, limit = 30): WorkflowRunSummary[] {
  const rows = db.prepare(`
    SELECT r.*, w.name AS workflow_name FROM workflow_runs r
    LEFT JOIN workflows w ON w.id = r.workflow_id
    WHERE r.organization_id = @organizationId
      ${userId ? 'AND r.user_id = @userId' : ''}
    ORDER BY r.created_at DESC LIMIT ${Math.min(200, Math.max(1, limit))}
  `).all(userId ? { organizationId, userId } : { organizationId }) as RunRow[];
  return rows.map(runSummaryToDto);
}

export interface StartRunInput {
  workflowId: string;
  /** Fichiers televerses au lancement, par identifiant de parametre. */
  uploads?: Record<string, string[]>;
  /** Surcharge ponctuelle du prompt global (substitue a {{input.prompt}}). */
  prompt?: string;
}

/**
 * Lance l'execution d'un workflow.
 * Les etapes sont executees sequentiellement : chaque etape cree une
 * generation, et la suivante demarre lorsque la precedente est terminee
 * (progression assuree par `advanceRun`, appelee par le worker).
 */
export function startRun(input: StartRunInput, viewer: Viewer): WorkflowRun {
  const workflow = requireOwnedWorkflow(input.workflowId, viewer);
  const steps = loadSteps(workflow.id);
  if (steps.length === 0) throw badRequest('Ce workflow ne comporte aucune etape.');

  const active = db.prepare(
    "SELECT COUNT(*) AS c FROM workflow_runs WHERE workflow_id = ? AND state IN ('queued','running')",
  ).get(workflow.id) as { c: number };
  if (active.c > 0) throw conflict('Ce workflow est deja en cours d execution.');

  const estimated = estimateCredits(viewer.organizationId, steps);
  assertCanSpend(viewer.userId, estimated);

  const runId = id('wrn');
  tx(() => {
    db.prepare(`
      INSERT INTO workflow_runs (id, organization_id, user_id, workflow_id, state, current_step,
                                 total_steps, credit_cost, context_json, created_at, started_at)
      VALUES (?, ?, ?, ?, 'queued', 0, ?, 0, ?, ?, ?)
    `).run(
      runId, viewer.organizationId, viewer.userId, workflow.id, steps.length,
      JSON.stringify({ uploads: input.uploads ?? {}, prompt: input.prompt ?? '', outputs: {} }),
      nowIso(), nowIso(),
    );
    for (const step of steps) {
      db.prepare(`
        INSERT INTO workflow_step_runs (id, run_id, step_id, position, name, model_key, state)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(id('wsr'), runId, step.id, step.position, step.name, step.model_key);
    }
  });

  launchStep(runId, 0);
  return getRun(runId, viewer);
}

interface RunContext {
  uploads: Record<string, string[]>;
  prompt: string;
  /** URL des sorties de chaque etape terminee, indexees par position. */
  outputs: Record<string, string[]>;
}

/** Remplace {{input.prompt}} et {{stepN.prompt}} dans le prompt d'une etape. */
function interpolate(template: string, context: RunContext, steps: StepRow[]): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, expr: string) => {
    if (expr === 'input.prompt') return context.prompt;
    const stepMatch = /^step(\d+)\.prompt$/.exec(expr);
    if (stepMatch) {
      const index = Number.parseInt(stepMatch[1], 10) - 1;
      return steps[index]?.prompt ?? '';
    }
    return match;
  });
}

/** Cree la generation correspondant a une etape et met a jour son etat. */
function launchStep(runId: string, position: number): void {
  const run = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId) as RunRow | undefined;
  if (!run || !['queued', 'running'].includes(run.state)) return;

  const steps = loadSteps(run.workflow_id);
  const step = steps[position];
  const stepRun = db.prepare('SELECT * FROM workflow_step_runs WHERE run_id = ? AND position = ?')
    .get(runId, position) as StepRunRow | undefined;
  if (!step || !stepRun) {
    finishRun(runId, 'completed', null);
    return;
  }

  const context = parseJson<RunContext>(run.context_json, { uploads: {}, prompt: '', outputs: {} });
  const viewer: Viewer = { organizationId: run.organization_id, userId: run.user_id, role: 'collaborator' };

  // Resolution des entrees : fichiers televerses au lancement ou sorties d'une
  // etape precedente.
  const uploadIds: Record<string, string[]> = {};
  const injectedUrls: Record<string, string[]> = {};
  for (const binding of parseJson<WorkflowInputBinding[]>(step.inputs_json, [])) {
    if (binding.source === 'upload') {
      const ids = context.uploads[binding.paramId] ?? [];
      if (ids.length) uploadIds[binding.paramId] = ids.slice(0, binding.limit ?? ids.length);
    } else {
      const produced = context.outputs[String(binding.stepIndex ?? position - 1)] ?? [];
      if (produced.length) {
        injectedUrls[binding.paramId] = produced.slice(0, binding.limit ?? 1);
      }
    }
  }

  const params: Record<string, unknown> = {
    ...parseJson<Record<string, unknown>>(step.params_json, {}),
    ...uploadIds,
  };
  const prompt = interpolate(step.prompt, context, steps);
  if (prompt) params.prompt = prompt;

  db.prepare("UPDATE workflow_runs SET state = 'running', current_step = ?, error_message = NULL WHERE id = ?")
    .run(position, runId);

  try {
    const result = createGeneration({
      viewer,
      modelKey: step.model_key,
      params,
      outputCount: 1,
      workflow: { runId, stepId: step.id },
      injectedFileUrls: injectedUrls,
      bypassConcurrencyLimit: true,
    });
    const generation = result.generations[0];
    db.prepare(`
      UPDATE workflow_step_runs SET state = 'queued', generation_id = ?, started_at = ?, error_message = NULL
      WHERE id = ?
    `).run(generation.id, nowIso(), stepRun.id);
    db.prepare('UPDATE workflow_runs SET credit_cost = credit_cost + ? WHERE id = ?')
      .run(result.creditCost, runId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "L'etape n'a pas pu etre lancee.";
    db.prepare(`
      UPDATE workflow_step_runs SET state = 'failed', error_message = ?, finished_at = ? WHERE id = ?
    `).run(message, nowIso(), stepRun.id);
    finishRun(runId, 'failed', message);
    logger.warn('Etape de workflow non lancee', { runId, position, error: String(error) });
  }
}

function finishRun(runId: string, state: 'completed' | 'failed' | 'cancelled', error: string | null): void {
  db.prepare('UPDATE workflow_runs SET state = ?, error_message = ?, finished_at = ? WHERE id = ?')
    .run(state, error, nowIso(), runId);
}

/**
 * Fait progresser les executions en cours.
 * Appelee a chaque tick du worker, apres synchronisation des generations.
 */
export function advanceRuns(): void {
  const runs = db.prepare("SELECT * FROM workflow_runs WHERE state IN ('queued','running')")
    .all() as RunRow[];

  for (const run of runs) {
    const stepRuns = db.prepare('SELECT * FROM workflow_step_runs WHERE run_id = ? ORDER BY position ASC')
      .all(run.id) as StepRunRow[];
    const current = stepRuns.find((s) => s.position === run.current_step);
    if (!current || !current.generation_id) continue;

    const generation = db.prepare('SELECT * FROM generations WHERE id = ?')
      .get(current.generation_id) as { state: string; error_message: string | null } | undefined;
    if (!generation) continue;
    if (['queued', 'processing'].includes(generation.state)) {
      if (current.state !== generation.state) {
        db.prepare('UPDATE workflow_step_runs SET state = ? WHERE id = ?').run(generation.state, current.id);
      }
      continue;
    }

    if (generation.state !== 'completed') {
      db.prepare('UPDATE workflow_step_runs SET state = ?, error_message = ?, finished_at = ? WHERE id = ?')
        .run(generation.state, generation.error_message, nowIso(), current.id);
      finishRun(
        run.id,
        generation.state === 'cancelled' ? 'cancelled' : 'failed',
        generation.error_message ?? "L'etape a echoue.",
      );
      continue;
    }

    // Etape terminee : ses sorties alimentent le contexte pour la suivante.
    const outputs = db.prepare(
      "SELECT file_id, url FROM generation_assets WHERE generation_id = ? AND kind = 'output' ORDER BY position ASC",
    ).all(current.generation_id) as Array<{ file_id: string | null; url: string }>;

    const context = parseJson<RunContext>(run.context_json, { uploads: {}, prompt: '', outputs: {} });
    context.outputs[String(current.position)] = outputs.map((o) =>
      // Une sortie recopiee localement est exposee via une URL signee (le
      // provider doit pouvoir la telecharger a l'etape suivante).
      o.file_id ? signedPublicUrl(o.file_id) : o.url,
    );

    db.prepare('UPDATE workflow_step_runs SET state = ?, finished_at = ? WHERE id = ?')
      .run('completed', nowIso(), current.id);
    db.prepare('UPDATE workflow_runs SET context_json = ? WHERE id = ?')
      .run(JSON.stringify(context), run.id);

    const next = current.position + 1;
    if (next >= run.total_steps) finishRun(run.id, 'completed', null);
    else launchStep(run.id, next);
  }
}

export function cancelRun(runId: string, viewer: Viewer): WorkflowRun {
  const run = getRun(runId, viewer);
  if (!['queued', 'running'].includes(run.state)) throw conflict('Cette execution est deja terminee.');
  const current = run.steps.find((s) => s.position === run.currentStep);
  if (current?.generationId) {
    // Le remboursement de la generation en cours est gere par le moteur de
    // generation (aucun credit n'est retenu si rien n'a ete produit).
    try {
      cancelGeneration(current.generationId, viewer);
    } catch {
      // La generation etait deja terminee : rien a annuler.
    }
  }
  finishRun(runId, 'cancelled', "Execution annulee par l'utilisateur.");
  return getRun(runId, viewer);
}
