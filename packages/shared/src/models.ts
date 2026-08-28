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

/**
 * Transports provider.
 * ---------------------------------------------------------------------------
 * KIE.ai n'expose pas un seul point d'entree : l'API « Jobs » couvre le
 * catalogue de modeles (« market »), tandis que Veo et Suno disposent de leurs
 * propres endpoints avec un corps de requete a plat. Un transport decrit donc
 * ou envoyer la demande, ou lire son etat, et comment emballer les parametres.
 *
 * Ajouter un transport = ajouter une entree ici + la referencer depuis un
 * modele. Le reste de la chaine (validation, credits, suivi, workflows) est
 * inchange.
 */
export type TransportKey = 'jobs' | 'veo' | 'suno';

export interface TransportSpec {
  label: string;
  createPath: string;
  statusPath: string;
  /**
   * `input` : { model, input: { ...params } }  — API Jobs
   * `flat`  : { model, ...params }             — endpoints dedies (Veo, Suno)
   */
  payloadStyle: 'input' | 'flat';
  /** Champs constants ajoutes au corps de la requete. */
  constantBody?: Record<string, unknown>;
  docsUrl: string;
}

export const TRANSPORTS: Record<TransportKey, TransportSpec> = {
  jobs: {
    label: 'API Jobs (catalogue market)',
    createPath: '/api/v1/jobs/createTask',
    statusPath: '/api/v1/jobs/recordInfo',
    payloadStyle: 'input',
    docsUrl: 'https://docs.kie.ai/market/common/get-task-detail',
  },
  veo: {
    label: 'Endpoint dedie Veo',
    createPath: '/api/v1/veo/generate',
    statusPath: '/api/v1/veo/record-info',
    payloadStyle: 'flat',
    docsUrl: 'https://docs.kie.ai/veo3-api/generate-veo-3-video',
  },
  suno: {
    label: 'Endpoint dedie Suno',
    createPath: '/api/v1/generate',
    statusPath: '/api/v1/generate/record-info',
    payloadStyle: 'flat',
    // Mode simple : le prompt decrit la piste, Suno gere le reste.
    constantBody: { customMode: false },
    docsUrl: 'https://docs.kie.ai/suno-api/generate-music',
  },
};

export type ParamGroup = 'reference' | 'core' | 'output' | 'audio' | 'advanced';

export type ParamValue = string | number | boolean | string[] | null;

/**
 * Statut de verification d'un nom de champ provider.
 *  - 'verified'   : nom de champ constate dans le contrat public du
 *                   fournisseur (endpoints, enums et types releves sur les
 *                   integrations de reference).
 *  - 'unverified' : nom de champ a CONFIRMER sur la page de doc du modele
 *                   (`docsUrl`) avant mise en production. C'est la valeur par
 *                   defaut des modeles ajoutes depuis l'administration.
 * Dans les deux cas, la correction se fait sans redeploiement.
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
  /** Transport provider a utiliser (voir `TRANSPORTS`). */
  transport: TransportKey;
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

/** Ratios acceptes par les modeles Gemini/Nano Banana. */
const NANO_BANANA_RATIOS = [
  '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', 'auto',
] as const;

/**
 * Ratio d image. Attention : sur le catalogue « market », le champ transmis
 * s appelle `image_size` et non `aspect_ratio` — l ecart entre le libelle
 * affiche et le nom du champ provider est precisement ce que la definition
 * declarative permet d absorber.
 */
const imageSizeParam = (values: readonly string[], def: string): SelectParamSpec => ({
  id: 'image_size',
  field: 'image_size',
  fieldVerification: 'verified',
  label: 'Ratio',
  group: 'output',
  type: 'select',
  default: def,
  options: values.map((v) => ({
    value: v,
    label: v === 'auto' ? 'Auto' : v,
    ...(v === 'auto' ? { description: 'Choisi par le modele' } : {}),
  })),
});

/** Seedream nomme ses formats au lieu d utiliser des ratios numeriques. */
const seedreamFormatParam = (): SelectParamSpec => ({
  id: 'image_size',
  field: 'image_size',
  fieldVerification: 'verified',
  label: 'Format',
  group: 'output',
  type: 'select',
  default: 'landscape_16_9',
  options: [
    { value: 'square', label: 'Carre', description: '1:1' },
    { value: 'square_hd', label: 'Carre HD', description: '1:1 haute definition' },
    { value: 'portrait_4_3', label: 'Portrait 3:4' },
    { value: 'portrait_3_2', label: 'Portrait 2:3' },
    { value: 'portrait_16_9', label: 'Portrait 9:16' },
    { value: 'landscape_4_3', label: 'Paysage 4:3' },
    { value: 'landscape_3_2', label: 'Paysage 3:2' },
    { value: 'landscape_16_9', label: 'Paysage 16:9' },
    { value: 'landscape_21_9', label: 'Panoramique 21:9' },
  ],
});

