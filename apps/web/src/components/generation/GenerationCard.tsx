import { useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle, Ban, CheckCircle2, Clock, Download, Loader2, Star, Trash2, XCircle,
} from 'lucide-react';
import type { Generation, GenerationAsset, GenerationState } from '@nova/shared';
import { Badge, Button, Card, ProgressBar, Tooltip, type BadgeTone } from '../ui';
import { formatDuration, formatRelative } from '../../lib/format';

/** Vocabulaire des etats, partage par toutes les vues. */
export const STATE_META: Record<GenerationState, { label: string; tone: BadgeTone; hint: string }> = {
  idle: { label: 'Pret', tone: 'neutral', hint: 'En attente de lancement.' },
  uploading: { label: 'Envoi des fichiers', tone: 'info', hint: 'Vos references sont en cours de televersement.' },
  queued: { label: 'En file', tone: 'info', hint: "La demande est acceptee et attend d'etre prise en charge." },
  processing: { label: 'Generation', tone: 'accent', hint: 'Le modele produit votre contenu.' },
  completed: { label: 'Termine', tone: 'success', hint: 'Le resultat est disponible.' },
  failed: { label: 'Echec', tone: 'danger', hint: "La generation n'a pas abouti." },
  cancelled: { label: 'Annulee', tone: 'neutral', hint: 'La generation a ete interrompue.' },
};

const STATE_ICON: Record<GenerationState, typeof Clock> = {
  idle: Clock,
  uploading: Loader2,
  queued: Clock,
  processing: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: Ban,
};

export function StateBadge({ state, animated }: { state: GenerationState; animated?: boolean }) {
  const meta = STATE_META[state];
  const Icon = STATE_ICON[state];
  const spinning = animated && (state === 'processing' || state === 'uploading');
  return (
    <Tooltip label={meta.hint}>
      <Badge tone={meta.tone} icon={<Icon className={clsx('size-3', spinning && 'animate-spin')} aria-hidden />}>
        {meta.label}
      </Badge>
    </Tooltip>
  );
}

export function AssetPreview({
  asset, kind, className, onClick,
}: { asset: GenerationAsset; kind: string; className?: string; onClick?: () => void }) {
  const mime = asset.mimeType ?? '';
  const isVideo = kind === 'video' || mime.startsWith('video/');
  const isAudio = kind === 'audio' || mime.startsWith('audio/');

  /**
   * Si la copie locale est indisponible (stockage purge, recopie echouee),
   * on bascule une seule fois sur l'URL d'origine du fournisseur.
   */
  const fallbackToRemote = (event: { currentTarget: HTMLImageElement | HTMLVideoElement }) => {
    const element = event.currentTarget;
    if (!asset.remoteUrl || element.dataset.fallback === 'done') return;
    element.dataset.fallback = 'done';
    element.src = asset.remoteUrl;
  };

  if (isAudio) {
    return (
      <div className={clsx('flex items-center justify-center bg-[var(--surface-base)] p-4', className)}>
        <audio controls src={asset.url} className="w-full" onError={(event) => {
          const element = event.currentTarget;
          if (asset.remoteUrl && element.dataset.fallback !== 'done') {
            element.dataset.fallback = 'done';
            element.src = asset.remoteUrl;
          }
        }}>
          Votre navigateur ne prend pas en charge la lecture audio.
        </audio>
      </div>
    );
  }
  if (isVideo) {
    return (
      <video
        src={asset.url}
        controls
        preload="metadata"
        className={clsx('bg-black object-contain', className)}
        onClick={onClick}
        onError={fallbackToRemote}
      />
    );
  }
  return (
    <img
      src={asset.url}
      alt="Resultat de generation"
      loading="lazy"
      onError={fallbackToRemote}
      onClick={onClick}
      className={clsx('bg-[var(--surface-base)] object-cover', onClick && 'cursor-zoom-in', className)}
    />
  );
}

