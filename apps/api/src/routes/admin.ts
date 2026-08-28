import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../middleware/error.js';
import { clientIp, currentUser, requireAuth, requireRole } from '../middleware/context.js';
import { badRequest, conflict } from '../lib/errors.js';
import { listActivity, logActivity } from '../services/activity.js';
import { adminOverview } from '../services/analytics.js';
import { createInvitation, listInvitations, revokeInvitation } from '../services/auth.js';
import {
  applyLedgerEntry, getBalance, listTransactions, setOverdraft,
} from '../services/credits.js';
import { deleteStoredFiles } from '../services/files.js';
import {
  deleteModel, listModels, restoreCatalog, setModelEnabled, upsertModel,
} from '../services/models.js';
import { getOrganization, renameOrganization, updateSettings } from '../services/organizations.js';
import {
  getApiConfigurationStatus, recordConnectivityCheck, updateApiConfiguration,
} from '../services/apiConfig.js';
import { checkConnectivity } from '../providers/kie/client.js';
import {
  createUser, deleteUser, getUserFootprint, listUsers, requireUser, setUserRole,
  setUserStatus, toPublicUser,
} from '../services/users.js';
import { emailSchema, nameSchema, paginationSchema, passwordSchema, str } from './helpers.js';

export const adminRouter = Router();

// Toutes les routes de ce module exigent le role administrateur, verifie
// cote serveur (l'interface se contente de masquer les entrees de menu).
adminRouter.use(requireAuth, requireRole('admin'));

function actor(req: Parameters<typeof currentUser>[0]) {
  const user = currentUser(req);
  return {
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
  };
}

/* --------------------------- Supervision --------------------------- */

adminRouter.get('/overview', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const days = Math.min(180, Math.max(7, Number.parseInt(String(req.query.days ?? '30'), 10) || 30));
  res.json(adminOverview(user.organization_id, days));
}));

adminRouter.get('/activity', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const { page, pageSize } = paginationSchema.parse(req.query);
  res.json(
    listActivity({
      organizationId: user.organization_id,
      actorUserId: str(req.query.actorUserId),
      action: str(req.query.action),
      search: str(req.query.search),
      from: str(req.query.from),
      to: str(req.query.to),
      page,
      pageSize,
    }),
  );
}));

adminRouter.get('/credits', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const { page, pageSize } = paginationSchema.parse(req.query);
  res.json(
    listTransactions({
      organizationId: user.organization_id,
      userId: str(req.query.userId),
      type: str(req.query.type) as never,
      from: str(req.query.from),
      to: str(req.query.to),
      page,
      pageSize,
    }),
  );
}));

/* --------------------------- Collaborateurs ------------------------ */

adminRouter.get('/users', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const { page, pageSize } = paginationSchema.parse(req.query);
  res.json(
    listUsers({
      organizationId: user.organization_id,
      search: str(req.query.search),
      role: str(req.query.role) as never,
      status: str(req.query.status) as never,
      sort: (str(req.query.sort) as 'name' | 'created' | 'credits' | 'activity') ?? 'created',
      page,
      pageSize,
    }),
  );
}));

const createUserSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  password: passwordSchema,
  role: z.enum(['admin', 'collaborator']),
  initialCredits: z.number().int().min(0).max(1_000_000).optional(),
});

/** Creation directe d'un compte (alternative a l'invitation). */
adminRouter.post('/users', asyncRoute(async (req, res) => {
  const input = createUserSchema.parse(req.body);
  const context = actor(req);
  const created = createUser({
    organizationId: context.organizationId,
    email: input.email,
    name: input.name,
    password: input.password,
    role: input.role,
    initialCredits: input.initialCredits,
    actorUserId: context.actorUserId,
  });
  logActivity({
    ...context,
    targetUserId: created.id,
    targetName: created.name,
    action: 'admin.user_created',
    entityType: 'user',
    entityId: created.id,
    metadata: { role: created.role, initialCredits: input.initialCredits ?? null },
    ip: clientIp(req),
  });
  res.status(201).json({ user: created });
}));

