import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, Coins, Sparkles, TrendingUp, UserPlus, Users,
} from 'lucide-react';
import { useAdminOverview } from '../../lib/queries';
import {
  Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatTile,
} from '../../components/ui';
import { ModelUsageChart, TimelineChart } from '../../components/Charts';
import { formatNumber, formatRelative } from '../../lib/format';

/** Libelles lisibles des actions journalisees. */
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Connexion',
  'auth.logout': 'Deconnexion',
  'auth.register': 'Creation de compte',
  'auth.password_changed': 'Mot de passe modifie',
  'auth.password_reset': 'Mot de passe reinitialise',
  'auth.password_reset_requested': 'Reinitialisation demandee',
  'generation.created': 'Generation lancee',
  'generation.cancelled': 'Generation annulee',
  'generation.deleted': 'Generation supprimee',
  'gallery.item_added': 'Ajout a la galerie',
  'gallery.item_removed': 'Retrait de la galerie',
  'workflow.created': 'Workflow cree',
  'workflow.deleted': 'Workflow supprime',
  'workflow.run_started': 'Workflow execute',
  'admin.user_created': 'Compte cree',
  'admin.user_deleted': 'Compte supprime',
  'admin.user_disabled': 'Compte desactive',
  'admin.user_enabled': 'Compte reactive',
  'admin.user_role_changed': 'Role modifie',
  'admin.credits_granted': 'Credits attribues',
  'admin.overdraft_changed': 'Decouvert modifie',
  'admin.invitation_created': 'Invitation envoyee',
  'admin.invitation_revoked': 'Invitation revoquee',
  'admin.model_saved': 'Modele enregistre',
  'admin.model_enabled': 'Modele active',
  'admin.model_disabled': 'Modele desactive',
  'admin.model_deleted': 'Modele supprime',
  'admin.catalog_restored': 'Catalogue restaure',
  'admin.settings_updated': 'Parametres modifies',
  'admin.api_configuration_updated': 'Configuration API modifiee',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function AdminOverviewPage() {
  const { data, isLoading, error, refetch } = useAdminOverview(30);

  return (
    <>
      <PageHeader
        title="Supervision"
        description="Activite de l'ensemble des collaborateurs sur 30 jours."
        actions={
          <Link to="/admin/collaborateurs">
            <Button icon={<UserPlus className="size-4" />}>Inviter un collaborateur</Button>
          </Link>
        }
      />

      {error ? (
        <Card><ErrorState onRetry={() => void refetch()} /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Collaborateurs"
              value={formatNumber(data?.totals.collaborators)}
              hint={data ? `${data.totals.activeCollaborators} actifs · ${data.totals.disabledCollaborators} desactives` : undefined}
              icon={<Users className="size-3.5" />}
              loading={isLoading}
            />
            <StatTile
              label="Generations"
              value={formatNumber(data?.totals.generations)}
              hint={data ? `${data.totals.generationsCompleted} reussies · ${data.totals.generationsFailed} en echec` : undefined}
              icon={<Sparkles className="size-3.5" />}
              tone="accent"
              loading={isLoading}
            />
            <StatTile
              label="Credits consommes"
              value={formatNumber(data?.totals.creditsSpent)}
              hint={data ? `${formatNumber(data.totals.creditsGranted)} attribues au total` : undefined}
              icon={<Coins className="size-3.5" />}
              tone="warning"
              loading={isLoading}
            />
            <StatTile
              label="Credits disponibles"
              value={formatNumber(data?.totals.creditsAvailable)}
              hint={data ? `${data.totals.pendingInvitations} invitation(s) en attente` : undefined}
              icon={<CheckCircle2 className="size-3.5" />}
              tone="success"
              loading={isLoading}
            />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card>
              <CardHeader
                title="Activite de l'organisation"
                description="Generations lancees et credits consommes"
                icon={<TrendingUp className="size-4" />}
              />
              <div className="p-4">
                {isLoading ? (
                  <Skeleton className="h-[240px]" />
                ) : data && data.timeline.some((p) => p.generations > 0) ? (
                  <TimelineChart data={data.timeline} height={240} />
                ) : (
                  <EmptyState icon={<Activity className="size-5" />} title="Pas encore d'activite" />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Consommation par modele" description="Credits par modele IA" />
              <div className="p-4">
                {isLoading ? (
                  <Skeleton className="h-[240px]" />
                ) : data && data.byModel.length > 0 ? (
                  <ModelUsageChart data={data.byModel} dataKey="credits" height={240} />
                ) : (
                  <EmptyState title="Aucun modele utilise" />
                )}
              </div>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Consommation par collaborateur"
                action={<Link to="/admin/credits"><Button variant="ghost" size="sm">Detail</Button></Link>}
              />
              {isLoading ? (
                <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
              ) : data && data.byUser.length > 0 ? (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {data.byUser.slice(0, 8).map((row) => (
                    <li key={row.userId} className="flex items-center gap-3 px-4 py-2.5">
                      <Avatar name={row.name} color="#6366f1" size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">
                          {row.name}
                          {row.role === 'admin' ? <Badge tone="accent" className="ml-2">Admin</Badge> : null}
                          {row.status === 'disabled' ? <Badge tone="danger" className="ml-2">Desactive</Badge> : null}
                        </p>
                        <p className="truncate text-[11px] text-muted-fg">
                          {row.generations} generation(s) — actif {formatRelative(row.lastActiveAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[13px] font-medium tabular-nums">{formatNumber(row.credits)}</p>
                        <p className="text-[11px] text-muted-fg">solde {formatNumber(row.balance)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<Users className="size-5" />} title="Aucun collaborateur" />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Actions recentes"
                action={<Link to="/admin/journal"><Button variant="ghost" size="sm">Journal complet</Button></Link>}
              />
              {isLoading ? (
                <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
              ) : data && data.recentActivity.length > 0 ? (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {data.recentActivity.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-hover)]">
                        {entry.action.startsWith('admin.') ? (
                          <AlertTriangle className="size-3.5 text-[var(--warning)]" aria-hidden />
                        ) : (
                          <Activity className="size-3.5 text-[var(--text-muted)]" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px]">{actionLabel(entry.action)}</p>
                        <p className="truncate text-[11px] text-muted-fg">
                          {entry.actorName ?? 'Systeme'}
                          {entry.targetName ? ` → ${entry.targetName}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-fg">{formatRelative(entry.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Aucune action enregistree" />
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