const seedreamResolutionParam = (): SelectParamSpec => ({
  id: 'image_resolution',
  field: 'image_resolution',
  fieldVerification: 'verified',
  label: 'Resolution',
  group: 'output',
  type: 'select',
  default: '2K',
  options: [
    { value: '1K', label: '1K', description: 'Brouillon rapide' },
    { value: '2K', label: '2K', description: 'Usage courant' },
    { value: '4K', label: '4K', description: 'Impression / grand format' },
  ],
});

const outputFormatParam = (values: string[], def: string): SelectParamSpec => ({
  id: 'output_format',
  field: 'output_format',
  fieldVerification: 'verified',
  label: 'Format de sortie',
  group: 'output',
  type: 'select',
  default: def,
  options: values.map((v) => ({
    value: v,
    label: v.toUpperCase(),
    description: v === 'png' ? 'Sans perte' : 'Plus leger',
  })),
});

/**
 * Duree Kling. Le fournisseur est strict sur le type : la valeur doit etre
 * transmise en chaine de caracteres, d ou un `select` plutot qu un curseur.
 */
const klingDurationParam = (): SelectParamSpec => ({
  id: 'duration',
  field: 'duration',
  fieldVerification: 'verified',
  label: 'Duree',
  group: 'output',
  type: 'select',
  default: '5',
  options: [
    { value: '5', label: '5 s' },
    { value: '10', label: '10 s' },
  ],
});

const klingCfgParam = (): NumberParamSpec => ({
  id: 'cfg_scale',
  field: 'cfg_scale',
  fieldVerification: 'verified',
  label: 'Adherence au prompt',
  help: "Valeur basse : plus de liberte creative. Valeur haute : suit le prompt de pres.",
  group: 'advanced',
  type: 'number',
  min: 0,
  max: 1,
  step: 0.1,
  default: 0.5,
});

const negativePromptParam = (): TextParamSpec => ({
  id: 'negative_prompt',
  field: 'negative_prompt',
  fieldVerification: 'verified',
  label: 'A eviter',
  help: "Elements que le modele doit ecarter.",
  group: 'advanced',
  type: 'text',
  default: '',
  maxLength: 500,
  placeholder: 'flou, texte illisible, mains deformees',
  omitWhenValueIn: [''],
});