adminRouter.get('/users/:userId', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const target = requireUser(user.organization_id, req.params.userId);
  res.json({
    user: toPublicUser(target),
    credits: getBalance(target.id),
    footprint: getUserFootprint(user.organization_id, target.id),
  });
}));

const statusSchema = z.object({ status: z.enum(['active', 'disabled']) });

adminRouter.patch('/users/:userId/status', asyncRoute(async (req, res) => {
  const { status } = statusSchema.parse(req.body);
  const context = actor(req);
  const updated = setUserStatus(context.organizationId, req.params.userId, status);
  logActivity({
    ...context,
    targetUserId: updated.id,
    targetName: updated.name,
    action: status === 'active' ? 'admin.user_enabled' : 'admin.user_disabled',
    entityType: 'user',
    entityId: updated.id,
    ip: clientIp(req),
  });
  res.json({ user: updated });
}));

adminRouter.patch('/users/:userId/role', asyncRoute(async (req, res) => {
  const { role } = z.object({ role: z.enum(['admin', 'collaborator']) }).parse(req.body);
  const context = actor(req);
  const updated = setUserRole(context.organizationId, req.params.userId, role);
  logActivity({
    ...context,
    targetUserId: updated.id,
    targetName: updated.name,
    action: 'admin.user_role_changed',
    entityType: 'user',
    entityId: updated.id,
    metadata: { role },
    ip: clientIp(req),
  });
  res.json({ user: updated });
}));

const deleteSchema = z.object({
  /** Confirmation explicite : l'e-mail exact du compte doit etre saisi. */
  confirmEmail: z.string().min(1, 'Confirmation requise.'),
});

/**
 * Suppression definitive d'un collaborateur et de toutes ses donnees.
 * Double protection : confirmation explicite par saisie de l'e-mail, et
 * impossibilite de supprimer son propre compte ou le dernier administrateur.
 */
adminRouter.delete('/users/:userId', asyncRoute(async (req, res) => {
  const { confirmEmail } = deleteSchema.parse(req.body ?? {});
  const context = actor(req);
  if (req.params.userId === context.actorUserId) {
    throw conflict('Vous ne pouvez pas supprimer votre propre compte.');
  }
  const target = requireUser(context.organizationId, req.params.userId);
  if (confirmEmail.trim().toLowerCase() !== target.email_lower) {
    throw badRequest("L'adresse e-mail de confirmation ne correspond pas au compte a supprimer.", {
      confirmEmail: 'Adresse e-mail incorrecte.',
    });
  }

  const result = deleteUser(context.organizationId, req.params.userId);
  deleteStoredFiles(result.filePaths);
  logActivity({
    ...context,
    targetUserId: result.user.id,
    targetName: result.user.name,
    action: 'admin.user_deleted',
    entityType: 'user',
    entityId: result.user.id,
    metadata: { email: result.user.email, ...result.summary },
    ip: clientIp(req),
  });
  res.json({ ok: true, deleted: result.summary });
}));

/* ------------------------------ Credits ---------------------------- */

const creditSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000),
  type: z.enum(['grant', 'adjustment']).default('grant'),
  reason: z.string().max(200).optional(),
});

adminRouter.post('/users/:userId/credits', asyncRoute(async (req, res) => {
  const input = creditSchema.parse(req.body);
  const context = actor(req);
  const target = requireUser(context.organizationId, req.params.userId);
  const summary = applyLedgerEntry({
    organizationId: context.organizationId,
    userId: target.id,
    type: input.type,
    amount: input.amount,
    reason: input.reason?.trim() || 'Attribution de credits par un administrateur',
    actorUserId: context.actorUserId,
  });
  logActivity({
    ...context,
    targetUserId: target.id,
    targetName: target.name,
    action: 'admin.credits_granted',
    entityType: 'user',
    entityId: target.id,
    metadata: { amount: input.amount, type: input.type, balanceAfter: summary.balance },
    ip: clientIp(req),
  });
  res.json({ credits: summary });
}));

/**
 * Regle administrative d'exception : autorise un collaborateur a lancer une
 * generation malgre un solde insuffisant (decouvert).
 */
