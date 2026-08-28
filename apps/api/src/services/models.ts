import {
  MODEL_CATALOG,
  computeCreditCost,
  defaultParamValues,
  isParamVisible,
  type ModelDefinition,
  type ModelSummary,
  type ParamSpec,
} from '@nova/shared';
import { db, nowIso, parseJson } from '../db/index.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { id } from '../lib/ids.js';

interface ModelRow {
  id: string; organization_id: string; model_key: string; name: string; description: string;
  kind: string; family: string; provider: string; provider_model: string; transport: string;
  docs_url: string; timeout_seconds: number; definition_json: string; enabled: number;
  sort_order: number; created_at: string; updated_at: string;
}

function toSummary(row: ModelRow): ModelSummary {
  const definition = parseJson<ModelDefinition>(row.definition_json, {} as ModelDefinition);
  const merged: ModelDefinition = {
    ...definition,
    key: row.model_key,
    name: row.name,
    description: row.description,
    kind: row.kind as ModelDefinition['kind'],
    family: row.family,
    providerModel: row.provider_model,
    transport: row.transport as 'jobs',
    docsUrl: row.docs_url,
    timeoutSeconds: row.timeout_seconds,
    sortOrder: row.sort_order,
    enabledByDefault: definition.enabledByDefault ?? true,
  };
  const baseCost = computeCreditCost(merged, defaultParamValues(merged), 1);
  return { ...merged, id: row.id, enabled: row.enabled === 1, baseCost };
}

/** Cree les modeles du catalogue par defaut pour une organisation. */
export function seedModelsForOrganization(organizationId: string): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO models (
      id, organization_id, model_key, name, description, kind, family, provider,
      provider_model, transport, docs_url, timeout_seconds, definition_json,
      enabled, sort_order, created_at, updated_at
    ) VALUES (
      @id, @organizationId, @modelKey, @name, @description, @kind, @family, 'kie',
      @providerModel, @transport, @docsUrl, @timeoutSeconds, @definition,
      @enabled, @sortOrder, @now, @now
    )
  `);
  const now = nowIso();
  const run = db.transaction((defs: ModelDefinition[]) => {
    for (const def of defs) {
      insert.run({
        id: id('mdl'),
        organizationId,
        modelKey: def.key,
        name: def.name,
        description: def.description,
        kind: def.kind,
        family: def.family,
        providerModel: def.providerModel,
        transport: def.transport,
        docsUrl: def.docsUrl,
        timeoutSeconds: def.timeoutSeconds,
        definition: JSON.stringify(def),
        enabled: def.enabledByDefault ? 1 : 0,
        sortOrder: def.sortOrder,
        now,
      });
    }
  });
  run(MODEL_CATALOG);
}

export function listModels(organizationId: string, opts: { includeDisabled?: boolean } = {}): ModelSummary[] {
  const rows = db.prepare(
    `SELECT * FROM models WHERE organization_id = ? ${opts.includeDisabled ? '' : 'AND enabled = 1'}
     ORDER BY sort_order ASC, name ASC`,
  ).all(organizationId) as ModelRow[];
  return rows.map(toSummary);
}

export function getModelByKey(organizationId: string, modelKey: string): ModelSummary {
  const row = db.prepare('SELECT * FROM models WHERE organization_id = ? AND model_key = ?')
    .get(organizationId, modelKey) as ModelRow | undefined;
  if (!row) throw notFound(`Modele "${modelKey}" introuvable.`);
  return toSummary(row);
}

/** Recupere un modele utilisable pour une generation (doit etre actif). */
export function getEnabledModel(organizationId: string, modelKey: string): ModelSummary {
  const model = getModelByKey(organizationId, modelKey);
  if (!model.enabled) {
    throw new AppError('validation_error', `Le modele "${model.name}" est desactive par l'administrateur.`);
  }
  return model;
}

