import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, Copy, Link2, Play, Plus, Trash2, Workflow as WorkflowIcon, X,
} from 'lucide-react';
import type {
  FilesParamSpec, ModelSummary, Workflow, WorkflowInputBinding, WorkflowStep,
} from '@nova/shared';
import { computeCreditCost, defaultParamValues, isParamVisible } from '@nova/shared';
import { ApiError, api } from '../lib/api';
import { useInvalidateWorkspace, useModels, useWorkflowRun, useWorkflowRuns, useWorkflows } from '../lib/queries';
import { useAuth } from '../context/AuthContext';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input,
  InlineNotice, Modal, PageHeader, ProgressBar, Select, Skeleton, Textarea, useToast,
} from '../components/ui';
import { ParamControl } from '../components/generation/ParamControl';
import { FilePicker } from '../components/generation/FilePicker';
import { StateBadge } from '../components/generation/GenerationCard';
import { formatRelative } from '../lib/format';

interface DraftStep {
  key: string;
  name: string;
  modelKey: string;
  prompt: string;
  params: Record<string, unknown>;
  inputs: WorkflowInputBinding[];
}

function emptyStep(model: ModelSummary, index: number): DraftStep {
  const params = defaultParamValues(model) as Record<string, unknown>;
  delete params.prompt;
  return {
    key: `step-${Date.now()}-${index}`,
    name: `Etape ${index + 1}`,
    modelKey: model.key,
    prompt: '',
    params,
    inputs: [],
  };
}

/**
 * Editeur de workflow.
 * Les etapes s'executent sequentiellement ; chaque etape peut reprendre les
 * sorties d'une etape precedente comme fichiers d'entree. L'architecture des
 * etapes est typee cote partage (`WorkflowStep.type`), ce qui permet d'ajouter
 * d'autres types d'etapes sans refondre cet ecran.
 */
