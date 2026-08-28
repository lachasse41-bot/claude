import type { GalleryItem } from '@nova/shared';
import { db, nowIso, parseJson } from '../db/index.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { id } from '../lib/ids.js';
import type { Viewer } from './generations.js';

interface GalleryRow {
  id: string; organization_id: string; user_id: string; generation_id: string; asset_id: string;
  title: string; tags_json: string; favorite: number; created_at: string;
  user_name: string | null;
  a_id: string; a_file_id: string | null; a_kind: string; a_role: string; a_url: string;
  a_mime: string | null; a_size: number | null; a_width: number | null; a_height: number | null;
  a_duration: number | null; a_position: number; a_created_at: string;
  g_model_key: string; g_model_name: string; g_kind: string; g_prompt: string;
  g_params: string; g_cost: number; g_created_at: string;
}

const SELECT = `
  SELECT gi.*, u.name AS user_name,
         a.id AS a_id, a.file_id AS a_file_id, a.kind AS a_kind, a.role AS a_role, a.url AS a_url,
         a.mime_type AS a_mime, a.size_bytes AS a_size, a.width AS a_width, a.height AS a_height,
         a.duration_ms AS a_duration, a.position AS a_position, a.created_at AS a_created_at,
         g.model_key AS g_model_key, g.model_name AS g_model_name, g.kind AS g_kind,
         g.prompt AS g_prompt, g.params_json AS g_params, g.credit_cost AS g_cost,
         g.created_at AS g_created_at
  FROM gallery_items gi
  JOIN generation_assets a ON a.id = gi.asset_id
  JOIN generations g ON g.id = gi.generation_id
  LEFT JOIN users u ON u.id = gi.user_id
`;

function toDto(row: GalleryRow): GalleryItem {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? undefined,
    generationId: row.generation_id,
    assetId: row.asset_id,
    title: row.title,
    tags: parseJson<string[]>(row.tags_json, []),
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    asset: {
      id: row.a_id,
      generationId: row.generation_id,
      kind: row.a_kind as 'input' | 'output',
      role: row.a_role,
      url: row.a_file_id ? `/api/files/${row.a_file_id}/content` : row.a_url,
      remoteUrl: row.a_url || null,
      mimeType: row.a_mime,
      sizeBytes: row.a_size,
      width: row.a_width,
      height: row.a_height,
      durationMs: row.a_duration,
      position: row.a_position,
      inGallery: true,
      galleryItemId: row.id,
      createdAt: row.a_created_at,
    },
    generation: {
      id: row.generation_id,
      modelKey: row.g_model_key,
      modelName: row.g_model_name,
      kind: row.g_kind as GalleryItem['generation']['kind'],
      prompt: row.g_prompt,
      params: parseJson<Record<string, unknown>>(row.g_params, {}),
      creditCost: row.g_cost,
      createdAt: row.g_created_at,
    },
  };
}

