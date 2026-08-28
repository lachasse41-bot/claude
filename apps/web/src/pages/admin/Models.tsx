import { useState } from 'react';
import { AlertTriangle, BookOpen, Plus, RotateCcw, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { ModelSummary } from '@nova/shared';
import { ApiError, api } from '../../lib/api';
import { useQuery, useQueryClient } from '../../lib/queries';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, InlineNotice,
  Input, Modal, PageHeader, Skeleton, Switch, Textarea, useToast,
} from '../../components/ui';
import { KIND_META } from '../../components/generation/ModelPicker';

const NEW_MODEL_TEMPLATE = {
  name: 'Nouveau modele',
  description: '',
  kind: 'image',
  family: '',
  providerModel: 'fournisseur/identifiant-du-modele',
  docsUrl: '',
  timeoutSeconds: 600,
  sortOrder: 100,
  enabled: false,
  outputs: { mode: 'fanout', min: 1, max: 4, default: 1 },
  credits: { base: 5, perOutput: true },
  params: [
    {
      id: 'prompt', field: 'prompt', label: 'Prompt', group: 'core',
      type: 'textarea', default: '', maxLength: 2000, required: true,
    },
    {
      id: 'aspect_ratio', field: 'aspect_ratio', label: 'Ratio', group: 'output',
      type: 'select', default: '1:1',
      options: [{ value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' }],
    },
  ],
};

/**
 * Gestion du catalogue.
 * La definition d'un modele est editee au format JSON : c'est cette structure
 * qui pilote directement les formulaires du studio, la validation serveur et
 * le calcul des credits. Aucun deploiement n'est necessaire pour ajouter,
 * modifier ou retirer un modele.
 */
export function AdminModelsPage() {
  const toast = useToast();
  const client = useQueryClient();
  const [editing, setEditing] = useState<{ key: string; json: string; isNew: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-models'],
    queryFn: () => api.get<{ models: ModelSummary[] }>('/admin/models').then((r) => r.models),
  });

  function refresh() {
    void refetch();
    void client.invalidateQueries({ queryKey: ['models'] });
  }

  async function toggle(model: ModelSummary) {
    try {
      await api.patch(`/admin/models/${model.key}/enabled`, { enabled: !model.enabled });
      toast.success(model.enabled ? `${model.name} desactive` : `${model.name} active`);
      refresh();
    } catch (err) {
      toast.error('Action impossible', err instanceof ApiError ? err.message : undefined);
    }
  }

  function openEditor(model?: ModelSummary) {
    if (model) {
      const { id, enabled, baseCost, ...definition } = model;
      setEditing({ key: model.key, json: JSON.stringify(definition, null, 2), isNew: false });
    } else {
      setEditing({ key: '', json: JSON.stringify(NEW_MODEL_TEMPLATE, null, 2), isNew: true });
    }
  }

  async function save() {
    if (!editing) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(editing.json);
    } catch {
      toast.error('JSON invalide', 'Verifiez la syntaxe de la definition.');
      return;
    }
    const key = editing.isNew ? String(payload.key ?? editing.key) : editing.key;
    if (!key) {
      toast.error('Cle manquante', 'Renseignez le champ "key" du modele.');
      return;
    }
    setBusy(true);
    try {
      await api.put(`/admin/models/${key}`, payload);
      toast.success('Modele enregistre', 'Il est immediatement disponible dans le studio.');
      setEditing(null);
      refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.title : 'Enregistrement impossible',
        err instanceof ApiError
          ? [err.message, ...Object.entries(err.fields).map(([k, v]) => `${k} : ${v}`)].join(' ')
          : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.delete(`/admin/models/${deleteTarget.key}`);
      toast.success('Modele supprime');
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      toast.error('Suppression impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function restoreCatalog() {
    try {
      const response = await api.post<{ added: number }>('/admin/models/restore-catalog');
      toast.success(
        response.added > 0 ? `${response.added} modele(s) restaure(s)` : 'Catalogue deja complet',
      );
      refresh();
    } catch {
      toast.error('Restauration impossible');
    }
  }

  const unverified = (data ?? []).filter(
    (model) => model.providerModelVerification === 'unverified' && model.enabled,
  );

  return (
    <>
      <PageHeader
        title="Modeles IA"
        description="Catalogue des modeles disponibles pour l'organisation."
        actions={
          <>
            <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={restoreCatalog}>
              Restaurer le catalogue
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => openEditor()}>
              Ajouter un modele
            </Button>
          </>
        }
      />

      {unverified.length > 0 ? (
        <div className="mb-5">
          <InlineNotice
            tone="warning"
            title="Identifiants a confirmer"
            icon={<AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />}
          >
            {unverified.length} modele(s) actif(s) utilisent un identifiant provider ou des noms de
            champs qui doivent etre verifies dans la documentation KIE.ai :{' '}
            <span className="font-medium">{unverified.map((m) => m.name).join(', ')}</span>.
            Corrigez-les ici si necessaire — aucun redeploiement n'est requis.
          </InlineNotice>
        </div>
      ) : null}

      {error ? (
        <Card><ErrorState onRetry={() => void refetch()} /></Card>
      ) : isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((model) => {
            const Icon = KIND_META[model.kind].icon;
            return (
              <Card key={model.key}>
                <CardHeader
                  icon={<Icon className="size-4" />}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {model.name}
                      <Badge tone={model.enabled ? 'success' : 'neutral'}>
                        {model.enabled ? 'Actif' : 'Desactive'}
                      </Badge>
                      {model.providerModelVerification === 'unverified' ? (
                        <Badge tone="warning">A verifier</Badge>
                      ) : null}
                    </span>
                  }
                  description={model.description}
                  action={<Switch checked={model.enabled} onChange={() => toggle(model)} />}
                />
                <div className="space-y-3 p-4 text-[12.5px]">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="col-span-2 min-w-0">
                      <dt className="text-muted-fg">Identifiant provider</dt>
                      <dd className="truncate font-mono text-[12px]">{model.providerModel}</dd>
                    </div>
                    <div><dt className="text-muted-fg">Cle interne</dt><dd className="font-mono text-[12px]">{model.key}</dd></div>
                    <div><dt className="text-muted-fg">Cout de base</dt><dd>{model.baseCost} credits</dd></div>
                    <div><dt className="text-muted-fg">Parametres</dt><dd>{model.params.length}</dd></div>
                    <div><dt className="text-muted-fg">Sorties</dt><dd>{model.outputs.min} a {model.outputs.max}</dd></div>
                  </dl>

                  {model.integrationNotes ? (
                    <p className="rounded-lg bg-[var(--warning-soft)] p-2.5 text-[12px] text-[var(--warning)]">
                      {model.integrationNotes}
                    </p>
                  ) : null}

                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openEditor(model)}>
                      Modifier la definition
                    </Button>
                    {model.docsUrl ? (
                      <a href={model.docsUrl} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="ghost" icon={<BookOpen className="size-3.5" />}>Doc</Button>
                      </a>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Supprimer"
                      className="ml-auto text-[var(--danger)]"
                      onClick={() => setDeleteTarget(model)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<SlidersHorizontal className="size-5" />}
            title="Aucun modele"
            description="Restaurez le catalogue par defaut ou ajoutez votre propre modele."
            action={<Button onClick={restoreCatalog}>Restaurer le catalogue</Button>}
          />
        </Card>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        size="xl"
        title={editing?.isNew ? 'Ajouter un modele' : `Modifier ${editing?.key}`}
        description="La definition pilote directement les formulaires du studio, la validation serveur et le calcul des credits."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Annuler</Button>
            <Button loading={busy} icon={<Save className="size-4" />} onClick={save}>Enregistrer</Button>
          </>
        }
      >
        <div className="space-y-4">
          <InlineNotice tone="info" title="Structure attendue">
            <ul className="mt-1 space-y-0.5">
              <li><code>key</code>, <code>name</code>, <code>kind</code> (image / video / audio), <code>providerModel</code></li>
              <li><code>params[]</code> : chaque parametre declare <code>id</code>, <code>field</code> (nom du champ envoye a KIE.ai), <code>type</code>, <code>group</code></li>
              <li><code>credits</code> : <code>base</code>, <code>perOutput</code>, et si besoin <code>perUnit</code> / <code>multipliers</code></li>
              <li><code>outputs</code> : bornes du nombre de generations</li>
            </ul>
          </InlineNotice>

          {editing?.isNew ? (
            <Field label="Cle du modele" hint="Minuscules, chiffres et tirets. Elle doit aussi figurer dans le JSON.">
              <Input
                value={editing.key}
                onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                placeholder="mon-modele"
              />
            </Field>
          ) : null}

          <Field label="Definition (JSON)">
            <Textarea
              value={editing?.json ?? ''}
              onChange={(e) => editing && setEditing({ ...editing, json: e.target.value })}
              rows={22}
              spellCheck={false}
              className="font-mono text-[12px] leading-relaxed"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={busy}
        title="Supprimer le modele"
        description={deleteTarget?.name}
        confirmLabel="Supprimer"
        consequences={[
          'Le modele disparait definitivement du catalogue.',
          "La suppression est refusee s'il a deja servi a une generation : desactivez-le plutot pour conserver l'historique.",
        ]}
      />
    </>
  );
}
