import { Link } from 'react-router-dom';
import { Activity, Coins, Image, Loader2, Sparkles, TrendingUp } from 'lucide-react';
import { useCollaboratorOverview } from '../lib/queries';
import { useAuth } from '../context/AuthContext';
import {
  Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatTile,
} from '../components/ui';
import { ModelUsageChart, TimelineChart } from '../components/Charts';
import { GenerationCard } from '../components/generation/GenerationCard';
import { formatNumber } from '../lib/format';

export function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useCollaboratorOverview(30);

  return (
    <>
      <PageHeader
        title={`Bonjour, ${user?.name.split(' ')[0] ?? ''}`}
        description="Votre activite de generation sur les 30 derniers jours."
        actions={
          <Link to="/generation">
            <Button icon={<Sparkles className="size-4" />}>Nouvelle generation</Button>
          </Link>
        }
      />

      {error ? (
        <Card><ErrorState onRetry={() => void refetch()} /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Credits disponibles"
              value={formatNumber(data?.credits.balance)}
              hint={data ? `${formatNumber(data.totals.creditsSpent30d)} consommes sur 30 j` : undefined}
              icon={<Coins className="size-3.5" />}
              tone="accent"
              loading={isLoading}
            />
            <StatTile
              label="Generations"
              value={formatNumber(data?.totals.generations)}
              hint={data ? `${data.totals.completed} terminees` : undefined}
              icon={<Sparkles className="size-3.5" />}
              loading={isLoading}
            />
            <StatTile
              label="En cours"
              value={formatNumber(data?.totals.running)}
              hint={data && data.totals.failed > 0 ? `${data.totals.failed} en echec` : 'Aucun incident'}
              icon={<Loader2 className="size-3.5" />}
              tone={data?.totals.running ? 'info' : 'neutral'}
              loading={isLoading}
            />
            <StatTile
              label="Galerie"
              value={formatNumber(data?.totals.galleryItems)}
              hint={data ? `${data.totals.workflows} workflow(s)` : undefined}
              icon={<Image className="size-3.5" />}
              loading={isLoading}
            />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card>
              <CardHeader
                title="Activite"
                description="Generations lancees et credits consommes"
                icon={<TrendingUp className="size-4" />}
              />
              <div className="p-4">
                {isLoading ? (
                  <Skeleton className="h-[220px]" />
                ) : data && data.timeline.some((point) => point.generations > 0) ? (
                  <TimelineChart data={data.timeline} />
                ) : (
                  <EmptyState
                    icon={<Activity className="size-5" />}
                    title="Pas encore d'activite"
                    description="Vos generations apparaitront ici au fil de vos usages."
                  />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Modeles utilises" description="Repartition de vos generations" />
              <div className="p-4">
                {isLoading ? (
                  <Skeleton className="h-[220px]" />
                ) : data && data.byModel.length > 0 ? (
                  <ModelUsageChart data={data.byModel} />
                ) : (
                  <EmptyState title="Aucun modele utilise" description="Lancez une generation pour voir la repartition." />
                )}
              </div>
            </Card>
          </div>

          <Card className="mt-5">
            <CardHeader
              title="Dernieres generations"
              action={
                <Link to="/historique">
                  <Button variant="ghost" size="sm">Tout voir</Button>
                </Link>
              }
            />
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {isLoading ? (
                <>
                  <Skeleton className="h-40" />
                  <Skeleton className="h-40" />
                </>
              ) : data && data.recentGenerations.length > 0 ? (
                data.recentGenerations.map((generation) => (
                  <GenerationCard key={generation.id} generation={generation} />
                ))
              ) : (
                <div className="md:col-span-2">
                  <EmptyState
                    icon={<Sparkles className="size-5" />}
                    title="Votre espace est pret"
                    description="Lancez votre premiere generation pour demarrer."
                    action={<Link to="/generation"><Button>Commencer</Button></Link>}
                  />
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </>
  );
}
