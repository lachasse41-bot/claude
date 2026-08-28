import clsx from 'clsx';
import { AudioLines, Film, Image as ImageIcon } from 'lucide-react';
import type { ModelKind, ModelSummary } from '@nova/shared';
import { Badge } from '../ui';

export const KIND_META: Record<ModelKind, { label: string; icon: typeof ImageIcon }> = {
  image: { label: 'Image', icon: ImageIcon },
  video: { label: 'Video', icon: Film },
  audio: { label: 'Audio', icon: AudioLines },
};

export function ModelPicker({
  models, value, onChange, columns = 1,
}: {
  models: ModelSummary[];
  value: string;
  onChange: (key: string) => void;
  /** 1 colonne dans la barre laterale (etroite), 2 en pleine largeur. */
  columns?: 1 | 2;
}) {
  return (
    <div className={clsx('grid gap-2', columns === 2 && 'sm:grid-cols-2')}>
      {models.map((model) => {
        const Icon = KIND_META[model.kind].icon;
        const selected = model.key === value;
        return (
          <button
            key={model.key}
            type="button"
            onClick={() => onChange(model.key)}
            aria-pressed={selected}
            className={clsx(
              'flex items-start gap-3 rounded-[10px] border p-3 text-left transition-all',
              selected
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
            )}
          >
            <span
              className={clsx(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                selected ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-hover)] text-[var(--text-secondary)]',
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13.5px] font-medium">{model.name}</span>
                <Badge tone={selected ? 'accent' : 'neutral'} className="shrink-0">
                  {model.baseCost} cr.
                </Badge>
              </span>
              <span className="mt-0.5 block line-clamp-2 text-[12px] text-secondary-fg">
                {model.description}
              </span>
              <span className="mt-1 block text-[11px] text-muted-fg">
                {model.family} · {KIND_META[model.kind].label}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
