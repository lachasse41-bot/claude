/**
 * Contrat declaratif des modeles IA.
 * ---------------------------------------------------------------------------
 * Ce fichier definit la STRUCTURE d'un modele. Cette structure est utilisee par :
 *   1. le frontend  -> pour generer automatiquement les controles du formulaire
 *   2. l'API        -> pour valider les parametres recus (validation serveur)
 *   3. l'adaptateur -> pour construire le payload `input` envoye a KIE.ai
 *   4. le moteur de credits -> pour calculer le cout d'une generation
 *
 * Ajouter un modele = ajouter une entree dans `MODEL_CATALOG` (ou le creer
 * depuis l'espace Administrateur > Modeles). Aucun composant d'interface n'a
 * besoin d'etre modifie.
 */

import type { ModelKind } from './types.js';

export type ParamGroup = 'reference' | 'core' | 'output' | 'audio' | 'advanced';

export type ParamValue = string | number | boolean | string[] | null;

/**
 * Indique si le nom de champ provider a ete confirme dans la documentation
 * publique KIE.ai accessible au moment de l'implementation.
 *  - 'verified'   : nom de champ constate dans la doc / des exemples officiels
 *  - 'unverified' : nom de champ plausible a CONFIRMER sur la page de doc du
 *                   modele (`docsUrl`) avant mise en production reelle.
 *                   L'interface d'administration permet de le corriger sans
 *                   redeploiement.
 */
export type FieldVerification = 'verified' | 'unverified';