adminRouter.patch('/users/:userId/overdraft', asyncRoute(async (req, res) => {
  const { allow } = z.object({ allow: z.boolean() }).parse(req.body);
  const context = actor(req);
  const target = requireUser(context.organizationId, req.params.userId);
  setOverdraft(target.id, allow);
  logActivity({
    ...context,
    targetUserId: target.id,
    targetName: target.name,
    action: 'admin.overdraft_changed',
    entityType: 'user',
    entityId: target.id,
    metadata: { allow },
    ip: clientIp(req),
  });
  res.json({ credits: getBalance(target.id) });
}));

/* ---------------------------- Invitations -------------------------- */

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'collaborator']).default('collaborator'),
  initialCredits: z.number().int().min(0).max(1_000_000).optional(),
});

adminRouter.get('/invitations', asyncRoute(async (req, res) => {
  res.json({ invitations: listInvitations(currentUser(req).organization_id) });
}));

adminRouter.post('/invitations', asyncRoute(async (req, res) => {
  const input = inviteSchema.parse(req.body);
  const context = actor(req);
  const invitation = createInvitation({
    organizationId: context.organizationId,
    email: input.email,
    role: input.role,
    initialCredits: input.initialCredits,
    createdBy: context.actorUserId,
  });
  logActivity({
    ...context,
    action: 'admin.invitation_created',
    entityType: 'invitation',
    entityId: invitation.id,
    metadata: { email: invitation.email, role: invitation.role },
    ip: clientIp(req),
  });
  res.status(201).json({ invitation });
}));

adminRouter.delete('/invitations/:invitationId', asyncRoute(async (req, res) => {
  const context = actor(req);
  const invitation = revokeInvitation(context.organizationId, req.params.invitationId);
  logActivity({
    ...context,
    action: 'admin.invitation_revoked',
    entityType: 'invitation',
    entityId: invitation.id,
    metadata: { email: invitation.email },
    ip: clientIp(req),
  });
  res.json({ invitation });
}));

/* ------------------------------ Modeles ---------------------------- */

adminRouter.get('/models', asyncRoute(async (req, res) => {
  res.json({ models: listModels(currentUser(req).organization_id, { includeDisabled: true }) });
}));

const paramSchema: z.ZodType<unknown> = z.object({
  id: z.string().min(1),
  field: z.string().nullable(),
  label: z.string().min(1),
  help: z.string().optional(),
  group: z.enum(['reference', 'core', 'output', 'audio', 'advanced']),
  required: z.boolean().optional(),
  type: z.enum(['select', 'number', 'boolean', 'text', 'textarea', 'files']),
  visibleWhen: z.object({
    paramId: z.string(),
    equals: z.array(z.union([z.string(), z.number(), z.boolean()])),
  }).optional(),
  omitWhenValueIn: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
}).passthrough();

const modelSchema = z.object({
  key: z.string().min(2).max(61),
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  kind: z.enum(['image', 'video', 'audio']),
  family: z.string().max(60).optional(),
  providerModel: z.string().min(1).max(120),
  docsUrl: z.string().max(300).optional(),
  timeoutSeconds: z.number().int().min(30).max(3600).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
  integrationNotes: z.string().max(500).optional(),
  outputs: z.object({
    mode: z.enum(['fanout', 'provider']),
    field: z.string().optional(),
    min: z.number().int().min(1).max(16),
    max: z.number().int().min(1).max(16),
    default: z.number().int().min(1).max(16),
  }),
  credits: z.object({
    base: z.number().min(0).max(100_000),
    perOutput: z.boolean(),
    perUnit: z.object({ paramId: z.string(), creditsPerUnit: z.number().min(0) }).optional(),
    multipliers: z.array(z.object({
      paramId: z.string(),
      map: z.record(z.number()),
      fallback: z.number().optional(),
    })).optional(),
  }),
  params: z.array(paramSchema).min(1).max(30),
});

