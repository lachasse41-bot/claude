import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../middleware/error.js';
import { clientIp, currentUser, requireAuth } from '../middleware/context.js';
import { logActivity } from '../services/activity.js';
import {
  cancelRun, createWorkflow, deleteWorkflow, duplicateWorkflow, getRun, getWorkflow,
  listRuns, listWorkflows, startRun, updateWorkflow,
} from '../services/workflows.js';
import { scopedUserId, viewerOf } from './helpers.js';

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

const bindingSchema = z.object({
  paramId: z.string().min(1),
  source: z.enum(['upload', 'step']),
  stepIndex: z.number().int().min(0).max(9).optional(),
  limit: z.number().int().min(1).max(8).optional(),
});

const stepSchema = z.object({
  name: z.string().trim().min(1, "Nom de l'etape requis.").max(120),
  modelKey: z.string().min(1, 'Modele requis.'),
  prompt: z.string().max(5000).optional(),
  params: z.record(z.unknown()).optional(),
  inputs: z.array(bindingSchema).max(6).optional(),
});

const workflowSchema = z.object({
  name: z.string().trim().min(1, 'Nom requis.').max(120),
  description: z.string().max(500).optional(),
  steps: z.array(stepSchema).min(1, 'Au moins une etape est requise.').max(10),
});

workflowsRouter.get('/', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  res.json({ workflows: listWorkflows(user.organization_id, scopedUserId(req)) });
}));

workflowsRouter.post('/', asyncRoute(async (req, res) => {
  const input = workflowSchema.parse(req.body);
  const user = currentUser(req);
  const workflow = createWorkflow(input, viewerOf(req));
  logActivity({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'workflow.created',
    entityType: 'workflow',
    entityId: workflow.id,
    metadata: { steps: workflow.steps.length },
    ip: clientIp(req),
  });
  res.status(201).json({ workflow });
}));

workflowsRouter.get('/runs', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  res.json({ runs: listRuns(user.organization_id, scopedUserId(req)) });
}));

workflowsRouter.get('/runs/:runId', asyncRoute(async (req, res) => {
  res.json({ run: getRun(req.params.runId, viewerOf(req)) });
}));

workflowsRouter.post('/runs/:runId/cancel', asyncRoute(async (req, res) => {
  res.json({ run: cancelRun(req.params.runId, viewerOf(req)) });
}));

workflowsRouter.get('/:workflowId', asyncRoute(async (req, res) => {
  res.json({ workflow: getWorkflow(req.params.workflowId, viewerOf(req)) });
}));

workflowsRouter.put('/:workflowId', asyncRoute(async (req, res) => {
  const input = workflowSchema.parse(req.body);
  res.json({ workflow: updateWorkflow(req.params.workflowId, input, viewerOf(req)) });
}));

workflowsRouter.post('/:workflowId/duplicate', asyncRoute(async (req, res) => {
  res.status(201).json({ workflow: duplicateWorkflow(req.params.workflowId, viewerOf(req)) });
}));

workflowsRouter.delete('/:workflowId', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  deleteWorkflow(req.params.workflowId, viewerOf(req));
  logActivity({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'workflow.deleted',
    entityType: 'workflow',
    entityId: req.params.workflowId,
    ip: clientIp(req),
  });
  res.json({ ok: true });
}));

const runSchema = z.object({
  uploads: z.record(z.array(z.string())).optional(),
  prompt: z.string().max(5000).optional(),
});

workflowsRouter.post('/:workflowId/run', asyncRoute(async (req, res) => {
  const input = runSchema.parse(req.body ?? {});
  const user = currentUser(req);
  const run = startRun({ workflowId: req.params.workflowId, ...input }, viewerOf(req));
  logActivity({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'workflow.run_started',
    entityType: 'workflow_run',
    entityId: run.id,
    metadata: { workflowId: req.params.workflowId, steps: run.totalSteps },
    ip: clientIp(req),
  });
  res.status(201).json({ run });
}));
