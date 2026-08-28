import { useState } from 'react';
import { Coins, Download } from 'lucide-react';
import { api, query } from '../../lib/api';
import { useAdminOverview, useQuery } from '../../lib/queries';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, SegmentedControl,
  Select, Skeleton, StatTile,
} from '../../components/ui';
import { ModelUsageChart } from '../../components/Charts';
import { formatDateTime, formatNumber } from '../../lib/format';

const PERIODS = [
  { value: '7', label: '7 j' },
  { value: '30', label: '30 j' },
  { value: '90', label: '90 j' },
  { value: '365', label: '1 an' },
];

/** Suivi de la consommation : global, par collaborateur, par modele, par periode. */
export function AdminCreditsPage() {
  const [days, setDays] = useState('30');
  const [userId, setUserId] = useState('');
  const [type, setType] = useState('');

  const overview = useAdminOverview(Number(days));
  const from = new Date(Date.now() - Number(days) * 86_400_000).toISOString();

  const transactions = useQuery({
    queryKey: ['admin-credits', days, userId, type],
    queryFn: () =>
      api.get<{ items: any[]; total: number }>(
        `/admin/credits${query({ from, userId, type, pageSize: 100 })}`,
      ),
  });

  const periodSpend = (overview.data?.timeline ?? []).reduce((sum, point) => sum + point.credits, 0);
  const periodGenerations = (overview.data?.timeline ?? []).reduce((sum, point) => sum + point.generations, 0);

  function exportCsv() {
    const rows = transactions.data?.items ?? [];
    const header = ['Date', 'Collaborateur', 'Type', 'Montant', 'Solde apres', 'Modele', 'Motif'];
    const lines = rows.map((tx) =>
      [
        tx.createdAt, tx.userName ?? '', tx.type, tx.amount, tx.balanceAfter,
        tx.modelKey ?? '', (tx.reason ?? '').replace(/[";\n]/g, ' '),
      ].join(';'),
    );
    const blob = new Blob([[header.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `credits-${days}j.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Credits"
        description="Consommation de l'organisation, par collaborateur et par modele."
        actions={
          <>
            <SegmentedControl value={days} onChange={setDays} options={PERIODS} />
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportCsv}>
              Exporter
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={`Consomme sur ${days} j`}
          value={formatNumber(periodSpend)}
          hint={`${formatNumber(periodGenerations)} generation(s)`}
          icon={<Coins className="size-3.5" />}
          tone="warning"
          loading={overview.isLoading}
        />
        <StatTile
          label="Consomme au total"
          value={formatNumber(overview.data?.totals.creditsSpent)}
          icon={<Coins className="size-3.5" />}
          loading={overview.isLoading}
        />
        <StatTile
          label="Attribue au total"
          value={formatNumber(overview.data?.totals.creditsGranted)}
          icon={<Coins className="size-3.5" />}
          tone="accent"
          loading={overview.isLoading}
        />
        <StatTile
          label="Disponible"
          value={formatNumber(overview.data?.totals.creditsAvailable)}
          hint="Somme des soldes de tous les comptes"
          icon={<Coins className="size-3.5" />}
          tone="success"
          loading={overview.isLoading}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Par modele" description="Credits consommes depuis la creation" />
          <div className="p-4">
            {overview.isLoading ? (
              <Skeleton className="h-[240px]" />
            ) : overview.data && overview.data.byModel.length > 0 ? (
              <ModelUsageChart data={overview.data.byModel} dataKey="credits" height={240} />
            ) : (
              <EmptyState title="Aucune consommation" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Par collaborateur" description="Classement par credits consommes" />
          {overview.isLoading ? (
            <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          ) : overview.data && overview.data.byUser.length > 0 ? (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {overview.data.byUser.map((row) => {
                const max = Math.max(1, ...overview.data!.byUser.map((u) => u.credits));
                return (
                  <li key={row.userId} className="px-4 py-3">
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
                      <span className="truncate font-medium">{row.name}</span>
                      <span className="shrink-0 tabular-nums text-secondary-fg">
                        {formatNumber(row.credits)} cr. · solde {formatNumber(row.balance)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${(row.credits / max) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Aucun collaborateur" />
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Historique detaille"
          description={transactions.data ? `${transactions.data.total} operation(s) sur la periode` : undefined}
          action={
            <div className="flex gap-2">
              <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-auto min-w-[170px]" aria-label="Filtrer par collaborateur">
                <option value="">Tous les collaborateurs</option>
                {(overview.data?.byUser ?? []).map((row) => (
                  <option key={row.userId} value={row.userId}>{row.name}</option>
                ))}
              </Select>
              <Select value={type} onChange={(e) => setType(e.target.value)} className="w-auto min-w-[140px]" aria-label="Filtrer par type">
                <option value="">Tous les types</option>
                <option value="debit">Debits</option>
                <option value="refund">Remboursements</option>
                <option value="grant">Dotations</option>
                <option value="adjustment">Ajustements</option>
              </Select>
            </div>
          }
        />
        {transactions.error ? (
          <ErrorState onRetry={() => void transactions.refetch()} />
        ) : transactions.isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : transactions.data && transactions.data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-muted-fg">
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Collaborateur</th>
                  <th className="px-4 py-2.5 font-semibold">Operation</th>
                  <th className="px-4 py-2.5 font-semibold">Modele</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Montant</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Solde</th>
                </tr>
              </thead>
              <tbody>
                {transactions.data.items.map((tx) => (
                  <tr key={tx.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-hover)]">
                    <td className="whitespace-nowrap px-4 py-2.5 text-secondary-fg">{formatDateTime(tx.createdAt)}</td>
                    <td className="px-4 py-2.5">{tx.userName ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className="block truncate">{tx.reason}</span>
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
          <EmptyState icon={<Coins className="size-5" />} title="Aucune operation" description="Aucun mouvement de credits sur cette periode." />
        )}
      </Card>
    </>
  );
}
