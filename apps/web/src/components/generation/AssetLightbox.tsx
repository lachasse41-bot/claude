import { Download, Star } from 'lucide-react';
import type { Generation, GenerationAsset } from '@nova/shared';
import { Badge, Button, Modal } from '../ui';
import { formatDateTime } from '../../lib/format';
import { AssetPreview } from './GenerationCard';

/** Vue detaillee d'un resultat : media en grand + metadonnees conservees. */
export function AssetLightbox({
  open, onClose, generation, asset, onSaveToGallery, onDelete, footerExtra,
}: {
  open: boolean;
  onClose: () => void;
  generation: Pick<Generation, 'modelName' | 'kind' | 'prompt' | 'params' | 'creditCost' | 'createdAt' | 'userName'> | null;
  asset: GenerationAsset | null;
  onSaveToGallery?: (asset: GenerationAsset) => void;
  onDelete?: () => void;
  footerExtra?: React.ReactNode;
}) {
  if (!asset || !generation) return null;
  const downloadUrl = asset.url.startsWith('/api/') ? `${asset.url}?download=1` : asset.url;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={generation.modelName}
      description={formatDateTime(generation.createdAt)}
      footer={
        <>
          {footerExtra}
          {onDelete ? (
            <Button variant="ghost" onClick={onDelete}>Supprimer</Button>
          ) : null}
          {onSaveToGallery && !asset.inGallery ? (
            <Button variant="secondary" icon={<Star className="size-4" />} onClick={() => onSaveToGallery(asset)}>
              Enregistrer
            </Button>
          ) : null}
          <a href={downloadUrl} download target={asset.url.startsWith('/api/') ? undefined : '_blank'} rel="noreferrer">
            <Button icon={<Download className="size-4" />}>Telecharger</Button>
          </a>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-[10px] border border-[var(--border-subtle)]">
          <AssetPreview asset={asset} kind={generation.kind} className="max-h-[62vh] w-full object-contain" />
        </div>
        <div className="space-y-4 text-[13px]">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Prompt</p>
            <p className="leading-relaxed">{generation.prompt || <span className="text-muted-fg">Sans prompt</span>}</p>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Parametres</p>
            <dl className="space-y-1.5">
              {Object.entries(generation.params).map(([key, value]) => (
                <div key={key} className="flex items-start justify-between gap-3">
                  <dt className="text-muted-fg">{key}</dt>
                  <dd className="truncate text-right font-medium" title={String(value)}>
                    {Array.isArray(value) ? `${value.length} fichier(s)` : String(value) || '—'}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="accent">{generation.creditCost} credits</Badge>
            {generation.userName ? <Badge>{generation.userName}</Badge> : null}
            {asset.inGallery ? <Badge tone="success">Dans la galerie</Badge> : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
