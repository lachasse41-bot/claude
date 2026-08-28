/**
 * Types partages entre l'API et le frontend.
 * Aucune dependance runtime : ce paquet ne contient que des types et des
 * donnees declaratives (catalogue de modeles).
 */

/* ------------------------------------------------------------------ */
/* Roles & utilisateurs                                                */
/* ------------------------------------------------------------------ */

export const ROLES = ['admin', 'collaborator'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'disabled', 'invited'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface PublicUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  avatarColor: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SessionUser extends PublicUser {
  organizationName: string;
  credits: CreditSummary;
}

/* ------------------------------------------------------------------ */
/* Credits                                                             */
/* ------------------------------------------------------------------ */

export interface CreditSummary {
  balance: number;
  totalGranted: number;
  totalSpent: number;
  allowOverdraft: boolean;
}

export const CREDIT_TX_TYPES = ['grant', 'debit', 'refund', 'adjustment'] as const;
export type CreditTransactionType = (typeof CREDIT_TX_TYPES)[number];

export interface CreditTransaction {
  id: string;
  userId: string;
  userName?: string;
  type: CreditTransactionType;
  amount: number;
  balanceAfter: number;
  generationId: string | null;
  modelKey: string | null;
  reason: string;
  actorUserId: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Generations                                                         */
/* ------------------------------------------------------------------ */

/**
 * Etats explicites d'une generation.
 * `idle` et `uploading` sont des etats purement cote client (avant que la
 * generation n'existe en base) ; ils sont declares ici pour que le frontend
 * et le backend partagent le meme vocabulaire.
 */
export const GENERATION_STATES = [
  'idle',
  'uploading',
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type GenerationState = (typeof GENERATION_STATES)[number];

/** Etats reellement persistes cote serveur. */
export const PERSISTED_GENERATION_STATES = [
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type PersistedGenerationState = (typeof PERSISTED_GENERATION_STATES)[number];

export const TERMINAL_STATES: GenerationState[] = ['completed', 'failed', 'cancelled'];

export function isTerminalState(state: GenerationState): boolean {
  return TERMINAL_STATES.includes(state);
}

export const MODEL_KINDS = ['image', 'video', 'audio'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export interface GenerationAsset {
  id: string;
  generationId: string;
  kind: 'input' | 'output';
  role: string;
  /** URL servie par la plateforme (copie locale) ou, a defaut, URL du provider. */
  url: string;
  /**
   * URL d'origine chez le fournisseur, conservee comme secours si la copie
   * locale est indisponible. Peut etre vide et peut expirer.
   */
  remoteUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  position: number;
  inGallery?: boolean;
  galleryItemId?: string | null;
  createdAt: string;
}

export interface Generation {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  modelKey: string;
  modelName: string;
  kind: ModelKind;
  state: PersistedGenerationState;
  prompt: string;
  params: Record<string, unknown>;
  outputCount: number;
  creditCost: number;
  creditsRefunded: number;
  externalTaskId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  progress: number;
  workflowRunId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assets: GenerationAsset[];
}

/* ------------------------------------------------------------------ */
/* Galerie                                                             */
/* ------------------------------------------------------------------ */

export interface GalleryItem {
  id: string;
  userId: string;
  userName?: string;
  generationId: string;
  assetId: string;
  title: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  asset: GenerationAsset;
  generation: {
    id: string;
    modelKey: string;
    modelName: string;
    kind: ModelKind;
    prompt: string;
    params: Record<string, unknown>;
    creditCost: number;
    createdAt: string;
  };
}

/* ------------------------------------------------------------------ */
/* Workflows                                                           */
/* ------------------------------------------------------------------ */

export const WORKFLOW_STEP_TYPES = ['generation'] as const;
export type WorkflowStepType = (typeof WORKFLOW_STEP_TYPES)[number];

/**
 * Source d'une entree de fichier pour une etape :
 *  - `upload`   : fichiers fournis au lancement du workflow
 *  - `step`     : sorties d'une etape precedente (par index)
 */
export interface WorkflowInputBinding {
  /** id du parametre (ParamSpec.id) de type `files` a alimenter */
  paramId: string;
  source: 'upload' | 'step';
  /** index (0-based) de l'etape source lorsque source === 'step' */
  stepIndex?: number;
  /** nombre max d'assets repris depuis l'etape source */
  limit?: number;
}

export interface WorkflowStep {
  id: string;
  workflowId: string;
  position: number;
  name: string;
  type: WorkflowStepType;
  modelKey: string;
  modelName?: string;
  params: Record<string, unknown>;
  /** Le prompt peut reutiliser {{step1.prompt}} ou {{input.prompt}} */
  prompt: string;
  inputs: WorkflowInputBinding[];
}

export interface Workflow {
  id: string;
  userId: string;
  userName?: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  estimatedCredits: number;
  lastRun?: WorkflowRunSummary | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export const WORKFLOW_RUN_STATES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type WorkflowRunState = (typeof WORKFLOW_RUN_STATES)[number];

export interface WorkflowStepRun {
  id: string;
  runId: string;
  stepId: string;
  position: number;
  name: string;
  modelKey: string;
  state: 'pending' | PersistedGenerationState;
  generationId: string | null;
  generation?: Generation | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  workflowName?: string;
  userId: string;
  state: WorkflowRunState;
  currentStep: number;
  totalSteps: number;
  errorMessage: string | null;
  creditCost: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface WorkflowRun extends WorkflowRunSummary {
  steps: WorkflowStepRun[];
}

/* ------------------------------------------------------------------ */
/* Journalisation                                                      */
/* ------------------------------------------------------------------ */

export interface ActivityLog {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  targetUserId: string | null;
  targetName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Administration                                                      */
/* ------------------------------------------------------------------ */

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  initialCredits: number;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  createdByName: string | null;
  /** Renvoye uniquement a la creation (jamais relu depuis la base). */
  inviteUrl?: string;
}

export interface OrganizationSettings {
  /** Autorise les soldes negatifs (regle administrative d'exception). */
  allowOverdraftByDefault: boolean;
  /** Credits attribues par defaut a un nouveau collaborateur. */
  defaultCollaboratorCredits: number;
  /** Nombre maximum de generations simultanees par utilisateur. */
  maxConcurrentGenerationsPerUser: number;
  /** Taille max d'un fichier televerse (Mo). */
  maxUploadSizeMb: number;
  /** Ouvre/ferme les inscriptions par invitation. */
  invitationsEnabled: boolean;
}

export interface ApiConfigurationStatus {
  provider: 'kie';
  baseUrl: string;
  configured: boolean;
  keyLast4: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  lastCheckAt: string | null;
  lastCheckStatus: 'ok' | 'error' | null;
  lastCheckMessage: string | null;
}

export interface EmailConfigurationStatus {
  /** true => les e-mails sont reellement envoyes. */
  enabled: boolean;
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  /** Indique si les valeurs proviennent des variables d'environnement. */
  source: 'organization' | 'environment' | 'none';
  hasPassword: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
  lastCheckAt: string | null;
  lastCheckStatus: 'ok' | 'error' | null;
  lastCheckMessage: string | null;
}

/** Resultat d'un envoi, tel qu'expose a l'interface. */
export interface EmailDeliveryResult {
  delivered: boolean;
  /** Raison lisible lorsque l'envoi n'a pas eu lieu. */
  reason: string | null;
}

export interface AdminOverview {
  totals: {
    collaborators: number;
    activeCollaborators: number;
    disabledCollaborators: number;
    pendingInvitations: number;
    generations: number;
    generationsCompleted: number;
    generationsFailed: number;
    creditsSpent: number;
    creditsGranted: number;
    creditsAvailable: number;
  };
  byModel: Array<{ modelKey: string; modelName: string; kind: ModelKind; generations: number; credits: number }>;
  byUser: Array<{
    userId: string; name: string; email: string; role: Role; status: UserStatus;
    generations: number; credits: number; balance: number; lastActiveAt: string | null;
  }>;
  timeline: Array<{ date: string; generations: number; credits: number }>;
  recentActivity: ActivityLog[];
}

export interface CollaboratorOverview {
  credits: CreditSummary;
  totals: {
    generations: number;
    completed: number;
    failed: number;
    running: number;
    galleryItems: number;
    workflows: number;
    creditsSpent30d: number;
  };
  byModel: Array<{ modelKey: string; modelName: string; kind: ModelKind; generations: number; credits: number }>;
  timeline: Array<{ date: string; generations: number; credits: number }>;
  recentGenerations: Generation[];
}

/* ------------------------------------------------------------------ */
/* Enveloppes d'erreur API                                             */
/* ------------------------------------------------------------------ */

export const API_ERROR_CODES = [
  'validation_error',
  'authentication_error',
  'permission_error',
  'not_found',
  'conflict',
  'insufficient_credits',
  'rate_limited',
  'provider_error',
  'provider_timeout',
  'provider_not_configured',
  'upload_error',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Details de validation champ par champ (jamais de secret). */
    fields?: Record<string, string>;
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