export function GenerationCard({
  generation, onCancel, onDelete, onSaveToGallery, onOpenAsset, busy,
}: {
  generation: Generation;
  onCancel?: (id: string) => void;
  onDelete?: (id: string) => void;
  onSaveToGallery?: (asset: GenerationAsset) => void;
  onOpenAsset?: (generation: Generation, asset: GenerationAsset) => void;
  busy?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const outputs = generation.assets.filter((asset) => asset.kind === 'output');
  const running = generation.state === 'queued' || generation.state === 'processing';

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge state={generation.state} animated />
            <span className="text-[12px] font-medium text-secondary-fg">{generation.modelName}</span>
            {generation.userName ? (
              <span className="text-[12px] text-muted-fg">· {generation.userName}</span>
            ) : null}
          </div>
          <p className="mt-1.5 line-clamp-2 text-[13px]" title={generation.prompt}>
            {generation.prompt || <span className="text-muted-fg">Sans prompt</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[12px] tabular-nums text-secondary-fg">
            {generation.creditCost} cr.
            {generation.creditsRefunded > 0 ? (
              <span className="ml-1 text-[var(--success)]">rembourse</span>
            ) : null}
          </p>
          <p className="text-[11px] text-muted-fg">{formatRelative(generation.createdAt)}</p>
        </div>
      </div>

      {running ? (
        <div className="px-4 pb-3">
          <ProgressBar value={generation.progress} />
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-fg">
            <span>{STATE_META[generation.state].hint}</span>
            <span className="tabular-nums">{formatDuration(generation.startedAt ?? generation.createdAt, null)}</span>
          </div>
        </div>
      ) : null}

      {generation.state === 'failed' && generation.errorMessage ? (
        <div className="mx-4 mb-3 flex gap-2 rounded-[10px] bg-[var(--danger-soft)] px-3 py-2.5 text-[12px] text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{generation.errorMessage}</span>
        </div>
      ) : null}

      {outputs.length > 0 ? (
        <div className={clsx('grid gap-px bg-[var(--border-subtle)]', outputs.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {outputs.map((asset) => (
            <div key={asset.id} className="group relative bg-[var(--surface-raised)]">
              <AssetPreview
                asset={asset}
                kind={generation.kind}
                className={clsx(
                  'w-full',
                  outputs.length > 1 ? 'aspect-square' : 'aspect-[4/3] max-h-[380px]',
                )}
                onClick={onOpenAsset ? () => onOpenAsset(generation, asset) : undefined}
              />
              <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {onSaveToGallery ? (
                  <Tooltip label={asset.inGallery ? 'Deja dans la galerie' : 'Enregistrer dans la galerie'}>
                    <button
                      type="button"
                      disabled={asset.inGallery || busy}
                      onClick={() => onSaveToGallery(asset)}
                      className={clsx(
                        'rounded-md p-1.5 text-white backdrop-blur transition-colors',
                        asset.inGallery ? 'bg-[var(--success)]/80' : 'bg-black/60 hover:bg-black/80',
                      )}
                      aria-label="Enregistrer dans la galerie"
                    >
                      <Star className={clsx('size-3.5', asset.inGallery && 'fill-current')} />
                    </button>
                  </Tooltip>
                ) : null}
                <Tooltip label="Telecharger">
                  <a
                    href={asset.url.startsWith('/api/') ? `${asset.url}?download=1` : asset.url}
                    download
                    target={asset.url.startsWith('/api/') ? undefined : '_blank'}
                    rel="noreferrer"
                    className="rounded-md bg-black/60 p-1.5 text-white backdrop-blur hover:bg-black/80"
                    aria-label="Telecharger le resultat"
                  >
                    <Download className="size-3.5" />
                  </a>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[12px] text-muted-fg hover:text-[var(--text-primary)]"
        >
          {expanded ? 'Masquer les parametres' : 'Voir les parametres'}
        </button>
        <div className="flex gap-1.5">
          {running && onCancel ? (
            <Button size="sm" variant="ghost" onClick={() => onCancel(generation.id)} disabled={busy}>
              Annuler
            </Button>
          ) : null}
          {!running && onDelete ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-3.5" />}
              onClick={() => onDelete(generation.id)}
              disabled={busy}
            >
              Supprimer
            </Button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] bg-[var(--surface-base)] px-4 py-3 text-[12px] sm:grid-cols-3">
          {Object.entries(generation.params).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="truncate text-muted-fg">{key}</dt>
              <dd className="truncate font-medium" title={String(value)}>
                {Array.isArray(value) ? `${value.length} fichier(s)` : String(value) || '—'}
              </dd>
            </div>
          ))}
          {generation.externalTaskId ? (
            <div className="min-w-0">
              <dt className="text-muted-fg">Tache externe</dt>
              <dd className="truncate font-mono text-[11px]" title={generation.externalTaskId}>
                {generation.externalTaskId}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-fg">Duree</dt>
            <dd className="font-medium">{formatDuration(generation.startedAt, generation.completedAt)}</dd>
          </div>
        </dl>
      ) : null}
    </Card>
  );
}