adminRouter.put('/models/:modelKey', asyncRoute(async (req, res) => {
  const input = modelSchema.parse({ ...req.body, key: req.params.modelKey });
  const context = actor(req);
  const model = upsertModel(context.organizationId, input as never);
  logActivity({
    ...context,
    action: 'admin.model_saved',
    entityType: 'model',
    entityId: model.key,
    metadata: { providerModel: model.providerModel, enabled: model.enabled },
    ip: clientIp(req),
  });
  res.json({ model });
}));

adminRouter.patch('/models/:modelKey/enabled', asyncRoute(async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const context = actor(req);
  const model = setModelEnabled(context.organizationId, req.params.modelKey, enabled);
  logActivity({
    ...context,
    action: enabled ? 'admin.model_enabled' : 'admin.model_disabled',
    entityType: 'model',
    entityId: model.key,
    ip: clientIp(req),
  });
  res.json({ model });
}));

adminRouter.delete('/models/:modelKey', asyncRoute(async (req, res) => {
  const context = actor(req);
  deleteModel(context.organizationId, req.params.modelKey);
  logActivity({
    ...context,
    action: 'admin.model_deleted',
    entityType: 'model',
    entityId: req.params.modelKey,
    ip: clientIp(req),
  });
  res.json({ ok: true });
}));

adminRouter.post('/models/restore-catalog', asyncRoute(async (req, res) => {
  const context = actor(req);
  const added = restoreCatalog(context.organizationId);
  logActivity({ ...context, action: 'admin.catalog_restored', metadata: { added }, ip: clientIp(req) });
  res.json({ added, models: listModels(context.organizationId, { includeDisabled: true }) });
}));

/* --------------------------- Parametres ---------------------------- */

adminRouter.get('/settings', asyncRoute(async (req, res) => {
  const organizationId = currentUser(req).organization_id;
  res.json({
    organization: getOrganization(organizationId),
    apiConfiguration: getApiConfigurationStatus(organizationId),
  });
}));

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  settings: z.object({
    allowOverdraftByDefault: z.boolean().optional(),
    defaultCollaboratorCredits: z.number().int().min(0).max(1_000_000).optional(),
    maxConcurrentGenerationsPerUser: z.number().int().min(1).max(50).optional(),
    maxUploadSizeMb: z.number().int().min(1).max(200).optional(),
    invitationsEnabled: z.boolean().optional(),
  }).optional(),
});

adminRouter.patch('/settings', asyncRoute(async (req, res) => {
  const input = settingsSchema.parse(req.body);
  const context = actor(req);
  if (input.name) renameOrganization(context.organizationId, input.name);
  if (input.settings) updateSettings(context.organizationId, input.settings);
  logActivity({
    ...context,
    action: 'admin.settings_updated',
    entityType: 'organization',
    entityId: context.organizationId,
    metadata: { ...input.settings, name: input.name },
    ip: clientIp(req),
  });
  res.json({ organization: getOrganization(context.organizationId) });
}));

/* -------------------------- Configuration API ---------------------- */

const apiConfigSchema = z.object({
  apiKey: z.string().max(300).nullable().optional(),
  baseUrl: z.string().url('URL invalide.').max(200).optional(),
});

/**
 * Enregistrement de la cle API KIE.ai.
 * La cle est chiffree (AES-256-GCM) avant stockage et n'est jamais renvoyee
 * au client : seuls les 4 derniers caracteres sont exposes.
 */
adminRouter.put('/api-configuration', asyncRoute(async (req, res) => {
  const input = apiConfigSchema.parse(req.body);
  const context = actor(req);
  const status = updateApiConfiguration(context.organizationId, input, context.actorUserId);
  logActivity({
    ...context,
    action: 'admin.api_configuration_updated',
    entityType: 'api_configuration',
    entityId: 'kie',
    metadata: { configured: status.configured, baseUrl: status.baseUrl },
    ip: clientIp(req),
  });
  res.json({ apiConfiguration: status });
}));

adminRouter.post('/api-configuration/test', asyncRoute(async (req, res) => {
  const organizationId = currentUser(req).organization_id;
  const result = await checkConnectivity(organizationId);
  recordConnectivityCheck(organizationId, result.ok ? 'ok' : 'error', result.message);
  res.json({ result, apiConfiguration: getApiConfigurationStatus(organizationId) });
}));
