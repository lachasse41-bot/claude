import { isParamVisible, type ModelSummary, type ParamSpec, type ParamValue } from '@nova/shared';
import { badRequest } from '../lib/errors.js';

export interface ResolvedParams {
  /** Valeurs normalisees, persistees telles quelles avec la generation. */
  values: Record<string, ParamValue>;
  /** Identifiants de fichiers references, par parametre. */
  fileIds: Record<string, string[]>;
  /** Prompt principal (premier parametre texte du groupe `core`). */
  prompt: string;
}

/**
 * Validation serveur des parametres d'une generation.
 * ---------------------------------------------------------------------------
 * Elle ne fait JAMAIS confiance au frontend :
 *  - les parametres inconnus sont rejetes ;
 *  - les parametres non visibles (condition `visibleWhen`) sont ignores ;
 *  - chaque type est verifie et borne selon la definition du modele.
 */
export function validateParams(
  model: ModelSummary,
  raw: unknown,
  /**
   * Nombre de fichiers deja fournis hors televersement pour un parametre
   * (cas des workflows : sorties d'une etape precedente injectees en entree).
   * Ces fichiers comptent dans les bornes min/max du parametre.
   */
  injectedFileCounts: Record<string, number> = {},
): ResolvedParams {
  if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
    throw badRequest('Les parametres doivent etre fournis sous forme d objet.');
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  const known = new Set(model.params.map((p) => p.id));
  const unknownKeys = Object.keys(input).filter((k) => !known.has(k));
  if (unknownKeys.length) {
    throw badRequest(
      `Parametre(s) non supporte(s) par le modele ${model.name} : ${unknownKeys.join(', ')}.`,
      Object.fromEntries(unknownKeys.map((k) => [k, 'Parametre inconnu pour ce modele.'])),
    );
  }

  const fields: Record<string, string> = {};
  const values: Record<string, ParamValue> = {};
  const fileIds: Record<string, string[]> = {};

  // Premiere passe : valeurs brutes ou valeurs par defaut (pour resoudre les
  // conditions d'affichage avant validation stricte).
  const draft: Record<string, unknown> = {};
  for (const spec of model.params) {
    draft[spec.id] = input[spec.id] !== undefined ? input[spec.id] : specDefault(spec);
  }

  for (const spec of model.params) {
    if (!isParamVisible(spec, draft)) {
      // Parametre inapplicable pour cette configuration : on ne le conserve pas.
      continue;
    }
    try {
      const value = coerce(spec, draft[spec.id], injectedFileCounts[spec.id] ?? 0);
      values[spec.id] = value;
      if (spec.type === 'files') fileIds[spec.id] = value as string[];
    } catch (error) {
      fields[spec.id] = error instanceof Error ? error.message : 'Valeur invalide.';
    }
  }

  if (Object.keys(fields).length) {
    throw badRequest('Certains parametres sont invalides.', fields);
  }

  return { values, fileIds, prompt: extractPrompt(model, values) };
}

function specDefault(spec: ParamSpec): ParamValue {
  return spec.type === 'files' ? [] : (spec.default as ParamValue);
}

function coerce(spec: ParamSpec, raw: unknown, injectedFiles = 0): ParamValue {
  switch (spec.type) {
    case 'select': {
      const value = typeof raw === 'string' ? raw : String(raw ?? '');
      if (!spec.options.some((o) => o.value === value)) {
        throw new Error(`Valeur non autorisee. Options : ${spec.options.map((o) => o.value).join(', ')}.`);
      }
      return value;
    }
    case 'number': {
      const num = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
      if (!Number.isFinite(num)) throw new Error('Nombre attendu.');
      if (num < spec.min || num > spec.max) {
        throw new Error(`Valeur hors bornes (${spec.min} a ${spec.max}).`);
      }
      // Alignement sur le pas declare, pour ne transmettre que des valeurs supportees.
      const steps = Math.round((num - spec.min) / spec.step);
      const aligned = Number((spec.min + steps * spec.step).toFixed(6));
      return Math.min(spec.max, Math.max(spec.min, aligned));
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 1) return true;
      if (raw === 'false' || raw === 0) return false;
      throw new Error('Booleen attendu.');
    }
    case 'text':
    case 'textarea': {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (spec.required && !value) throw new Error('Ce champ est obligatoire.');
      if (value.length > spec.maxLength) {
        throw new Error(`Texte trop long (maximum ${spec.maxLength} caracteres).`);
      }
      return value;
    }
    case 'files': {
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const ids = list.map((v) => String(v)).filter(Boolean);
      const effective = ids.length + injectedFiles;
      if (effective < spec.minItems) {
        throw new Error(
          spec.minItems === 1
            ? 'Au moins un fichier est requis.'
            : `Au moins ${spec.minItems} fichiers sont requis.`,
        );
      }
      if (effective > spec.maxItems) {
        throw new Error(`${spec.maxItems} fichier(s) au maximum.`);
      }
      if (new Set(ids).size !== ids.length) throw new Error('Fichier reference plusieurs fois.');
      return ids;
    }
  }
}

function extractPrompt(model: ModelSummary, values: Record<string, ParamValue>): string {
  const spec = model.params.find(
    (p) => (p.type === 'text' || p.type === 'textarea') && (p.id === 'prompt' || p.group === 'core'),
  );
  if (!spec) return '';
  const value = values[spec.id];
  return typeof value === 'string' ? value : '';
}

/**
 * Construit le payload `input` transmis a KIE.ai.
 * `fileUrls` associe l'identifiant de parametre a la liste des URL publiques
 * temporaires des fichiers de reference.
 */
export function buildProviderInput(
  model: ModelSummary,
  values: Record<string, ParamValue>,
  fileUrls: Record<string, string[]>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const spec of model.params) {
    if (!spec.field) continue;                 // parametre purement applicatif
    if (!(spec.id in values)) continue;        // parametre masque par une condition
    const value = values[spec.id];

    if (spec.type === 'files') {
      const urls = fileUrls[spec.id] ?? [];
      if (urls.length === 0) continue;
      payload[spec.field] = spec.asArray ? urls : urls[0];
      continue;
    }

    if (spec.omitWhenValueIn?.some((v) => v === value)) continue;
    if (value === null || value === undefined || value === '') continue;

    payload[spec.field] = value;
  }

  return payload;
}
