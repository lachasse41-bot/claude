import { useRef, useState } from 'react';
import clsx from 'clsx';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { ApiError, api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { useToast } from '../ui';

interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

/**
 * Zone de televersement.
 * Les fichiers sont envoyes a l'API des leur selection : le formulaire ne
 * manipule ensuite que des identifiants. C'est le serveur qui genere les URL
 * temporaires transmises au fournisseur de modeles.
 */
export function FilePicker({
  value, onChange, accept, minItems, maxItems, disabled,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  accept: string[];
  minItems: number;
  maxItems: number;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Record<string, StoredFile>>({});
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const toast = useToast();

  const full = value.length >= maxItems;

  async function handleFiles(list: FileList | null) {
    if (!list?.length || disabled) return;
    const remaining = maxItems - value.length;
    if (remaining <= 0) {
      toast.error('Limite atteinte', `${maxItems} fichier(s) au maximum pour ce modele.`);
      return;
    }

    const form = new FormData();
    for (const file of Array.from(list).slice(0, remaining)) form.append('files', file);

    setUploading(true);
    try {
      const response = await api.upload<{ files: StoredFile[] }>('/files', form);
      setFiles((current) => {
        const next = { ...current };
        for (const file of response.files) next[file.id] = file;
        return next;
      });
      onChange([...value, ...response.files.map((f) => f.id)]);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Televersement impossible.';
      toast.error('Fichier refuse', message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {value.map((fileId) => {
            const file = files[fileId];
            const isImage = file?.mimeType?.startsWith('image/') ?? true;
            return (
              <li
                key={fileId}
                className="group relative aspect-square overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]"
              >
                {isImage ? (
                  <img
                    src={file?.url ?? `/api/files/${fileId}/content`}
                    alt={file?.name ?? 'Reference'}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center">
                    <span className="text-[11px] font-medium">{file?.name ?? 'Fichier'}</span>
                    <span className="text-[10px] text-muted-fg">{formatBytes(file?.sizeBytes)}</span>
                  </div>
                )}
                <button
                  type="button"
                  aria-label="Retirer ce fichier"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((id) => id !== fileId))}
                  className="absolute right-1 top-1 rounded-md bg-black/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!full ? (
        <div
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void handleFiles(event.dataTransfer.files);
          }}
          className={clsx(
            'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed px-4 py-6 text-center transition-colors',
            dragging
              ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
              : 'border-[var(--border-strong)] hover:border-[var(--text-muted)] hover:bg-[var(--surface-hover)]',
            disabled && 'pointer-events-none opacity-60',
          )}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => { if (event.key === 'Enter') inputRef.current?.click(); }}
        >
          {uploading ? (
            <Loader2 className="size-5 animate-spin text-[var(--accent)]" aria-hidden />
          ) : (
            <ImagePlus className="size-5 text-[var(--text-muted)]" aria-hidden />
          )}
          <p className="text-[13px] font-medium">
            {uploading ? 'Televersement...' : 'Deposez vos fichiers ou cliquez'}
          </p>
          <p className="text-[11px] text-muted-fg">
            {accept.map((type) => type.split('/')[1]?.toUpperCase()).filter(Boolean).join(', ')}
            {minItems > 0 ? ` — ${minItems} requis` : ''}
            {` — ${value.length}/${maxItems}`}
          </p>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            multiple={maxItems > 1}
            accept={accept.join(',')}
            onChange={(event) => void handleFiles(event.target.files)}
          />
        </div>
      ) : null}
    </div>
  );
}