export function setModelEnabled(organizationId: string, modelKey: string, enabled: boolean): ModelSummary {
  const model = getModelByKey(organizationId, modelKey);
  db.prepare('UPDATE models SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, nowIso(), model.id);
  return getModelByKey(organizationId, modelKey);
}

export interface ModelUpsertInput {
  key: string;
  name: string;
  description?: string;
  kind: ModelDefinition['kind'];
  family?: string;
  providerModel: string;
  docsUrl?: string;
  timeoutSeconds?: number;
  sortOrder?: number;
  enabled?: boolean;
  outputs: ModelDefinition['outputs'];
  credits: ModelDefinition['credits'];
  params: ParamSpec[];
  integrationNotes?: string;
}

/** Cree ou met a jour un modele. Utilise par l'espace Administrateur. */
export function upsertModel(organizationId: string, input: ModelUpsertInput): ModelSummary {
  validateDefinition(input);
  const existing = db.prepare('SELECT * FROM models WHERE organization_id = ? AND model_key = ?')
    .get(organizationId, input.key) as ModelRow | undefined;

  const definition: ModelDefinition = {
    key: input.key,
    providerModel: input.providerModel,
    providerModelVerification: 'unverified',
    name: input.name,
    description: input.description ?? '',
    kind: input.kind,
    family: input.family ?? '',
    transport: 'jobs',
    docsUrl: input.docsUrl ?? '',
    timeoutSeconds: input.timeoutSeconds ?? 600,
    outputs: input.outputs,
    credits: input.credits,
    params: input.params,
    integrationNotes: input.integrationNotes,
    enabledByDefault: input.enabled ?? true,
    sortOrder: input.sortOrder ?? 100,
  };

  const payload = {
    id: existing?.id ?? id('mdl'),
    organizationId,
    modelKey: input.key,
    name: input.name,
    description: definition.description,
    kind: input.kind,
    family: definition.family,
    providerModel: input.providerModel,
    transport: 'jobs',
    docsUrl: definition.docsUrl,
    timeoutSeconds: definition.timeoutSeconds,
    definition: JSON.stringify(definition),
    enabled: (input.enabled ?? true) ? 1 : 0,
    sortOrder: definition.sortOrder,
    now: nowIso(),
  };

  if (existing) {
    db.prepare(`
      UPDATE models SET name=@name, description=@description, kind=@kind, family=@family,
        provider_model=@providerModel, docs_url=@docsUrl, timeout_seconds=@timeoutSeconds,
        definition_json=@definition, enabled=@enabled, sort_order=@sortOrder, updated_at=@now
      WHERE id=@id
    `).run(payload);
  } else {
    db.prepare(`
      INSERT INTO models (
        id, organization_id, model_key, name, description, kind, family, provider,
        provider_model, transport, docs_url, timeout_seconds, definition_json,
        enabled, sort_order, created_at, updated_at
      ) VALUES (
        @id, @organizationId, @modelKey, @name, @description, @kind, @family, 'kie',
        @providerModel, @transport, @docsUrl, @timeoutSeconds, @definition,
        @enabled, @sortOrder, @now, @now
      )
    `).run(payload);
  }
  return getModelByKey(organizationId, input.key);
}

export function deleteModel(organizationId: string, modelKey: string): void {
  const model = getModelByKey(organizationId, modelKey);
  const used = db.prepare('SELECT COUNT(*) AS c FROM generations WHERE organization_id = ? AND model_key = ?')
    .get(organizationId, modelKey) as { c: number };
  if (used.c > 0) {
    throw new AppError(
      'conflict',
      `Ce modele a ete utilise pour ${used.c} generation(s). Desactivez-le plutot que de le supprimer afin de conserver l'historique.`,
    );
  }
  db.prepare('DELETE FROM models WHERE id = ?').run(model.id);
}

/** Reinjecte le catalogue par defaut (nouveaux modeles uniquement). */
export function restoreCatalog(organizationId: string): number {
  const before = db.prepare('SELECT COUNT(*) AS c FROM models WHERE organization_id = ?')
    .get(organizationId) as { c: number };
  seedModelsForOrganization(organizationId);
  const after = db.prepare('SELECT COUNT(*) AS c FROM models WHERE organization_id = ?')
    .get(organizationId) as { c: number };
  return after.c - before.c;
}

/* ------------------------------------------------------------------ */
/* Validation de la definition (protege l'UI generique)                */
/* ------------------------------------------------------------------ */

const PARAM_ID_RE = /^[a-z][a-z0-9_]{0,40}$/;

export function validateDefinition(input: ModelUpsertInput): void {
  const fields: Record<string, string> = {};
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(input.key)) {
    fields.key = 'Cle invalide (minuscules, chiffres et tirets, 2 a 61 caracteres).';
  }
  if (!input.name?.trim()) fields.name = 'Nom obligatoire.';
  if (!input.providerModel?.trim()) fields.providerModel = 'Identifiant du modele provider obligatoire.';
  if (!['image', 'video', 'audio'].includes(input.kind)) fields.kind = 'Type invalide.';
  if (!Array.isArray(input.params) || input.params.length === 0) {
    fields.params = 'Au moins un parametre est requis.';
  }
  if (!input.outputs || input.outputs.min < 1 || input.outputs.max < input.outputs.min) {
    fields.outputs = 'Bornes du nombre de sorties invalides.';
  }
  if (!input.credits || typeof input.credits.base !== 'number' || input.credits.base < 0) {
    fields.credits = 'Cout de base invalide.';
  }

  const seen = new Set<string>();
  for (const p of input.params ?? []) {
    if (!PARAM_ID_RE.test(p.id)) fields[`params.${p.id}`] = 'Identifiant de parametre invalide.';
    if (seen.has(p.id)) fields[`params.${p.id}`] = 'Identifiant de parametre duplique.';
    seen.add(p.id);
    if (p.type === 'select' && (!p.options?.length || !p.options.some((o) => o.value === p.default))) {
      fields[`params.${p.id}`] = 'La valeur par defaut doit figurer parmi les options.';
    }
    if (p.type === 'number' && (p.min > p.max || p.default < p.min || p.default > p.max)) {
      fields[`params.${p.id}`] = 'Bornes numeriques incoherentes.';
    }
    if (p.type === 'files' && (p.minItems < 0 || p.maxItems < Math.max(1, p.minItems))) {
      fields[`params.${p.id}`] = 'Bornes de fichiers incoherentes.';
    }
    if (p.visibleWhen && !(input.params ?? []).some((o) => o.id === p.visibleWhen!.paramId)) {
      fields[`params.${p.id}`] = 'La condition d affichage reference un parametre inexistant.';
    }
  }

  if (Object.keys(fields).length) throw badRequest('Definition de modele invalide.', fields);
}

export { computeCreditCost, defaultParamValues, isParamVisible };