/** Ajoute un resultat a la galerie personnelle du collaborateur. */
export function addToGallery(
  input: { assetId: string; title?: string; tags?: string[] },
  viewer: Viewer,
): GalleryItem {
  const asset = db.prepare(`
    SELECT a.*, g.organization_id, g.user_id, g.prompt, g.model_name
    FROM generation_assets a JOIN generations g ON g.id = a.generation_id
    WHERE a.id = ?
  `).get(input.assetId) as
    | { id: string; generation_id: string; kind: string; organization_id: string; user_id: string; prompt: string; model_name: string }
    | undefined;

  if (!asset || asset.organization_id !== viewer.organizationId) throw notFound('Resultat introuvable.');
  if (asset.user_id !== viewer.userId) {
    // Meme un administrateur n'ajoute pas dans la galerie d'un autre : chaque
    // galerie est strictement personnelle.
    throw forbidden("Ce resultat appartient a un autre collaborateur.");
  }
  if (asset.kind !== 'output') throw conflict('Seuls les resultats generes peuvent etre enregistres.');

  const existing = db.prepare('SELECT id FROM gallery_items WHERE asset_id = ?').get(input.assetId) as
    | { id: string }
    | undefined;
  if (existing) return getGalleryItem(existing.id, viewer);

  const itemId = id('gal');
  const title = (input.title ?? asset.prompt.slice(0, 80) ?? asset.model_name).trim() || asset.model_name;
  db.prepare(`
    INSERT INTO gallery_items (id, organization_id, user_id, generation_id, asset_id, title, tags_json, favorite, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    itemId, viewer.organizationId, viewer.userId, asset.generation_id, input.assetId,
    title, JSON.stringify((input.tags ?? []).slice(0, 12)), nowIso(),
  );
  return getGalleryItem(itemId, viewer);
}

export function getGalleryItem(itemId: string, viewer: Viewer): GalleryItem {
  const row = db.prepare(`${SELECT} WHERE gi.id = ?`).get(itemId) as GalleryRow | undefined;
  if (!row || row.organization_id !== viewer.organizationId) throw notFound('Element introuvable.');
  if (viewer.role !== 'admin' && row.user_id !== viewer.userId) {
    throw forbidden('Cet element appartient a un autre collaborateur.');
  }
  return toDto(row);
}

export interface ListGalleryOptions {
  organizationId: string;
  /** null => toute l'organisation (administrateur uniquement) */
  userId: string | null;
  kind?: string;
  modelKey?: string;
  search?: string;
  favorite?: boolean;
  sort?: 'recent' | 'oldest' | 'title';
  page?: number;
  pageSize?: number;
}

export function listGallery(opts: ListGalleryOptions) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 24));
  const where = ['gi.organization_id = @organizationId'];
  const params: Record<string, unknown> = { organizationId: opts.organizationId };

  if (opts.userId) { where.push('gi.user_id = @userId'); params.userId = opts.userId; }
  if (opts.kind) { where.push('g.kind = @kind'); params.kind = opts.kind; }
  if (opts.modelKey) { where.push('g.model_key = @modelKey'); params.modelKey = opts.modelKey; }
  if (opts.favorite) where.push('gi.favorite = 1');
  if (opts.search) {
    where.push('(gi.title LIKE @search OR g.prompt LIKE @search OR gi.tags_json LIKE @search)');
    params.search = `%${opts.search}%`;
  }
  const clause = where.join(' AND ');
  const orderBy = { recent: 'gi.created_at DESC', oldest: 'gi.created_at ASC', title: 'gi.title ASC' }[
    opts.sort ?? 'recent'
  ];

  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM gallery_items gi JOIN generations g ON g.id = gi.generation_id WHERE ${clause}
  `).get(params) as { c: number };

  const rows = db.prepare(`${SELECT} WHERE ${clause} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as GalleryRow[];

  return {
    items: rows.map(toDto),
    total: total.c,
    page,
    pageSize,
    hasMore: page * pageSize < total.c,
  };
}

export function updateGalleryItem(
  itemId: string,
  patch: { title?: string; tags?: string[]; favorite?: boolean },
  viewer: Viewer,
): GalleryItem {
  const item = getGalleryItem(itemId, viewer);
  if (item.userId !== viewer.userId) throw forbidden('Cet element appartient a un autre collaborateur.');
  db.prepare('UPDATE gallery_items SET title = ?, tags_json = ?, favorite = ? WHERE id = ?').run(
    (patch.title ?? item.title).slice(0, 160),
    JSON.stringify((patch.tags ?? item.tags).slice(0, 12)),
    (patch.favorite ?? item.favorite) ? 1 : 0,
    itemId,
  );
  return getGalleryItem(itemId, viewer);
}

/**
 * Retire un element de la galerie.
 * Le resultat de generation lui-meme est conserve dans l'historique : la
 * galerie est une selection, pas le stockage primaire.
 */
export function removeFromGallery(itemId: string, viewer: Viewer): void {
  const item = getGalleryItem(itemId, viewer);
  if (viewer.role !== 'admin' && item.userId !== viewer.userId) {
    throw forbidden('Cet element appartient a un autre collaborateur.');
  }
  db.prepare('DELETE FROM gallery_items WHERE id = ?').run(itemId);
}