const referenceImagesParam = (min: number, max: number): FilesParamSpec => ({
  id: 'image_urls',
  field: 'image_urls',
  fieldVerification: 'verified',
  label: 'Images de reference',
  help: "Les fichiers sont heberges par la plateforme puis transmis au modele sous forme d URL.",
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
    description: "Generation d images a partir d un prompt. Rapide et economique.",
    kind: 'image',
    family: 'Google',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/google/nano-banana',
    timeoutSeconds: 300,
    outputs: { mode: 'fanout', min: 1, max: 8, default: 1 },
    credits: { base: 4, perOutput: true },
    params: [
      promptParam('Un studio photo minimaliste, lumiere douce, produit centre...'),
      // Attention : chez ce modele le ratio se transmet via `image_size`.
      imageSizeParam(NANO_BANANA_RATIOS, '1:1'),
      outputFormatParam(['png', 'jpeg'], 'png'),
    ],
    enabledByDefault: true,
    sortOrder: 10,
  },
  {
    key: 'nano-banana-edit',
    providerModel: 'google/nano-banana-edit',
    providerModelVerification: 'verified',
    name: 'Nano Banana Edit',
    description: "Edition et composition d images a partir de references.",
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
      imageSizeParam(NANO_BANANA_RATIOS, '1:1'),
      outputFormatParam(['png', 'jpeg'], 'png'),
    ],
    integrationNotes:
      "Le nombre maximum d images de reference (5) est une limite fixee par la plateforme, non documentee par le fournisseur.",
    enabledByDefault: true,
    sortOrder: 20,
  },
  {
    key: 'seedream-v4',
    providerModel: 'bytedance/seedream-v4-text-to-image',
    providerModelVerification: 'verified',
    name: 'Seedream 4.0',
    description: "Images haute definition jusqu a 4K, plusieurs variantes en une seule tache.",
    kind: 'image',
    family: 'ByteDance',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/bytedance/seedream-v4-text-to-image',
    timeoutSeconds: 420,
    // Ce modele produit lui-meme plusieurs images : une seule tache suffit.
    outputs: { mode: 'provider', field: 'max_images', min: 1, max: 6, default: 1 },
    credits: {
      base: 8,
      perOutput: true,
      multipliers: [
        { paramId: 'image_resolution', map: { '1K': 1, '2K': 1.6, '4K': 2.6 }, fallback: 1 },
      ],
    },
    params: [
      promptParam('Affiche publicitaire, typographie soignee, style editorial...'),
      seedreamFormatParam(),
      seedreamResolutionParam(),
    ],
    enabledByDefault: true,
    sortOrder: 30,
  },
  {
    key: 'seedream-v4-edit',
    providerModel: 'bytedance/seedream-v4-edit',
    providerModelVerification: 'verified',
    name: 'Seedream 4.0 Edit',
    description: "Retouche haute definition a partir d images de reference.",
    kind: 'image',
    family: 'ByteDance',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/bytedance/seedream-v4-edit',
    timeoutSeconds: 420,
    outputs: { mode: 'provider', field: 'max_images', min: 1, max: 6, default: 1 },
    credits: {
      base: 10,
      perOutput: true,
      multipliers: [
        { paramId: 'image_resolution', map: { '1K': 1, '2K': 1.6, '4K': 2.6 }, fallback: 1 },
      ],
    },
    params: [
      referenceImagesParam(1, 5),
      promptParam('Harmonise la lumiere et remplace le fond par un studio neutre...'),
      seedreamFormatParam(),
      seedreamResolutionParam(),
    ],
    enabledByDefault: true,
    sortOrder: 35,
  },
  {
    key: 'veo-3-fast',
    // Sur l'endpoint Veo, `model` prend une valeur courte (veo3, veo3_fast,
    // veo3_lite) et non un identifiant de catalogue.
    providerModel: 'veo3_fast',
    providerModelVerification: 'verified',
    name: 'Veo 3.1 Fast',
    description: "Video courte generee a partir d un prompt, avec bande son.",
    kind: 'video',
    family: 'Google',
    transport: 'veo',
    docsUrl: 'https://docs.kie.ai/veo3-api/generate-veo-3-video',
    timeoutSeconds: 900,
    outputs: { mode: 'fanout', min: 1, max: 4, default: 1 },
    credits: { base: 40, perOutput: true },
    params: [
      {
        ...referenceImagesParam(0, 1),
        field: 'imageUrls',
        label: 'Image de depart (optionnelle)',
        help: "Fournir une image pour une generation image-vers-video.",
        required: false,
      },
      promptParam('Travelling lent sur une ville la nuit, neons, pluie fine...'),
      {
        id: 'aspect_ratio',
        field: 'aspect_ratio',
        fieldVerification: 'verified',
        label: 'Ratio',
        group: 'output',
        type: 'select',
        default: '16:9',
        options: [
          { value: '16:9', label: '16:9', description: 'Paysage' },
          { value: '9:16', label: '9:16', description: 'Portrait' },
          { value: 'Auto', label: 'Auto', description: 'Choisi par le modele' },
        ],
      },
      {
        id: 'enable_translation',
        field: 'enableTranslation',
        fieldVerification: 'verified',
        label: 'Traduire automatiquement le prompt',
        help: "Le modele est optimise pour l anglais ; la traduction est appliquee en amont.",
        group: 'advanced',
        type: 'boolean',
        default: true,
      },
    ],
    integrationNotes:
      "Veo genere sa bande son et fixe la duree du plan : ni la duree ni le mixage audio ne sont parametrables sur cet endpoint.",
    enabledByDefault: true,
    sortOrder: 40,
  },
  {
    key: 'kling-t2v',
    providerModel: 'kling/v2-1-master-text-to-video',
    providerModelVerification: 'verified',
    name: 'Kling 2.1 Master',
    description: "Video a partir d un prompt, duree et adherence reglables.",
    kind: 'video',
    family: 'Kling',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/kling/text-to-video',
    timeoutSeconds: 900,
    outputs: { mode: 'fanout', min: 1, max: 2, default: 1 },
    credits: {
      base: 25,
      perOutput: true,
      multipliers: [{ paramId: 'duration', map: { '5': 1, '10': 2 }, fallback: 1 }],
    },
    params: [
      promptParam('Un drone survole une cote rocheuse au lever du jour...'),
      {
        id: 'aspect_ratio',
        field: 'aspect_ratio',
        fieldVerification: 'verified',
        label: 'Ratio',
        group: 'output',
        type: 'select',
        default: '16:9',
        options: [
          { value: '16:9', label: '16:9' },
          { value: '9:16', label: '9:16' },
          { value: '1:1', label: '1:1' },
        ],
      },
      klingDurationParam(),
      klingCfgParam(),
      negativePromptParam(),
    ],
    enabledByDefault: true,
    sortOrder: 45,
  },
  {
    key: 'kling-i2v',
    providerModel: 'kling/v2-1-master-image-to-video',
    providerModelVerification: 'verified',
    name: 'Kling 2.1 Master I2V',
    description: "Anime une image de reference en sequence video.",
    kind: 'video',
    family: 'Kling',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/kling/image-to-video',
    timeoutSeconds: 900,
    outputs: { mode: 'fanout', min: 1, max: 2, default: 1 },
    credits: {
      base: 25,
      perOutput: true,
      multipliers: [{ paramId: 'duration', map: { '5': 1, '10': 2 }, fallback: 1 }],
    },
    params: [
      // Image unique : le champ attend une URL, pas un tableau.
      { ...referenceImagesParam(1, 1), field: 'image_url', label: 'Image source', asArray: false },
      promptParam('Le personnage tourne lentement la tete vers la camera...'),
      klingDurationParam(),
      klingCfgParam(),
      negativePromptParam(),
    ],
    enabledByDefault: true,
    sortOrder: 50,
  },
  {
    key: 'suno-music',
    // Sur l'endpoint Suno, `model` designe la version du moteur.
    providerModel: 'V5',
    providerModelVerification: 'verified',
    name: 'Suno Music',
    description: "Composition musicale complete a partir d une description.",
    kind: 'audio',
    family: 'Suno',
    transport: 'suno',
    docsUrl: 'https://docs.kie.ai/suno-api/generate-music',
    timeoutSeconds: 600,
    outputs: { mode: 'fanout', min: 1, max: 2, default: 1 },
    credits: { base: 12, perOutput: true },
    params: [
      promptParam('Pop electronique lumineuse, tempo 110, voix feminine...'),
      {
        id: 'title',
        field: 'title',
        fieldVerification: 'verified',
        label: 'Titre',
        group: 'audio',
        type: 'text',
        default: '',
        maxLength: 100,
        placeholder: 'Lumiere du matin',
        omitWhenValueIn: [''],
      },
      {
        id: 'style',
        field: 'style',
        fieldVerification: 'verified',
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
        fieldVerification: 'verified',
        label: 'Instrumental (sans voix)',
        group: 'audio',
        type: 'boolean',
        default: true,
      },
    ],
    enabledByDefault: true,
    sortOrder: 60,
  },
  {
    key: 'tts-voice',
    providerModel: 'elevenlabs/text-to-speech-multilingual-v2',
    providerModelVerification: 'verified',
    name: 'Voix off',
    description: "Synthese vocale multilingue a partir d un texte.",
    kind: 'audio',
    family: 'ElevenLabs',
    transport: 'jobs',
    docsUrl: 'https://docs.kie.ai/market/elevenlabs/text-to-speech-multilingual-v2',
    timeoutSeconds: 300,
    outputs: { mode: 'fanout', min: 1, max: 4, default: 1 },
    credits: { base: 5, perOutput: true },
    params: [
      { ...promptParam('Texte a lire par la voix de synthese...'), field: 'text', label: 'Texte' },
      {
        id: 'voice',
        field: 'voice',
        fieldVerification: 'verified',
        label: 'Voix',
        help: "Identifiants de voix ElevenLabs. Le fournisseur refuse la demande si aucune voix n est fournie.",
        group: 'audio',
        type: 'select',
        default: '5l5f8iK3YPeGga21rQIX',
        options: [
          { value: '5l5f8iK3YPeGga21rQIX', label: 'Adeline', description: 'Feminine, conversationnelle' },
          { value: 'EkK5I93UQWFDigLMpZcX', label: 'James', description: 'Grave, engageante' },
          { value: '1SM7GgM6IMuvQlz2BwM3', label: 'Mark', description: 'Detendue, naturelle' },
          { value: 'Z3R5wn05IrDiVCyEkUrK', label: 'Arabella', description: 'Emotive' },
          { value: 'BZgkqPqms7Kj9ulSkVzn', label: 'Eve', description: 'Energique' },
        ],
      },
      {
        id: 'speed',
        field: 'speed',
        fieldVerification: 'verified',
        label: 'Vitesse',
        group: 'audio',
        type: 'number',
        min: 0.7,
        max: 1.2,
        step: 0.05,
        default: 1,
        unit: 'x',
      },
      {
        id: 'output_format',
        field: 'output_format',
        fieldVerification: 'verified',
        label: 'Format audio',
        group: 'output',
        type: 'select',
        default: 'mp3_44100_128',
        options: [
          { value: 'mp3_44100_128', label: 'MP3 128 kbps' },
          { value: 'mp3_44100_192', label: 'MP3 192 kbps' },
        ],
      },
    ],
    integrationNotes:
      "Les identifiants de voix peuvent etre remplaces par ceux du compte ElevenLabs de l organisation.",
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
