import { useState } from 'react';
import { Search, Star } from 'lucide-react';
import type { AdminOverview, GalleryItem, ModelKind } from '@nova/shared';
import { ApiError } from '../lib/api';
import { useGallery, useInvalidateWorkspace, useModels, useQuery } from '../lib/queries';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, PageHeader,
  SegmentedControl, Select, Skeleton, useToast,
} from '../components/ui';
import { AssetPreview } from '../components/generation/GenerationCard';
import { AssetLightbox } from '../components/generation/AssetLightbox';
import { formatRelative } from '../lib/format';
import { KIND_META } from '../components/generation/ModelPicker';

/**
 * Galerie personnelle. Un collaborateur ne voit que ses propres elements ;
 * un administrateur peut basculer sur l'ensemble de l'organisation (le
 * filtrage effectif est applique par l'API).
 */
export function GalleryPage() {
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<ModelKind | 'all'>('all');
  const [modelKey, setModelKey] = useState('');
  const [sort, setSort] = useState('recent');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  /** Filtre par collaborateur, reserve a l'administrateur. */
  const [userFilter, setUserFilter] = useState('');
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GalleryItem | null>(null);

  const { data: models } = useModels();
  const invalidate = useInvalidateWorkspace();
  const toast = useToast();

  const { data, isLoading, error, refetch } = useGallery({
    search: search || undefined,
    kind: kind === 'all' ? undefined : kind,
    modelKey: modelKey || undefined,
    sort,
    userId: isAdmin && scope === 'all' ? (userFilter || 'all') : undefined,
    pageSize: 48,
  });

  // Liste des collaborateurs, chargee uniquement pour l'administrateur en
  // mode « toute l'organisation ».
  const organizationUsers = useQuery({
    queryKey: ['admin-overview', 30],
    enabled: isAdmin && scope === 'all',
    queryFn: () => api.get<AdminOverview>('/admin/overview?days=30'),
  });

  async function remove(item: GalleryItem) {
    try {
      await api.delete(`/gallery/${item.id}`);
      toast.success('Element retire de la galerie', 'La generation reste disponible dans votre historique.');
      invalidate(['gallery', 'generations', 'overview']);
      setSelected(null);
    } catch (err) {
      toast.error('Suppression impossible', err instanceof ApiError ? err.message : undefined);
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Galerie"
        description="Vos resultats enregistres, avec leurs metadonnees."
        actions={
          isAdmin ? (
            <SegmentedControl
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'mine', label: 'Ma galerie' },
                { value: 'all', label: "Toute l'organisation" },
              ]}
            />
          ) : undefined
        }
      />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un titre, un prompt, un tag..."
              className="pl-9"
              aria-label="Rechercher dans la galerie"
            />
          </div>
          <SegmentedControl
            size="sm"
            value={kind}
            onChange={(value) => setKind(value as ModelKind | 'all')}
            options={[
              { value: 'all', label: 'Tous' },
              ...(Object.keys(KIND_META) as ModelKind[]).map((k) => ({ value: k, label: KIND_META[k].label })),
            ]}
          />
          <Select
            value={modelKey}
            onChange={(event) => setModelKey(event.target.value)}
            className="w-auto min-w-[160px]"
            aria-label="Filtrer par modele"
          >
            <option value="">Tous les modeles</option>
            {(models ?? []).map((model) => (
              <option key={model.key} value={model.key}>{model.name}</option>
            ))}
          </Select>
          {isAdmin && scope === 'all' ? (
            <Select
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value)}
              className="w-auto min-w-[180px]"
              aria-label="Filtrer par collaborateur"
            >
              <option value="">Tous les collaborateurs</option>
              {(organizationUsers.data?.byUser ?? []).map((row) => (
                <option key={row.userId} value={row.userId}>{row.name}</option>
              ))}
            </Select>
          ) : null}
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="w-auto min-w-[140px]"
            aria-label="Trier"
          >
            <option value="recent">Plus recents</option>
            <option value="oldest">Plus anciens</option>
            <option value="title">Titre (A-Z)</option>
          </Select>
        </div>
      </Card>

      {error ? (
        <Card><ErrorState onRetry={() => void refetch()} /></Card>
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="aspect-square" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {data.items.map((item) => (
              <Card key={item.id} className="group overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSelected(item)}
                  className="block w-full"
                  aria-label={`Ouvrir ${item.title}`}
                >
                  <AssetPreview asset={item.asset} kind={item.generation.kind} className="aspect-square w-full" />
                </button>
                <div className="p-3">
                  <p className="truncate text-[13px] font-medium" title={item.title}>{item.title}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <Badge tone="neutral">{item.generation.modelName}</Badge>
                    <span className="text-[11px] text-muted-fg">{formatRelative(item.createdAt)}</span>
                  </div>
                  {item.userName && scope === 'all' ? (
                    <p className="mt-1.5 text-[11px] text-muted-fg">{item.userName}</p>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
          <p className="mt-4 text-center text-[12px] text-muted-fg">
            {data.total} element{data.total > 1 ? 's' : ''}
            {data.hasMore ? ' — affinez les filtres pour reduire la liste' : ''}
          </p>
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<Star className="size-5" />}
            title={search || modelKey || kind !== 'all' ? 'Aucun resultat' : 'Votre galerie est vide'}
            description={
              search || modelKey || kind !== 'all'
                ? 'Essayez d elargir vos filtres.'
                : 'Enregistrez un resultat depuis le studio de generation pour le retrouver ici.'
            }
            action={
              search || modelKey || kind !== 'all' ? (
                <Button variant="secondary" size="sm" onClick={() => { setSearch(''); setModelKey(''); setKind('all'); }}>
                  Reinitialiser les filtres
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      <AssetLightbox
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        generation={selected ? { ...selected.generation, userName: selected.userName } : null}
        asset={selected?.asset ?? null}
        onDelete={selected ? () => setPendingDelete(selected) : undefined}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && void remove(pendingDelete)}
        title="Retirer de la galerie"
        description={pendingDelete?.title}
        confirmLabel="Retirer"
        consequences={[
          "L'element disparait de votre galerie.",
          'La generation et son resultat restent consultables dans votre historique.',
        ]}
      />
    </>
  );
}
