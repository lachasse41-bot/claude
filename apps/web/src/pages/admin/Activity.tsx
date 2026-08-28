import { useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import type { ActivityLog } from '@nova/shared';
import { api, query } from '../../lib/api';
import { useAdminOverview, useQuery } from '../../lib/queries';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton,
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { actionLabel } from './Overview';

/** Journal des actions sensibles : tracabilite complete de l'organisation. */
export function AdminActivityPage() {
  const [search, setSearch] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [page, setPage] = useState(1);

  const overview = useAdminOverview(30);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-activity', search, actorUserId, page],
    queryFn: () =>
      api.get<{ items: ActivityLog[]; total: number; hasMore: boolean; page: number }>(
        `/admin/activity${query({ search, actorUserId, page, pageSize: 50 })}`,
      ),
  });

  return (
    <>
      <PageHeader title="Journal d'activite" description="Historique horodate des actions importantes." />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Rechercher une action, un nom, un e-mail..."
              className="pl-9"
              aria-label="Rechercher dans le journal"
            />
          </div>
          <Select
            value={actorUserId}
            onChange={(e) => { setActorUserId(e.target.value); setPage(1); }}
            className="w-auto min-w-[190px]"
            aria-label="Filtrer par auteur"
          >
            <option value="">Tous les auteurs</option>
            {(overview.data?.byUser ?? []).map((row) => (
              <option key={row.userId} value={row.userId}>{row.name}</option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Actions"
          description={data ? `${data.total} entree(s)` : undefined}
          icon={<ScrollText className="size-4" />}
        />
        {error ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : data && data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-muted-fg">
                    <th className="px-4 py-2.5 font-semibold">Date</th>
                    <th className="px-4 py-2.5 font-semibold">Action</th>
                    <th className="px-4 py-2.5 font-semibold">Auteur</th>
                    <th className="px-4 py-2.5 font-semibold">Cible</th>
                    <th className="px-4 py-2.5 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((entry) => (
                    <tr key={entry.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-hover)]">
                      <td className="whitespace-nowrap px-4 py-2.5 text-secondary-fg">{formatDateTime(entry.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={entry.action.startsWith('admin.') ? 'warning' : 'neutral'}>
                          {actionLabel(entry.action)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block truncate">{entry.actorName ?? 'Systeme'}</span>
                        <span className="block truncate text-[11px] text-muted-fg">{entry.actorEmail ?? entry.ip ?? ''}</span>
                      </td>
                      <td className="px-4 py-2.5 text-secondary-fg">{entry.targetName ?? '—'}</td>
                      <td className="max-w-[280px] px-4 py-2.5">
                        <span className="block truncate font-mono text-[11px] text-muted-fg" title={JSON.stringify(entry.metadata)}>
                          {Object.keys(entry.metadata).length > 0 ? JSON.stringify(entry.metadata) : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3">
              <span className="text-[12px] text-muted-fg">Page {data.page}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Precedent
                </Button>
                <Button variant="secondary" size="sm" disabled={!data.hasMore} onClick={() => setPage((p) => p + 1)}>
                  Suivant
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState icon={<ScrollText className="size-5" />} title="Aucune action" description="Le journal est vide pour ces criteres." />
        )}
      </Card>
    </>
  );
}