interface BaseParamSpec {
  /** Identifiant interne stable, utilise en base et dans l'UI. */
  id: string;
  /**
   * Nom du champ transmis dans `input` a KIE.ai.
   * `null` => parametre purement applicatif (jamais transmis au provider).
   */
  field: string | null;
  fieldVerification?: FieldVerification;
  label: string;
  help?: string;
  group: ParamGroup;
  required?: boolean;
  /** Affichage conditionnel : n'apparait que si un autre parametre vaut X. */
  visibleWhen?: { paramId: string; equals: Array<string | number | boolean> };
  /** Ne pas transmettre au provider lorsque la valeur figure dans cette liste. */
  omitWhenValueIn?: Array<string | number | boolean>;
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface SelectParamSpec extends BaseParamSpec {
  type: 'select';
  options: SelectOption[];
  default: string;
}

export interface NumberParamSpec extends BaseParamSpec {
  type: 'number';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export interface BooleanParamSpec extends BaseParamSpec {
  type: 'boolean';
  default: boolean;
}

export interface TextParamSpec extends BaseParamSpec {
  type: 'text' | 'textarea';
  default: string;
  maxLength: number;
  placeholder?: string;
}

export interface FilesParamSpec extends BaseParamSpec {
  type: 'files';
  /** Types MIME acceptes (prefixes autorises, ex: 'image/'). */
  accept: string[];
  minItems: number;
  maxItems: number;
  /** true => transmis sous forme de tableau d'URL, false => URL unique. */
  asArray: boolean;
}

export type ParamSpec =
  | SelectParamSpec
  | NumberParamSpec
  | BooleanParamSpec
  | TextParamSpec
  | FilesParamSpec;

/** Regle de calcul du cout en credits, entierement declarative et deterministe. */
export interface CreditRule {
  /** Cout de base pour une sortie. */
  base: number;
  /** Multiplicateurs appliques selon la valeur d'un parametre `select`. */
  multipliers?: Array<{ paramId: string; map: Record<string, number>; fallback?: number }>;
  /** Cout proportionnel a un parametre numerique (ex: duree en secondes). */
  perUnit?: { paramId: string; creditsPerUnit: number };
  /** Multiplie le total par le nombre de sorties demandees. */
  perOutput: boolean;
}

/**
 * Strategie de production de plusieurs sorties.
 *  - 'fanout'   : l'API cree N taches independantes chez le provider.
 *                 Toujours valable, quel que soit le modele.
 *  - 'provider' : le nombre est transmis au provider via `outputs.field`.
 *                 A n'utiliser que si le champ est confirme par la doc.
 */
export interface OutputsSpec {
  mode: 'fanout' | 'provider';
  field?: string;
  min: number;
  max: number;
  default: number;
}

export interface ModelDefinition {
  /** Cle interne stable (utilisee partout : base, API, UI). */
  key: string;
  /** Identifiant `model` transmis a KIE.ai. */
  providerModel: string;
  providerModelVerification: FieldVerification;
  name: string;
  description: string;
  kind: ModelKind;
  family: string;
  /**
   * Style d'appel provider. Un seul style est implemente aujourd'hui
   * (`jobs` = /api/v1/jobs/createTask + /api/v1/jobs/recordInfo).
   * Le champ existe pour brancher d'autres styles sans refonte.
   */
  transport: 'jobs';
  docsUrl: string;
  /** Duree max acceptable d'une tache avant passage en `failed` (secondes). */
  timeoutSeconds: number;
  outputs: OutputsSpec;
  credits: CreditRule;
  params: ParamSpec[];
  /** Notes affichees a l'administrateur dans l'ecran Modeles. */
  integrationNotes?: string;
  enabledByDefault: boolean;
  sortOrder: number;
}

/* ------------------------------------------------------------------ */
/* Fragments reutilisables                                             */
/* ------------------------------------------------------------------ */

const promptParam = (placeholder: string, required = true): TextParamSpec => ({
  id: 'prompt',
  field: 'prompt',
  fieldVerification: 'verified',
  label: 'Prompt',
  type: 'textarea',
  group: 'core',
  required,
  default: '',
  maxLength: 5000,
  placeholder,
});

const aspectRatioParam = (values: string[], def: string): SelectParamSpec => ({
  id: 'aspect_ratio',
  field: 'aspect_ratio',
  fieldVerification: 'verified',
  label: 'Ratio',
  group: 'output',
  type: 'select',
  default: def,
  options: values.map((v) => ({ value: v, label: v })),
});

const outputFormatParam = (def = 'png'): SelectParamSpec => ({
  id: 'output_format',
  field: 'output_format',
  fieldVerification: 'verified',
  label: 'Format de sortie',
  group: 'output',
  type: 'select',
  default: def,
  options: [
    { value: 'png', label: 'PNG', description: 'Sans perte' },
    { value: 'jpeg', label: 'JPEG', description: 'Plus leger' },
  ],
});

const referenceImagesParam = (min: number, max: number): FilesParamSpec => ({
  id: 'image_urls',
  field: 'image_urls',
  fieldVerification: 'verified',
  label: 'Images de reference',
  help: 'Les fichiers sont heberges par la plateforme puis transmis au modele sous forme d URL.',
  group: 'reference',
  type: 'files',
  accept: ['image/png', 'image/jpeg', 'image/webp'],
  minItems: min,
  maxItems: max,
  asArray: true,
  required: min > 0,
});

/* ------------------------------------------------------------------ */
/* Catalogue par defaut                                                */
/* ------------------------------------------------------------------ */

/**
 * IMPORTANT - point de branchement de l'integration
 * ---------------------------------------------------------------------------
 * `providerModel` et les noms de champs marques `unverified` doivent etre
 * confirmes sur la page de documentation du modele (`docsUrl`) avec la cle API
 * de l'organisation. Ils sont modifiables sans redeploiement depuis
 * Administration > Modeles (chaque modele est stocke en base).
 * Le reste de l'application (UI, validation, credits, workflows) est
 * entierement pilote par ces definitions.
 */
export const MODEL_CATALOG: ModelDefinition[] = [
  {
    key: 'nano-banana',
    providerModel: 'google/nano-banana',
    providerModelVerification: 'verified',
    name: 'Nano Banana',
    description: 'Generation d images a partir d un prompt. Rapide et economique.',
    kind: 'image',
    family: 'Google',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/google/nano-banana',
    timeoutSeconds: 300,
    outputs: { mode: 'fanout', min: 1, max: 8, default: 1 },
    credits: { base: 4, perOutput: true },
    params: [
      promptParam('Un studio photo minimaliste, lumiere douce, produit centre...'),
      aspectRatioParam(['1:1', '3:4', '4:3', '9:16', '16:9'], '1:1'),
      outputFormatParam('png'),
    ],
    enabledByDefault: true,
    sortOrder: 10,
  },
  {
    key: 'nano-banana-edit',
    providerModel: 'google/nano-banana-edit',
    providerModelVerification: 'verified',
    name: 'Nano Banana Edit',
    description: 'Edition et composition d images a partir de references.',
    kind: 'image',
    family: 'Google',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/google/nano-banana-edit',
    timeoutSeconds: 300,
    outputs: { mode: 'fanout', min: 1, max: 8, default: 1 },
    credits: { base: 6, perOutput: true },
    params: [
      referenceImagesParam(1, 5),
      promptParam('Remplace l arriere-plan par un decor de plage au coucher du soleil...'),
      aspectRatioParam(['1:1', '3:4', '4:3', '9:16', '16:9'], '1:1'),
      outputFormatParam('png'),
    ],
    enabledByDefault: true,
    sortOrder: 20,
  },
  {
    key: 'seedream-v4',
    providerModel: 'bytedance/seedream-v4',
    providerModelVerification: 'unverified',
    name: 'Seedream v4',
    description: 'Images haute definition, jusqu a 4K, avec references optionnelles.',
    kind: 'image',
    family: 'ByteDance',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/bytedance/seedream-v4',
    timeoutSeconds: 420,
    outputs: { mode: 'fanout', min: 1, max: 4, default: 1 },
    credits: {
      base: 8,
      perOutput: true,
      multipliers: [{ paramId: 'image_size', map: { '1K': 1, '2K': 1.6, '4K': 2.6 }, fallback: 1 }],
    },
    params: [
      referenceImagesParam(0, 4),
      promptParam('Affiche publicitaire, typographie soignee, style editorial...'),
      aspectRatioParam(['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'], '16:9'),
      {
        id: 'image_size',
        field: 'image_size',
        fieldVerification: 'unverified',
        label: 'Resolution',
        group: 'output',
        type: 'select',
        default: '2K',
        options: [
          { value: '1K', label: '1K', description: 'Brouillon rapide' },
          { value: '2K', label: '2K', description: 'Usage courant' },
          { value: '4K', label: '4K', description: 'Impression / grand format' },
        ],
      },
      outputFormatParam('png'),
    ],
    integrationNotes:
      'Confirmer `bytedance/seedream-v4` et le champ `image_size` sur la page de doc avant usage reel.',
    enabledByDefault: true,
    sortOrder: 30,
  },
  {
    key: 'veo3-fast',
    providerModel: 'google/veo3-fast',
    providerModelVerification: 'unverified',
    name: 'Veo 3 Fast',
    description: 'Video courte a partir d un prompt, avec piste audio optionnelle.',
    kind: 'video',
    family: 'Google',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/veo3-api/generate-veo-3-video',
    timeoutSeconds: 900,
    outputs: { mode: 'fanout', min: 1, max: 4, default: 1 },
    credits: {
      base: 20,
      perOutput: true,
      perUnit: { paramId: 'duration', creditsPerUnit: 6 },
      multipliers: [{ paramId: 'resolution', map: { '720p': 1, '1080p': 1.7 }, fallback: 1 }],
    },
    params: [
      {
        ...referenceImagesParam(0, 1),
        label: 'Image de depart (optionnelle)',
        help: 'Fournir une image pour une generation image-vers-video.',
      },
      promptParam('Travelling lent sur une ville la nuit, neons, pluie fine...'),
      aspectRatioParam(['16:9', '9:16', '1:1'], '16:9'),
      {
        id: 'resolution',
        field: 'resolution',
        fieldVerification: 'unverified',
        label: 'Resolution',
        group: 'output',
        type: 'select',
        default: '720p',
        options: [
          { value: '720p', label: '720p' },
          { value: '1080p', label: '1080p' },
        ],
      },
      {
        id: 'duration',
        field: 'duration',
        fieldVerification: 'unverified',
        label: 'Duree',
        group: 'output',
        type: 'number',
        min: 4,
        max: 8,
        step: 1,
        default: 8,
        unit: 's',
      },
      {
        id: 'generate_audio',
        field: 'generate_audio',
        fieldVerification: 'unverified',
        label: 'Generer la bande son',
        help: 'Ajoute une piste audio synchronisee generee par le modele.',
        group: 'audio',
        type: 'boolean',
        default: true,
      },
      {
        id: 'audio_prompt',
        field: 'audio_prompt',
        fieldVerification: 'unverified',
        label: 'Direction audio',
        group: 'audio',
        type: 'text',
        default: '',
        maxLength: 500,
        placeholder: 'Ambiance urbaine, basse profonde, pas de dialogue',
        visibleWhen: { paramId: 'generate_audio', equals: [true] },
        omitWhenValueIn: [''],
      },
    ],
    integrationNotes:
      'Verifier l identifiant du modele et les champs duree/resolution/audio sur la page Veo 3.',
    enabledByDefault: true,
    sortOrder: 40,
  },
  {
    key: 'kling-i2v',
    providerModel: 'kling/v2-image-to-video',
    providerModelVerification: 'unverified',
    name: 'Kling Image-to-Video',
    description: 'Anime une image de reference en sequence video.',
    kind: 'video',
    family: 'Kling',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/kling/image-to-video',
    timeoutSeconds: 900,
    outputs: { mode: 'fanout', min: 1, max: 2, default: 1 },
    credits: { base: 25, perOutput: true, perUnit: { paramId: 'duration', creditsPerUnit: 5 } },
    params: [
      { ...referenceImagesParam(1, 1), label: 'Image source', asArray: false, field: 'image_url' },
      promptParam('Le personnage tourne lentement la tete vers la camera...'),
      aspectRatioParam(['16:9', '9:16', '1:1'], '16:9'),
      {
        id: 'duration',
        field: 'duration',
        fieldVerification: 'unverified',
        label: 'Duree',
        group: 'output',
        type: 'number',
        min: 5,
        max: 10,
        step: 5,
        default: 5,
        unit: 's',
      },
    ],
    integrationNotes: 'Confirmer l identifiant Kling et le champ `image_url` avant usage reel.',
    enabledByDefault: true,
    sortOrder: 50,
  },
  {
    key: 'suno-music',
    providerModel: 'suno/v5',
    providerModelVerification: 'unverified',
    name: 'Suno Music',
    description: 'Composition musicale a partir d une description de style.',
    kind: 'audio',
    family: 'Suno',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/suno-api/generate-music',
    timeoutSeconds: 600,
    outputs: { mode: 'fanout', min: 1, max: 2, default: 1 },
    credits: { base: 12, perOutput: true },
    params: [
      promptParam('Pop electronique lumineuse, tempo 110, voix feminine...'),
      {
        id: 'style',
        field: 'style',
        fieldVerification: 'unverified',
        label: 'Style musical',
        group: 'audio',
        type: 'text',
        default: '',
        maxLength: 200,
        placeholder: 'synthwave, cinematique',
        omitWhenValueIn: [''],
      },
      {
        id: 'instrumental',
        field: 'instrumental',
        fieldVerification: 'unverified',
        label: 'Instrumental (sans voix)',
        group: 'audio',
        type: 'boolean',
        default: false,
      },
      {
        id: 'lyrics',
        field: 'lyrics',
        fieldVerification: 'unverified',
        label: 'Paroles',
        group: 'audio',
        type: 'textarea',
        default: '',
        maxLength: 3000,
        visibleWhen: { paramId: 'instrumental', equals: [false] },
        omitWhenValueIn: [''],
      },
    ],
    integrationNotes: 'Confirmer l identifiant Suno et les champs paroles/instrumental.',
    enabledByDefault: true,
    sortOrder: 60,
  },
  {
    key: 'tts-voice',
    providerModel: 'elevenlabs/text-to-speech',
    providerModelVerification: 'unverified',
    name: 'Voix off',
    description: 'Synthese vocale a partir d un texte.',
    kind: 'audio',
    family: 'ElevenLabs',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/elevenlabs/text-to-speech',
    timeoutSeconds: 300,
    outputs: { mode: 'fanout', min: 1, max: 4, default: 1 },
    credits: { base: 5, perOutput: true },
    params: [
      { ...promptParam('Texte a lire par la voix de synthese...'), field: 'text', label: 'Texte' },
      {
        id: 'voice',
        field: 'voice_id',
        fieldVerification: 'unverified',
        label: 'Voix',
        group: 'audio',
        type: 'select',
        default: 'female-warm',
        options: [
          { value: 'female-warm', label: 'Feminine chaleureuse' },
          { value: 'male-deep', label: 'Masculine grave' },
          { value: 'neutral-clear', label: 'Neutre claire' },
        ],
      },
      {
        id: 'speed',
        field: 'speed',
        fieldVerification: 'unverified',
        label: 'Vitesse',
        group: 'audio',
        type: 'number',
        min: 0.5,
        max: 1.5,
        step: 0.1,
        default: 1,
        unit: 'x',
      },
    ],
    integrationNotes:
      'Les identifiants de voix doivent etre remplaces par ceux du compte KIE.ai de l organisation.',
    enabledByDefault: true,
    sortOrder: 70,
  },
];

/* ------------------------------------------------------------------ */
/* Helpers partages (UI + serveur)                                     */
/* ------------------------------------------------------------------ */

/** Modele tel qu'expose par l'API (definition + etat en base). */
export interface ModelSummary extends ModelDefinition {
  id: string;
  enabled: boolean;
  /** Cout minimal (1 sortie, valeurs par defaut) — indicatif pour l'UI. */
  baseCost: number;
}

export function defaultParamValues(model: Pick<ModelDefinition, 'params'>): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of model.params) {
    out[p.id] = p.type === 'files' ? [] : (p.default as ParamValue);
  }
  return out;
}

