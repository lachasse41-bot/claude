import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PARAM_GROUP_LABELS, type Generation, type GenerationAsset, type ModelKind, type ModelSummary } from '@nova/shared';
import {
  AlertTriangle, Coins, Layers, Sparkles, Wand2,
} from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useModels, useGenerations, useInvalidateWorkspace } from '../lib/queries';
import { useModelForm } from '../lib/useModelForm';
import { useAuth } from '../context/AuthContext';
import {
  Button, Card, CardHeader, EmptyState, Field, InlineNotice, PageHeader, SegmentedControl,
  Skeleton, useToast,
} from '../components/ui';
import { ParamControl } from '../components/generation/ParamControl';
import { ModelPicker, KIND_META } from '../components/generation/ModelPicker';
import { GenerationCard } from '../components/generation/GenerationCard';
import { AssetLightbox } from '../components/generation/AssetLightbox';
import { formatNumber } from '../lib/format';

/**
 * Studio de generation.
 * L'ecran est entierement pilote par la definition du modele selectionne :
 * un controle n'apparait que si le modele declare le parametre correspondant
 * (audio, duree, resolution...).
 */
export function GeneratePage({ restrictKind }: { restrictKind?: ModelKind }) {
  const { data: models, isLoading, error } = useModels();
  const [searchParams, setSearchParams] = useSearchParams();
  const [kindFilter, setKindFilter] = useState<ModelKind | 'all'>(restrictKind ?? 'all');
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  /**
   * Les erreurs de validation locale ne s'affichent qu'apres une premiere
   * tentative de lancement : un formulaire vierge ne doit pas paraitre en erreur.
   */
  const [showValidation, setShowValidation] = useState(false);
  const [lightbox, setLightbox] = useState<{ generation: Generation; asset: GenerationAsset } | null>(null);
  const toast = useToast();
  const invalidate = useInvalidateWorkspace();
  const { user, refresh } = useAuth();

  const availableModels = useMemo(() => {
    const list = models ?? [];
    if (restrictKind) return list.filter((m) => m.kind === restrictKind);
    return kindFilter === 'all' ? list : list.filter((m) => m.kind === kindFilter);
  }, [models, kindFilter, restrictKind]);

  const requestedKey = searchParams.get('model');
  const selectedModel: ModelSummary | undefined =
    availableModels.find((m) => m.key === requestedKey) ?? availableModels[0];

  const form = useModelForm(selectedModel);

  // Reinitialise les erreurs serveur des que la configuration change.
  useEffect(() => setServerErrors({}), [selectedModel?.key, form.values]);
  useEffect(() => setShowValidation(false), [selectedModel?.key]);

  /** Erreur a afficher pour un parametre : serveur d'abord, puis validation locale. */
  const errorFor = (paramId: string): string | undefined =>
    serverErrors[paramId] ?? (showValidation ? form.missing[paramId] : undefined);

  const recent = useGenerations({
    pageSize: 8,
    ...(restrictKind ? { kind: restrictKind } : {}),
  });

  const insufficient =
    user && !user.credits.allowOverdraft && form.estimatedCost > user.credits.balance;

  async function launch() {
    if (!selectedModel) return;
    setShowValidation(true);
    if (!form.isValid) return;
    setSubmitting(true);
    setServerErrors({});
    try {
      const result = await api.post<{ generations: Generation[]; creditCost: number }>('/generations', {
        modelKey: selectedModel.key,
        params: form.payload,
        outputCount: form.outputCount,
      });
      toast.success(
        `Generation lancee (${result.generations.length})`,
        `${result.creditCost} credits reserves. Le suivi se met a jour automatiquement.`,
      );
      invalidate();
      void refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setServerErrors(err.fields);
        toast.error(err.title, err.message);
      } else {
        toast.error('Lancement impossible', 'Verifiez votre connexion.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function saveToGallery(asset: GenerationAsset) {
    try {
      await api.post('/gallery', { assetId: asset.id });
      toast.success('Enregistre dans votre galerie');
      invalidate(['generations', 'gallery', 'overview']);
    } catch (err) {
      toast.error('Enregistrement impossible', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function cancel(id: string) {
    try {
      await api.post(`/generations/${id}/cancel`);
      toast.info('Generation annulee', 'Les credits non consommes sont rembourses.');
      invalidate();
      void refresh();
    } catch (err) {
      toast.error('Annulation impossible', err instanceof ApiError ? err.message : undefined);
    }
  }

  if (isLoading) {
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[520px]" />
        <Skeleton className="h-[520px]" />
      </div>
    );
  }

  if (error || !models) {
    return <Card><EmptyState icon={<AlertTriangle className="size-5" />} title="Catalogue indisponible" description="Les modeles n'ont pas pu etre charges." /></Card>;
  }

  if (availableModels.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Layers className="size-5" />}
          title="Aucun modele disponible"
          description="Aucun modele de ce type n'est actif. Contactez votre administrateur pour en activer un."
        />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={restrictKind ? `Studio ${KIND_META[restrictKind].label.toLowerCase()}` : 'Generation'}
        description="Decrivez ce que vous voulez obtenir, ajoutez vos references, choisissez un modele."
        actions={
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--surface-raised)] px-3 py-1.5 text-[13px]">
            <Coins className="size-3.5 text-[var(--text-muted)]" aria-hidden />
            <span className="tabular-nums font-medium">{formatNumber(user?.credits.balance ?? 0)}</span>
            <span className="text-muted-fg">credits</span>
          </span>
        }
      />

      {/*
        Sur grand ecran : prompt a gauche, parametres a droite.
        Sur mobile (colonne unique), l'ordre du DOM place les parametres et le
        bouton de lancement juste apres le prompt, avant l'historique recent.
      */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="lg:col-start-1 lg:row-start-1">
          <Card>
            <CardHeader
              title="Votre demande"
              description={selectedModel?.description}
              icon={<Wand2 className="size-4" />}
            />
            <div className="space-y-5 p-5">
              {form.groups.reference.length > 0 ? (
                <section className="space-y-4">
                  {form.groups.reference.map((spec) => (
                    <ParamControl
                      key={spec.id}
                      spec={spec}
                      value={form.values[spec.id] ?? null}
                      onChange={(value) => form.setValue(spec.id, value)}
                      error={errorFor(spec.id)}
                      disabled={submitting}
                    />
                  ))}
                </section>
              ) : null}

              {form.groups.core.map((spec) => (
                <ParamControl
                  key={spec.id}
                  spec={spec}
                  value={form.values[spec.id] ?? null}
                  onChange={(value) => form.setValue(spec.id, value)}
                  error={errorFor(spec.id)}
                  disabled={submitting}
                />
              ))}
            </div>
          </Card>
        </div>

        {/* Colonne laterale : modele et parametres techniques, toujours accessibles. */}
        <div className="space-y-5 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-20">
          <Card>
            <CardHeader title="Modele" icon={<Layers className="size-4" />} />
            <div className="space-y-3 p-4">
              {!restrictKind ? (
                <SegmentedControl
                  size="sm"
                  value={kindFilter}
                  onChange={(value) => setKindFilter(value as ModelKind | 'all')}
                  options={[
                    { value: 'all', label: 'Tous' },
                    ...(Object.keys(KIND_META) as ModelKind[]).map((kind) => ({
                      value: kind,
                      label: KIND_META[kind].label,
                    })),
                  ]}
                />
              ) : null}
              <ModelPicker
                models={availableModels}
                value={selectedModel?.key ?? ''}
                onChange={(key) => setSearchParams({ model: key }, { replace: true })}
              />
            </div>
          </Card>

          {selectedModel ? (
            <Card>
              <CardHeader
                title="Parametres"
                description={`Adaptes a ${selectedModel.name}`}
              />
              <div className="space-y-5 p-4">
                {(['output', 'audio', 'advanced'] as const).map((group) =>
                  form.groups[group].length > 0 ? (
                    <section key={group} className="space-y-4">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-fg">
                        {PARAM_GROUP_LABELS[group]}
                      </h3>
                      {form.groups[group].map((spec) => (
                        <ParamControl
                          key={spec.id}
                          spec={spec}
                          value={form.values[spec.id] ?? null}
                          onChange={(value) => form.setValue(spec.id, value)}
                          error={errorFor(spec.id)}
                          disabled={submitting}
                        />
                      ))}
                    </section>
                  ) : null,
                )}

                {selectedModel.outputs.max > 1 ? (
                  <Field
                    label={
                      <span className="flex w-full items-center justify-between">
                        <span>Nombre de generations</span>
                        <span className="font-mono text-[12px] text-[var(--accent-text)]">
                          {form.outputCount}
                        </span>
                      </span>
                    }
                    hint="Chaque sortie est facturee separement."
                  >
                    <input
                      type="range"
                      min={selectedModel.outputs.min}
                      max={selectedModel.outputs.max}
                      step={1}
                      value={form.outputCount}
                      disabled={submitting}
                      onChange={(event) => form.setOutputCount(Number(event.target.value))}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--surface-hover)] accent-[var(--accent)]"
                    />
                  </Field>
                ) : null}

                {selectedModel.integrationNotes ? (
                  <InlineNotice tone="warning" title="Integration a confirmer">
                    {selectedModel.integrationNotes}
                  </InlineNotice>
                ) : null}
              </div>

              <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-base)] p-4">
                <div className="mb-3 flex items-center justify-between text-[13px]">
                  <span className="text-secondary-fg">Cout estime</span>
                  <span className="font-semibold tabular-nums">{form.estimatedCost} credits</span>
                </div>
                {insufficient ? (
                  <p className="mb-3 flex items-start gap-1.5 text-[12px] text-[var(--warning)]">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Solde insuffisant. Demandez une dotation a votre administrateur.
                  </p>
                ) : null}
                <Button
                  full
                  size="lg"
                  loading={submitting}
                  disabled={Boolean(insufficient)}
                  onClick={launch}
                  icon={<Sparkles className="size-4" />}
                >
                  Lancer la generation
                </Button>
              </div>
            </Card>
          ) : null}
        </div>

        <div className="lg:col-start-1 lg:row-start-2">
          <Card>
            <CardHeader title="Generations recentes" description="Le statut se met a jour automatiquement." />
            <div className="space-y-3 p-4">
              {recent.isLoading ? (
                <>
                  <Skeleton className="h-28" />
                  <Skeleton className="h-28" />
                </>
              ) : recent.data && recent.data.items.length > 0 ? (
                recent.data.items.map((generation) => (
                  <GenerationCard
                    key={generation.id}
                    generation={generation}
                    onCancel={cancel}
                    onSaveToGallery={saveToGallery}
                    onOpenAsset={(g, asset) => setLightbox({ generation: g, asset })}
                  />
                ))
              ) : (
                <EmptyState
                  icon={<Sparkles className="size-5" />}
                  title="Aucune generation pour le moment"
                  description="Lancez votre premiere generation : elle apparaitra ici avec son statut en temps reel."
                />
              )}
            </div>
          </Card>
        </div>
      </div>

      <AssetLightbox
        open={Boolean(lightbox)}
        onClose={() => setLightbox(null)}
        generation={lightbox?.generation ?? null}
        asset={lightbox?.asset ?? null}
        onSaveToGallery={saveToGallery}
      />
    </>
  );
}
