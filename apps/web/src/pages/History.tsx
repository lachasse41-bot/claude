import { useState } from 'react';
import { Activity, Coins, Search } from 'lucide-react';
import type { Generation, GenerationAsset, ModelKind } from '@nova/shared';
import { ApiError, api } from '../lib/api';
import { useGenerations, useInvalidateWorkspace, useModels, useQuery } from '../lib/queries';
import { useAuth } from '../context/AuthContext';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Input,
  PageHeader, SegmentedControl, Select, Skeleton, useToast,
} from '../components/ui';
import { GenerationCard } from '../components/generation/GenerationCard';
import { AssetLightbox } from '../components/generation/AssetLightbox';
import { formatDateTime, formatNumber } from '../lib/format';
import { KIND_META } from '../components/generation/ModelPicker';

/** Historique complet + suivi de la consommation de credits personnelle. */
export function HistoryPage() {
  const { isAdmin, refresh } = useAuth();
  const [tab, setTab] = useState<'generations' | 'credits'>('generations');
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [kind, setKind] = useState<ModelKind | 'all'>('all');
  const [modelKey, setModelKey] = useState('');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [page, setPage] = useState(1);
  const [lightbox, setLightbox] = useState<{ generation: Generation; asset: GenerationAsset } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const { data: models } = useModels();
  const invalidate = useInvalidateWorkspace();
  const toast = useToast();

  const generations = useGenerations({
    search: search || undefined,
    state: state || undefined,
    kind: kind === 'all' ? undefined : kind,
    modelKey: modelKey || undefined,
    userId: isAdmin && scope === 'all' ? 'all' : undefined,
    page,
    pageSize: 12,
  });

  const credits = useQuery({
    queryKey: ['credits', page],
    enabled: tab === 'credits',
    queryFn: () => api.get<{ summary: any; transactions: any }>(`/me/credits?pageSize=50`),
  });

  async function cancel(id: string) {
    try {
      await api.post(`/generations/${id}/cancel`);
      toast.info('Generation annulee');
      invalidate();
      void refresh();
    } catch (err) {
      toast.error('Annulation impossible', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/generations/${id}`);
      toast.success('Generation supprimee');
      invalidate();
    } catch (err) {
      toast.error('Suppression impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setPendingDelete(null);
    }
  }

  async function saveToGallery(asset: GenerationAsset) {
    try {
      await api.post('/gallery', { assetId: asset.id });
      toast.success('Enregistre dans votre galerie');
      invalidate(['generations', 'gallery']);
    } catch (err) {
      toast.error('Enregistrement impossible', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <>
      <PageHeader
        title="Historique"
        description="Toutes vos generations et votre consommation de credits."
        actions={
          <SegmentedControl
            value={tab}
            onChange={setTab}
            options={[
              { value: 'generations', label: 'Generations' },
              { value: 'credits', label: 'Credits' },
            ]}
          />
        }
      />

      {tab === 'generations' ? (
        <>
          <Card className="mb-5 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
                <Input
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                  placeholder="Rechercher un prompt..."
                  className="pl-9"
                  aria-label="Rechercher"
                />
              </div>
              <Select value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} className="w-auto min-w-[150px]" aria-label="Filtrer par statut">
                <option value="">Tous les statuts</option>
                <option value="queued">En file</option>
                <option value="processing">En cours</option>
                <option value="completed">Termine</option>
                <option value="failed">Echec</option>
                <option value="cancelled">Annulee</option>
              </Select>
              <Select value={modelKey} onChange={(e) => { setModelKey(e.target.value); setPage(1); }} className="w-auto min-w-[150px]" aria-label="Filtrer par modele">
                <option value="">Tous les modeles</option>
                {(models ?? []).map((model) => (
                  <option key={model.key} value={model.key}>{model.name}</option>
                ))}
              </Select>
              <SegmentedControl
                size="sm"
                value={kind}
                onChange={(value) => { setKind(value as ModelKind | 'all'); setPage(1); }}
                options={[
                  { value: 'all', label: 'Tous' },
                  ...(Object.keys(KIND_META) as ModelKind[]).map((k) => ({ value: k, label: KIND_META[k].label })),
                ]}
              />
              {isAdmin ? (
                <SegmentedControl
                  size="sm"
                  value={scope}
                  onChange={(value) => { setScope(value); setPage(1); }}
                  options={[
                    { value: 'mine', label: 'Moi' },
                    { value: 'all', label: 'Organisation' },
                  ]}
                />
              ) : null}
            </div>
          </Card>

          {generations.error ? (
            <Card><ErrorState onRetry={() => void generations.refetch()} /></Card>
          ) : generations.isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-48" /><Skeleton className="h-48" />
            </div>
          ) : generations.data && generations.data.items.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {generations.data.items.map((generation) => (
                  <GenerationCard
                    key={generation.id}
                    generation={generation}
                    onCancel={cancel}
                    onDelete={(id) => setPendingDelete(id)}
                    onSaveToGallery={saveToGallery}
                    onOpenAsset={(g, asset) => setLightbox({ generation: g, asset })}
                  />
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between">
                <p className="text-[12px] text-muted-fg">
                  Page {generations.data.page} — {formatNumber(generations.data.total)} generation(s)
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Precedent
                  </Button>
                  <Button variant="secondary" size="sm" disabled={!generations.data.hasMore} onClick={() => setPage((p) => p + 1)}>
                    Suivant
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <Card>
              <EmptyState
                icon={<Activity className="size-5" />}
                title="Aucune generation"
                description={search || state ? 'Aucun resultat pour ces filtres.' : "Vous n'avez pas encore lance de generation."}
              />
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardHeader
            title="Consommation de credits"
            description="Chaque operation est tracee : reservation, remboursement et dotation."
            icon={<Coins className="size-4" />}
          />
          {credits.isLoading ? (
            <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          ) : credits.data?.transactions.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-muted-fg">
                    <th className="px-4 py-2.5 font-semibold">Date</th>
                    <th className="px-4 py-2.5 font-semibold">Operation</th>
                    <th className="px-4 py-2.5 font-semibold">Modele</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Montant</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {credits.data.transactions.items.map((tx: any) => (
                    <tr key={tx.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-hover)]">
                      <td className="whitespace-nowrap px-4 py-2.5 text-secondary-fg">{formatDateTime(tx.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <span className="block">{tx.reason}</span>
                        <Badge
                          tone={tx.type === 'debit' ? 'warning' : tx.type === 'refund' ? 'success' : 'accent'}
                          className="mt-1"
                        >
                          {{ debit: 'Debit', refund: 'Remboursement', grant: 'Dotation', adjustment: 'Ajustement' }[tx.type as string]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-secondary-fg">{tx.modelKey ?? '—'}</td>
                      <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${tx.amount < 0 ? 'text-[var(--warning)]' : 'text-[var(--success)]'}`}>
                        {tx.amount > 0 ? '+' : ''}{formatNumber(tx.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-secondary-fg">{formatNumber(tx.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<Coins className="size-5" />} title="Aucun mouvement" description="Vos operations de credits apparaitront ici." />
          )}
        </Card>
      )}

      <AssetLightbox
        open={Boolean(lightbox)}
        onClose={() => setLightbox(null)}
        generation={lightbox?.generation ?? null}
        asset={lightbox?.asset ?? null}
        onSaveToGallery={saveToGallery}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && void remove(pendingDelete)}
        title="Supprimer la generation"
        confirmLabel="Supprimer"
        consequences={[
          'La generation et ses resultats sont definitivement effaces.',
          'Les credits deja consommes ne sont pas restitues.',
        ]}
      />
    </>
  );
}
