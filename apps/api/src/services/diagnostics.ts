import {
  TRANSPORTS, defaultParamValues, isParamVisible,
  type ModelSummary, type ParamValue,
} from '@nova/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { buildRequestBody, createTask, getTask } from '../providers/kie/client.js';
import { resolveCredentials } from './apiConfig.js';
import { getModelByKey } from './models.js';
import { buildProviderInput } from './paramValidation.js';
import { saveFile, signedPublicUrl } from './files.js';

/**
 * Diagnostic d'un modele.
 * ---------------------------------------------------------------------------
 * Objectif : rendre visible ce que la plateforme envoie reellement au
 * fournisseur, pour pouvoir le comparer a sa documentation. Un identifiant ou
 * un nom de champ errone se voit alors immediatement, au lieu de se traduire
 * par des generations en echec pour les collaborateurs.
 *
 * Deux modes :
 *  - apercu  : construit la requete sans rien envoyer. Gratuit.
 *  - reel    : soumet une tache minimale au fournisseur et relaie sa reponse.
 *              CONSOMME DES CREDITS chez le fournisseur.
 */

export interface DiagnosticRequest {
  method: 'POST';
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface DiagnosticResult {
  modelKey: string;
  modelName: string;
  transport: string;
  providerModel: string;
  /** Champs dont le nom n'a pas ete confirme aupres du fournisseur. */
  unverifiedFields: string[];
  request: DiagnosticRequest;
  live: {
    submitted: boolean;
    accepted: boolean;
    taskId: string | null;
    state: string | null;
    message: string;
    /** Piste de correction lorsque le fournisseur refuse. */
    hint: string | null;
  } | null;
}

/** PNG 2x2 valide, utilise comme reference minimale pour un test reel. */
const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP8z4AATAxQxjAWAgAeuAEBnFCTgwAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Rapproche un refus du fournisseur d'un parametre declare.
 * KIE.ai nomme generalement le champ fautif dans son message : on le retrouve
 * pour indiquer quoi corriger dans la definition du modele.
 */
function buildHint(model: ModelSummary, providerMessage: string): string | null {
  const message = providerMessage.toLowerCase();

  const guilty = model.params.find(
    (spec) => spec.field && message.includes(spec.field.toLowerCase()),
  );
  if (guilty) {
    return `Le fournisseur mentionne le champ « ${guilty.field} » (parametre « ${guilty.label} »). ` +
      `Verifiez son nom et ses valeurs sur ${model.docsUrl || 'la page de documentation du modele'}, ` +
      `puis corrigez-le dans Administration > Modeles IA.`;
  }

  if (/model|not found|introuvable|unsupported/.test(message)) {
    return `L'identifiant « ${model.providerModel} » semble refuse. Verifiez-le sur ` +
      `${model.docsUrl || 'la page de documentation du modele'} et corrigez-le dans ` +
      `Administration > Modeles IA.`;
  }
  if (/credit|balance|quota|insufficient/.test(message)) {
    return "Le compte KIE.ai n'a pas assez de credits fournisseur : la definition du modele n'est pas en cause.";
  }
  if (/key|unauthorized|forbidden|401|403/.test(message)) {
    return "La cle API est refusee : verifiez-la dans Administration > Parametres.";
  }
  return null;
}

/** Valeurs de test : defauts declares, prompt neutre, reference si exigee. */
function sampleValues(model: ModelSummary, referenceUrl: string | null) {
  const values = defaultParamValues(model);
  const fileUrls: Record<string, string[]> = {};

  for (const spec of model.params) {
    if (!isParamVisible(spec, values)) continue;

    if (spec.type === 'files') {
      if (spec.minItems > 0 && referenceUrl) {
        fileUrls[spec.id] = Array.from({ length: spec.minItems }, () => referenceUrl);
      }
      continue;
    }
    if ((spec.type === 'text' || spec.type === 'textarea') && spec.required && !values[spec.id]) {
      values[spec.id] = 'Test de configuration' as ParamValue;
    }
  }

  return { values, fileUrls };
}

export interface DiagnoseOptions {
  organizationId: string;
  modelKey: string;
  /** true => soumet reellement une tache (consomme des credits fournisseur). */
  live?: boolean;
  /** Utilisateur auquel rattacher le fichier de reference d'un test reel. */
  userId?: string;
}

export async function diagnoseModel(options: DiagnoseOptions): Promise<DiagnosticResult> {
  const model = getModelByKey(options.organizationId, options.modelKey);
  const transport = TRANSPORTS[model.transport];
  const { baseUrl, apiKey } = resolveCredentials(options.organizationId);

  // Un test reel a besoin d'une reference telechargeable par le fournisseur.
  const needsReference = model.params.some((p) => p.type === 'files' && p.minItems > 0);
  let referenceUrl: string | null = needsReference ? 'https://exemple.invalid/reference.png' : null;
  if (needsReference && options.live && options.userId) {
    const stored = saveFile({
      organizationId: options.organizationId,
      userId: options.userId,
      buffer: SAMPLE_PNG,
      originalName: 'diagnostic.png',
      mimeType: 'image/png',
    });
    referenceUrl = signedPublicUrl(stored.id);
  }

  const { values, fileUrls } = sampleValues(model, referenceUrl);
  const providerInput = buildProviderInput(model, values, fileUrls);
  if (model.outputs.mode === 'provider' && model.outputs.field) {
    providerInput[model.outputs.field] = model.outputs.min;
  }

  const request: DiagnosticRequest = {
    method: 'POST',
    url: `${baseUrl}${transport.createPath}`,
    headers: {
      // La cle n'est jamais exposee, meme a un administrateur.
      Authorization: apiKey ? `Bearer ****${apiKey.slice(-4)}` : '(aucune cle configuree)',
      'Content-Type': 'application/json',
    },
    body: buildRequestBody(model.transport, model.providerModel, providerInput),
  };

  const unverifiedFields = model.params
    .filter((spec) => spec.field && spec.fieldVerification === 'unverified')
    .map((spec) => spec.field as string);
  if (model.providerModelVerification === 'unverified') unverifiedFields.unshift('model');

  const result: DiagnosticResult = {
    modelKey: model.key,
    modelName: model.name,
    transport: model.transport,
    providerModel: model.providerModel,
    unverifiedFields,
    request,
    live: null,
  };

  if (!options.live) return result;

  if (!apiKey) {
    throw new AppError(
      'provider_not_configured',
      "Aucune cle API n'est configuree : le test reel est impossible.",
    );
  }

  try {
    const task = await createTask({
      organizationId: options.organizationId,
      transport: model.transport,
      model: model.providerModel,
      payload: providerInput,
    });

    // Une lecture immediate confirme que la tache existe cote fournisseur.
    let state: string | null = null;
    try {
      state = (await getTask(options.organizationId, task.taskId, model.transport)).state;
    } catch {
      // La tache vient d'etre creee : elle peut ne pas encore etre lisible.
    }

    logger.info('Diagnostic modele : tache acceptee', { modelKey: model.key, taskId: task.taskId });
    return {
      ...result,
      live: {
        submitted: true,
        accepted: true,
        taskId: task.taskId,
        state,
        message: `Tache acceptee par le fournisseur (${task.taskId}).`,
        hint: null,
      },
    };
  } catch (error) {
    const appError = error instanceof AppError ? error : null;
    const message = appError?.message ?? "Le fournisseur n'a pas pu etre contacte.";
    // Le detail brut du refus est le plus utile : il nomme souvent le champ.
    const internal = appError?.internal as { body?: unknown } | undefined;
    const raw = internal?.body ? JSON.stringify(internal.body).slice(0, 400) : '';

    logger.warn('Diagnostic modele : tache refusee', { modelKey: model.key, message, raw });
    return {
      ...result,
      live: {
        submitted: true,
        accepted: false,
        taskId: null,
        state: null,
        message: raw ? `${message} — reponse : ${raw}` : message,
        hint: buildHint(model, `${message} ${raw}`),
      },
    };
  }
}