/** Un parametre est-il visible compte tenu des valeurs courantes ? */
export function isParamVisible(spec: ParamSpec, values: Record<string, unknown>): boolean {
  if (!spec.visibleWhen) return true;
  const current = values[spec.visibleWhen.paramId];
  return spec.visibleWhen.equals.some((v) => v === current);
}

/**
 * Calcul du cout en credits. Deterministe, sans effet de bord.
 * Utilise par le serveur (source de verite) et par l'UI (estimation).
 */
export function computeCreditCost(
  model: Pick<ModelDefinition, 'params' | 'credits'>,
  values: Record<string, unknown>,
  outputCount: number,
): number {
  const rule = model.credits;
  let cost = rule.base;

  if (rule.perUnit) {
    const spec = model.params.find((p) => p.id === rule.perUnit!.paramId);
    const raw = values[rule.perUnit.paramId];
    const fallback = spec && spec.type === 'number' ? spec.default : 0;
    const units = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
    cost += units * rule.perUnit.creditsPerUnit;
  }

  for (const mult of rule.multipliers ?? []) {
    const spec = model.params.find((p) => p.id === mult.paramId);
    if (spec && !isParamVisible(spec, values)) continue;
    const raw = values[mult.paramId];
    const key = typeof raw === 'string' ? raw : String(raw ?? '');
    const factor = mult.map[key] ?? mult.fallback ?? 1;
    cost *= factor;
  }

  if (rule.perOutput) cost *= Math.max(1, outputCount);

  return Math.max(1, Math.ceil(cost));
}

export function paramsByGroup(params: ParamSpec[]): Record<ParamGroup, ParamSpec[]> {
  const groups: Record<ParamGroup, ParamSpec[]> = {
    reference: [], core: [], output: [], audio: [], advanced: [],
  };
  for (const p of params) groups[p.group].push(p);
  return groups;
}

export const PARAM_GROUP_LABELS: Record<ParamGroup, string> = {
  reference: 'References',
  core: 'Prompt',
  output: 'Sortie',
  audio: 'Audio',
  advanced: 'Avance',
};
