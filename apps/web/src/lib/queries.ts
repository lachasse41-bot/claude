import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  AdminOverview, CollaboratorOverview, Generation, GalleryItem, ModelSummary,
  Paginated, Workflow, WorkflowRun, WorkflowRunSummary,
} from '@nova/shared';
import { api, query } from './api';

/** Catalogue des modeles actifs : socle de toute l'interface de generation. */
export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: () => api.get<{ models: ModelSummary[] }>('/models').then((r) => r.models),
    staleTime: 60_000,
  });
}

export interface GenerationFilters {
  state?: string; modelKey?: string; kind?: string; search?: string;
  userId?: string; sort?: string; page?: number; pageSize?: number;
}

/**
 * Historique des generations.
 * Le sondage n'est actif que si au moins une generation est en cours : une
 * liste stabilisee ne genere aucune requete superflue.
 */
export function useGenerations(filters: GenerationFilters = {}, options?: { refetchWhileRunning?: boolean }) {
  return useQuery({
    queryKey: ['generations', filters],
    queryFn: () => api.get<Paginated<Generation>>(`/generations${query(filters as never)}`),
    refetchInterval: (data) => {
      if (options?.refetchWhileRunning === false) return false;
      const items = (data.state.data as Paginated<Generation> | undefined)?.items ?? [];
      return items.some((g) => g.state === 'queued' || g.state === 'processing') ? 3000 : false;
    },
  });
}

export function useGallery(filters: Record<string, string | number | undefined> = {}) {
  return useQuery({
    queryKey: ['gallery', filters],
    queryFn: () => api.get<Paginated<GalleryItem>>(`/gallery${query(filters)}`),
  });
}

export function useCollaboratorOverview(days = 30) {
  return useQuery({
    queryKey: ['overview', days],
    queryFn: () => api.get<CollaboratorOverview>(`/me/overview?days=${days}`),
  });
}

export function useAdminOverview(days = 30) {
  return useQuery({
    queryKey: ['admin-overview', days],
    queryFn: () => api.get<AdminOverview>(`/admin/overview?days=${days}`),
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => api.get<{ workflows: Workflow[] }>('/workflows').then((r) => r.workflows),
  });
}

export function useWorkflowRuns() {
  return useQuery({
    queryKey: ['workflow-runs'],
    queryFn: () => api.get<{ runs: WorkflowRunSummary[] }>('/workflows/runs').then((r) => r.runs),
    refetchInterval: (data) => {
      const runs = (data.state.data as WorkflowRunSummary[] | undefined) ?? [];
      return runs.some((r) => r.state === 'queued' || r.state === 'running') ? 3000 : false;
    },
  });
}

export function useWorkflowRun(runId: string | null) {
  return useQuery({
    queryKey: ['workflow-run', runId],
    enabled: Boolean(runId),
    queryFn: () => api.get<{ run: WorkflowRun }>(`/workflows/runs/${runId}`).then((r) => r.run),
    refetchInterval: (data) => {
      const run = data.state.data as WorkflowRun | undefined;
      return run && ['queued', 'running'].includes(run.state) ? 2500 : false;
    },
  });
}

/**
 * Invalidation groupee apres une action qui touche plusieurs domaines
 * (une generation modifie l'historique, le solde et les statistiques).
 */
export function useInvalidateWorkspace() {
  const client = useQueryClient();
  return (keys: string[] = ['generations', 'gallery', 'overview', 'credits', 'admin-overview']) => {
    for (const key of keys) void client.invalidateQueries({ queryKey: [key] });
  };
}

export { useMutation, useQuery, useQueryClient, type UseQueryOptions };
