import { Link } from 'react-router-dom';
import { BookOpen, Sparkles } from 'lucide-react';
import { PARAM_GROUP_LABELS, paramsByGroup, type ParamSpec } from '@nova/shared';
import { useModels } from '../lib/queries';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Button } from '../components/ui';
import { KIND_META } from '../components/generation/ModelPicker';

function describeParam(spec: ParamSpec): string {
  switch (spec.type) {
    case 'select': return spec.options.map((o) => o.label).join(' · ');
    case 'number': return `${spec.min} a ${spec.max}${spec.unit ?? ''} (defaut ${spec.default}${spec.unit ?? ''})`;
    case 'boolean': return spec.default ? 'Active par defaut' : 'Desactive par defaut';
    case 'files': return `${spec.minItems} a ${spec.maxItems} fichier(s)`;
    default: return `Texte, ${spec.maxLength} caracteres max`;
  }
}

/**
 * Catalogue consultable par les collaborateurs : capacites et cout de chaque
 * modele actif. Les informations proviennent des definitions servies par
 * l'API, jamais d'une liste codee en dur dans l'interface.
 */
export function ModelsPage() {
  const { data: models, isLoading, error, refetch } = useModels();

  return (
    <>
      <PageHeader
        title="Modeles"
        description="Les modeles IA disponibles, leurs parametres et leur cout indicatif."
      />

      {error ? (
        <Card><ErrorState onRetry={() => void refetch()} /></Card>
      ) : isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" /><Skeleton className="h-64" />
        </div>
      ) : models && models.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {models.map((model) => {
            const Icon = KIND_META[model.kind].icon;
            const groups = paramsByGroup(model.params);
            return (
              <Card key={model.key}>
                <CardHeader
                  icon={<Icon className="size-4" />}
                  title={
                    <span className="flex items-center gap-2">
                      {model.name}
                      <Badge tone="accent">{model.baseCost} cr.</Badge>
                    </span>
                  }
                  description={model.description}
                  action={
                    <Link to={`/generation?model=${model.key}`}>
                      <Button size="sm" variant="secondary" icon={<Sparkles className="size-3.5" />}>
                        Utiliser
                      </Button>
                    </Link>
                  }
                />
                <div className="space-y-4 p-4">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{KIND_META[model.kind].label}</Badge>
                    <Badge>{model.family}</Badge>
                    <Badge>
                      {model.outputs.min === model.outputs.max
                        ? `${model.outputs.max} sortie`
                        : `${model.outputs.min} a ${model.outputs.max} sorties`}
                    </Badge>
                    <Badge>Delai max {Math.round(model.timeoutSeconds / 60)} min</Badge>
                  </div>

                  {(Object.keys(groups) as Array<keyof typeof groups>).map((group) =>
                    groups[group].length > 0 ? (
                      <div key={group}>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg">
                          {PARAM_GROUP_LABELS[group]}
                        </p>
                        <dl className="space-y-1">
                          {groups[group].map((spec) => (
                            <div key={spec.id} className="flex items-start justify-between gap-3 text-[12.5px]">
                              <dt className="text-secondary-fg">{spec.label}</dt>
                              <dd className="max-w-[60%] truncate text-right text-muted-fg" title={describeParam(spec)}>
                                {describeParam(spec)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ) : null,
                  )}

                  {model.docsUrl ? (
                    <a
                      href={model.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[12px] text-[var(--accent-text)] hover:underline"
                    >
                      <BookOpen className="size-3.5" aria-hidden />
                      Documentation du modele
                    </a>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="Aucun modele actif"
            description="Votre administrateur n'a active aucun modele pour le moment."
          />
        </Card>
      )}
    </>
  );
}