function WorkflowEditor({
  open, onClose, models, initial, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  models: ModelSummary[];
  initial: Workflow | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    initial
      ? initial.steps.map((step, index) => ({
          key: `existing-${step.id}-${index}`,
          name: step.name,
          modelKey: step.modelKey,
          prompt: step.prompt,
          params: step.params,
          inputs: step.inputs,
        }))
      : models[0]
        ? [emptyStep(models[0], 0)]
        : [],
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Les erreurs locales n'apparaissent qu'apres une tentative d'enregistrement. */
  const [attempted, setAttempted] = useState(false);

  const estimated = useMemo(
    () =>
      steps.reduce((total, step) => {
        const model = models.find((m) => m.key === step.modelKey);
        return model ? total + computeCreditCost(model, step.params, 1) : total;
      }, 0),
    [steps, models],
  );

  /**
   * Validation locale, alignee sur celle du serveur : une etape dont le
   * modele exige un prompt ne peut pas etre enregistree sans texte.
   */
  const localErrors = useMemo(() => {
    const found: Record<number, string> = {};
    steps.forEach((step, index) => {
      const model = models.find((m) => m.key === step.modelKey);
      if (!model) {
        found[index] = 'Modele introuvable ou desactive.';
        return;
      }
      const promptSpec = model.params.find(
        (p) => (p.type === 'text' || p.type === 'textarea') && p.required,
      );
      if (promptSpec && !step.prompt.trim()) {
        found[index] = `Le modele ${model.name} exige un prompt pour cette etape.`;
      }
    });
    return found;
  }, [steps, models]);

  const canSave = name.trim().length > 0 && steps.length > 0 && Object.keys(localErrors).length === 0;

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function changeModel(index: number, modelKey: string) {
    const model = models.find((m) => m.key === modelKey);
    if (!model) return;
    const params = defaultParamValues(model) as Record<string, unknown>;
    delete params.prompt;
    // Les liaisons d'entree ne sont conservees que si le nouveau modele
    // expose encore le parametre fichier correspondant.
    const inputs = steps[index].inputs.filter((binding) =>
      model.params.some((p) => p.id === binding.paramId && p.type === 'files'),
    );
    updateStep(index, { modelKey, params, inputs });
  }

  async function save() {
    setAttempted(true);
    if (!canSave) return;
    setSaving(true);
    setErrors({});
    try {
      const payload = {
        name,
        description,
        steps: steps.map((step) => ({
          name: step.name,
          modelKey: step.modelKey,
          prompt: step.prompt,
          params: step.params,
          inputs: step.inputs,
        })),
      };
      if (initial) await api.put(`/workflows/${initial.id}`, payload);
      else await api.post('/workflows', payload);
      toast.success(initial ? 'Workflow mis a jour' : 'Workflow cree');
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        const detail = Object.values(err.fields).join(' ');
        toast.error(err.title, detail || err.message);
      } else {
        toast.error('Enregistrement impossible');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={initial ? 'Modifier le workflow' : 'Nouveau workflow'}
      description="Enchainez plusieurs generations : la sortie d'une etape alimente la suivante."
      footer={
        <>
          <span className="mr-auto text-[13px] text-secondary-fg">
            Cout estime : <span className="font-semibold text-[var(--text-primary)]">{estimated} credits</span>
          </span>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={saving} onClick={save}>Enregistrer</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom du workflow" required error={errors.name} htmlFor="wf-name">
            <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Visuel produit complet" />
          </Field>
          <Field label="Description" htmlFor="wf-desc">
            <Input id="wf-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A quoi sert ce workflow ?" />
          </Field>
        </div>

        {errors.steps ? <InlineNotice tone="danger" title="Etapes invalides">{errors.steps}</InlineNotice> : null}

        <div className="space-y-3">
          {steps.map((step, index) => {
            const model = models.find((m) => m.key === step.modelKey);
            const fileParams = model?.params.filter((p) => p.type === 'files') ?? [];
            const configurable = model
              ? model.params.filter(
                  (p) =>
                    p.id !== 'prompt' &&
                    p.type !== 'files' &&
                    isParamVisible(p, { ...step.params, prompt: step.prompt }),
                )
              : [];
            const stepErrors = Object.entries(errors)
              .filter(([key]) => key.startsWith(`steps.${index}.`))
              .map(([, message]) => message);

            return (
              <div key={step.key}>
                {index > 0 ? (
                  <div className="flex justify-center py-1">
                    <ArrowDown className="size-4 text-[var(--text-muted)]" aria-hidden />
                  </div>
                ) : null}
                <Card className="overflow-visible">
                  <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[12px] font-semibold text-[var(--accent-text)]">
                      {index + 1}
                    </span>
                    <Input
                      value={step.name}
                      onChange={(e) => updateStep(index, { name: e.target.value })}
                      className="h-8 flex-1"
                      aria-label={`Nom de l'etape ${index + 1}`}
                    />
                    {steps.length > 1 ? (
                      <button
                        type="button"
                        aria-label="Supprimer l'etape"
                        onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                        className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)]"
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </div>

                  <div className="space-y-4 p-4">
                    {stepErrors.length > 0 ? (
                      <InlineNotice tone="danger">{stepErrors.join(' ')}</InlineNotice>
                    ) : null}

                    <Field label="Modele" required>
                      <Select value={step.modelKey} onChange={(e) => changeModel(index, e.target.value)}>
                        {models.map((m) => (
                          <option key={m.key} value={m.key}>{m.name} — {m.baseCost} cr.</option>
                        ))}
                      </Select>
                    </Field>

                    <Field
                      label="Prompt"
                      required
                      error={attempted ? localErrors[index] : undefined}
                      hint="Variables disponibles : {{input.prompt}} (prompt saisi au lancement), {{stepN.prompt}}."
                    >
                      <Textarea
                        value={step.prompt}
                        rows={3}
                        invalid={attempted && Boolean(localErrors[index])}
                        onChange={(e) => updateStep(index, { prompt: e.target.value })}
                        placeholder="Decrivez ce que doit produire cette etape..."
                      />
                    </Field>

                    {fileParams.length > 0 ? (
                      <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)] p-3">
                        <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium">
                          <Link2 className="size-3.5 text-[var(--text-muted)]" aria-hidden />
                          Entrees fichiers
                        </p>
                        <div className="space-y-2">
                          {fileParams.map((param) => {
                            const binding = step.inputs.find((b) => b.paramId === param.id);
                            const value = binding
                              ? binding.source === 'upload'
                                ? 'upload'
                                : `step:${binding.stepIndex}`
                              : 'none';
                            return (
                              <div key={param.id} className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary-fg">
                                  {param.label}
                                </span>
                                <Select
                                  value={value}
                                  className="w-auto min-w-[180px]"
                                  aria-label={`Source pour ${param.label}`}
                                  onChange={(event) => {
                                    const next = event.target.value;
                                    const others = step.inputs.filter((b) => b.paramId !== param.id);
                                    if (next === 'none') return updateStep(index, { inputs: others });
                                    if (next === 'upload') {
                                      return updateStep(index, {
                                        inputs: [...others, { paramId: param.id, source: 'upload' }],
                                      });
                                    }
                                    const stepIndex = Number(next.split(':')[1]);
                                    updateStep(index, {
                                      inputs: [...others, { paramId: param.id, source: 'step', stepIndex, limit: 1 }],
                                    });
                                  }}
                                >
                                  <option value="none">Non utilise</option>
                                  <option value="upload">Fichiers fournis au lancement</option>
                                  {steps.slice(0, index).map((previous, i) => (
                                    <option key={previous.key} value={`step:${i}`}>
                                      Sortie de l'etape {i + 1} ({previous.name})
                                    </option>
                                  ))}
                                </Select>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {configurable.length > 0 ? (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {configurable.map((spec) => (
                          <ParamControl
                            key={spec.id}
                            spec={spec}
                            value={(step.params[spec.id] ?? null) as never}
                            onChange={(value) =>
                              updateStep(index, { params: { ...step.params, [spec.id]: value } })
                            }
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Card>
              </div>
            );
          })}
        </div>

        <Button
          variant="secondary"
          full
          icon={<Plus className="size-4" />}
          disabled={steps.length >= 10 || models.length === 0}
          onClick={() => models[0] && setSteps((current) => [...current, emptyStep(models[0], current.length)])}
        >
          Ajouter une etape {steps.length >= 10 ? '(10 maximum)' : ''}
        </Button>
      </div>
    </Modal>
  );
}


/**
 * Dialogue de lancement.
 * N'apparait que si le workflow attend quelque chose au demarrage : des
 * fichiers (etape liee a « Fichiers fournis au lancement ») ou un prompt
 * global reference par {{input.prompt}}.
 */
function LaunchDialog({
  workflow, models, onClose, onLaunched,
}: {
  workflow: Workflow | null;
  models: ModelSummary[];
  onClose: () => void;
  onLaunched: (runId: string) => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateWorkspace();
  const { refresh } = useAuth();
  const [uploads, setUploads] = useState<Record<string, string[]>>({});
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setUploads({}); setPrompt(''); }, [workflow?.id]);

  // Parametres fichiers a alimenter au lancement, dedupliques par identifiant.
  const requiredUploads = useMemo(() => {
    if (!workflow) return [];
    const found = new Map<string, { spec: FilesParamSpec; stepName: string }>();
    for (const step of workflow.steps) {
      const model = models.find((m) => m.key === step.modelKey);
      if (!model) continue;
      for (const binding of step.inputs) {
        if (binding.source !== 'upload' || found.has(binding.paramId)) continue;
        const spec = model.params.find((p) => p.id === binding.paramId);
        if (spec?.type === 'files') found.set(binding.paramId, { spec, stepName: step.name });
      }
    }
    return [...found.values()];
  }, [workflow, models]);

  const needsPrompt = Boolean(workflow?.steps.some((step) => step.prompt.includes('{{input.prompt}}')));

  const missing = requiredUploads.filter(
    ({ spec }) => (uploads[spec.id]?.length ?? 0) < spec.minItems,
  );
  const canLaunch = missing.length === 0 && (!needsPrompt || prompt.trim().length > 0);

  async function launch() {
    if (!workflow) return;
    setBusy(true);
    try {
      const response = await api.post<{ run: { id: string } }>(`/workflows/${workflow.id}/run`, {
        uploads,
        prompt: prompt.trim() || undefined,
      });
      toast.success('Execution lancee', 'Les etapes s enchainent automatiquement.');
      invalidate(['workflow-runs', 'generations', 'credits']);
      void refresh();
      onLaunched(response.run.id);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.title : 'Lancement impossible',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(workflow)}
      onClose={onClose}
      title="Lancer le workflow"
      description={workflow?.name}
      footer={
        <>
          <span className="mr-auto text-[13px] text-secondary-fg">
            Cout estime :{' '}
            <span className="font-semibold text-[var(--text-primary)]">
              {workflow?.estimatedCredits ?? 0} credits
            </span>
          </span>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={busy} disabled={!canLaunch} icon={<Play className="size-4" />} onClick={launch}>
            Executer
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {needsPrompt ? (
          <Field
            label="Prompt de lancement"
            required
            hint="Substitue a {{input.prompt}} dans les etapes qui le referencent."
          >
            <Textarea
              value={prompt}
              rows={3}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Decrivez ce que doit produire cette execution..."
            />
          </Field>
        ) : null}

        {requiredUploads.map(({ spec, stepName }) => (
          <Field
            key={spec.id}
            label={`${spec.label} — ${stepName}`}
            required={spec.minItems > 0}
            hint={spec.help}
          >
            <FilePicker
              value={uploads[spec.id] ?? []}
              onChange={(ids) => setUploads((current) => ({ ...current, [spec.id]: ids }))}
              accept={spec.accept}
              minItems={spec.minItems}
              maxItems={spec.maxItems}
            />
          </Field>
        ))}

        {!needsPrompt && requiredUploads.length === 0 ? (
          <InlineNotice tone="info">
            Ce workflow n'attend aucune entree : les {workflow?.steps.length} etapes seront
            executees telles qu'elles sont configurees.
          </InlineNotice>
        ) : null}
      </div>
    </Modal>
  );
}

/** Suivi detaille d'une execution, etape par etape. */
function RunMonitor({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const { data: run, isLoading } = useWorkflowRun(runId);
  const toast = useToast();
  const invalidate = useInvalidateWorkspace();

  async function cancel() {
    if (!runId) return;
    try {
      await api.post(`/workflows/runs/${runId}/cancel`);
      toast.info('Execution annulee');
      invalidate(['workflow-runs', 'generations', 'credits']);
    } catch (err) {
      toast.error('Annulation impossible', err instanceof ApiError ? err.message : undefined);
    }
  }

  const done = run ? run.steps.filter((s) => s.state === 'completed').length : 0;

  return (
    <Modal
      open={Boolean(runId)}
      onClose={onClose}
      size="lg"
      title="Execution du workflow"
      description={run?.workflowName}
      footer={
        <>
          {run && ['queued', 'running'].includes(run.state) ? (
            <Button variant="ghost" onClick={cancel}>Annuler l'execution</Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>Fermer</Button>
        </>
      }
    >
      {isLoading || !run ? (
        <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <Badge
                tone={
                  run.state === 'completed' ? 'success'
                    : run.state === 'failed' ? 'danger'
                      : run.state === 'cancelled' ? 'neutral' : 'accent'
                }
              >
                {{ queued: 'En file', running: 'En cours', completed: 'Termine', failed: 'Echec', cancelled: 'Annulee' }[run.state]}
              </Badge>
              <span className="tabular-nums text-secondary-fg">
                {done}/{run.totalSteps} etapes — {run.creditCost} credits
              </span>
            </div>
            <ProgressBar
              value={(done / Math.max(1, run.totalSteps)) * 100}
              tone={run.state === 'failed' ? 'danger' : run.state === 'completed' ? 'success' : 'accent'}
            />
          </div>

          {run.errorMessage ? <InlineNotice tone="danger" title="Erreur">{run.errorMessage}</InlineNotice> : null}

          <ol className="space-y-2">
            {run.steps.map((step) => (
              <li key={step.id} className="rounded-[10px] border border-[var(--border-subtle)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[11px] font-semibold">
                      {step.position + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{step.name}</p>
                      <p className="truncate text-[11px] text-muted-fg">{step.modelKey}</p>
                    </div>
                  </div>
                  {step.state === 'pending' ? (
                    <Badge>En attente</Badge>
                  ) : (
                    <StateBadge state={step.state} animated />
                  )}
                </div>
                {step.errorMessage ? (
                  <p className="mt-2 text-[12px] text-[var(--danger)]">{step.errorMessage}</p>
                ) : null}
                {step.generation?.assets.filter((a) => a.kind === 'output').length ? (
                  <div className="mt-2.5 flex gap-2">
                    {step.generation.assets
                      .filter((a) => a.kind === 'output')
                      .map((asset) => (
                        <img
                          key={asset.id}
                          src={asset.url}
                          alt=""
                          className="size-16 rounded-lg border border-[var(--border-subtle)] object-cover"
                        />
                      ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}

export function WorkflowsPage() {
  const { data: models } = useModels();
  const { data: workflows, isLoading, error, refetch } = useWorkflows();
  const { data: runs } = useWorkflowRuns();
  const toast = useToast();

  const [editing, setEditing] = useState<Workflow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Workflow | null>(null);
  const [launchTarget, setLaunchTarget] = useState<Workflow | null>(null);

  async function duplicate(workflow: Workflow) {
    try {
      await api.post(`/workflows/${workflow.id}/duplicate`);
      toast.success('Workflow duplique');
      void refetch();
    } catch (err) {
      toast.error('Duplication impossible', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function remove(workflow: Workflow) {
    try {
      await api.delete(`/workflows/${workflow.id}`);
      toast.success('Workflow supprime');
      void refetch();
    } catch (err) {
      toast.error('Suppression impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setPendingDelete(null);
    }
  }

  const activeRuns = (runs ?? []).filter((run) => ['queued', 'running'].includes(run.state));

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Automatisez des enchainements de generations reutilisables."
        actions={
          <Button
            icon={<Plus className="size-4" />}
            disabled={!models?.length}
            onClick={() => { setEditing(null); setEditorOpen(true); }}
          >
            Nouveau workflow
          </Button>
        }
      />

      {activeRuns.length > 0 ? (
        <Card className="mb-5">
          <CardHeader title="Executions en cours" description={`${activeRuns.length} workflow(s) en cours d execution`} />
          <ul className="divide-y divide-[var(--border-subtle)]">
            {activeRuns.map((run) => (
              <li key={run.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{run.workflowName}</p>
                  <p className="text-[11px] text-muted-fg">
                    Etape {run.currentStep + 1}/{run.totalSteps} — {formatRelative(run.createdAt)}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setRunId(run.id)}>Suivre</Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {error ? (
        <Card><ErrorState onRetry={() => void refetch()} /></Card>
      ) : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44" /><Skeleton className="h-44" />
        </div>
      ) : workflows && workflows.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workflows.map((workflow) => (
            <Card key={workflow.id} className="flex flex-col">
              <CardHeader
                icon={<WorkflowIcon className="size-4" />}
                title={workflow.name}
                description={workflow.description || `${workflow.steps.length} etape(s)`}
              />
              <div className="flex-1 space-y-3 p-4">
                <ol className="space-y-1.5">
                  {workflow.steps.map((step: WorkflowStep, index) => (
                    <li key={step.id} className="flex items-center gap-2 text-[12.5px]">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[10px] font-semibold">
                        {index + 1}
                      </span>
                      <span className="truncate">{step.name}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-fg">{step.modelName}</span>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="accent">{workflow.estimatedCredits} credits / execution</Badge>
                  <Badge>{workflow.runCount} execution(s)</Badge>
                  {workflow.lastRun ? (
                    <Badge tone={workflow.lastRun.state === 'completed' ? 'success' : workflow.lastRun.state === 'failed' ? 'danger' : 'info'}>
                      Derniere : {formatRelative(workflow.lastRun.createdAt)}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1.5 border-t border-[var(--border-subtle)] p-3">
                <Button
                  size="sm"
                  icon={<Play className="size-3.5" />}
                  onClick={() => setLaunchTarget(workflow)}
                >
                  Executer
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(workflow); setEditorOpen(true); }}>
                  Modifier
                </Button>
                <Button size="sm" variant="ghost" aria-label="Dupliquer" onClick={() => duplicate(workflow)}>
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Supprimer"
                  className="ml-auto text-[var(--danger)]"
                  onClick={() => setPendingDelete(workflow)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<WorkflowIcon className="size-5" />}
            title="Aucun workflow"
            description="Creez un enchainement d etapes reutilisable : par exemple generer une image puis en produire une variante."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>
                Creer un workflow
              </Button>
            }
          />
        </Card>
      )}

      {editorOpen && models ? (
        <WorkflowEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          models={models}
          initial={editing}
          onSaved={() => void refetch()}
        />
      ) : null}

      <LaunchDialog
        workflow={launchTarget}
        models={models ?? []}
        onClose={() => setLaunchTarget(null)}
        onLaunched={setRunId}
      />

      <RunMonitor runId={runId} onClose={() => setRunId(null)} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && void remove(pendingDelete)}
        title="Supprimer le workflow"
        description={pendingDelete?.name}
        confirmLabel="Supprimer"
        consequences={[
          'Le workflow et ses etapes sont definitivement supprimes.',
          'Les generations deja produites restent dans votre historique.',
        ]}
      />
    </>
  );
}
