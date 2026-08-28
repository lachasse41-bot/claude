import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, nowIso } from '../db/index.js';
import { env } from '../env.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { signPayload, verifySignature } from '../lib/crypto.js';
import { id } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

export interface FileRow {
  id: string; organization_id: string; user_id: string | null; original_name: string;
  stored_path: string; mime_type: string; size_bytes: number; checksum: string;
  source: string; created_at: string;
}

export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** URL authentifiee (cookie de session) pour l'affichage dans l'application. */
  url: string;
}

/** Types acceptes a l'upload. Liste blanche stricte. */
export const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/'];
export const ALLOWED_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/ogg',
  'video/mp4', 'video/webm', 'video/quicktime',
]);

/** Signatures binaires verifiees pour empecher un fichier deguise. */
const MAGIC: Array<{ mime: RegExp; test: (buf: Buffer) => boolean }> = [
  { mime: /^image\/png$/, test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: /^image\/jpeg$/, test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: /^image\/gif$/, test: (b) => b.subarray(0, 3).toString('ascii') === 'GIF' },
  { mime: /^image\/webp$/, test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

function extensionFor(mime: string, fallbackName: string): string {
  const map: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a', 'audio/webm': '.weba', 'audio/ogg': '.ogg',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  };
  if (map[mime]) return map[mime];
  const ext = path.extname(fallbackName).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '.bin';
}

export function sanitizeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return base || 'fichier';
}

export interface SaveFileInput {
  organizationId: string;
  userId: string | null;
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  source?: 'upload' | 'provider_output';
  maxSizeBytes?: number;
}

export function saveFile(input: SaveFileInput): StoredFile {
  const mime = (input.mimeType || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mime) && !ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
    throw new AppError('upload_error', `Type de fichier non autorise : ${mime || 'inconnu'}.`);
  }
  const maxSize = (input.maxSizeBytes ?? env.maxUploadSizeMb * 1024 * 1024);
  if (input.buffer.length === 0) throw new AppError('upload_error', 'Fichier vide.');
  if (input.buffer.length > maxSize) {
    throw new AppError('upload_error', `Fichier trop volumineux (maximum ${Math.round(maxSize / 1024 / 1024)} Mo).`);
  }

  // Coherence entre le type declare et le contenu reel.
  const magic = MAGIC.find((m) => m.mime.test(mime));
  if (magic && !magic.test(input.buffer)) {
    throw new AppError('upload_error', 'Le contenu du fichier ne correspond pas a son type declare.');
  }

  const fileId = id('fil');
  const checksum = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const relative = path.join(
    input.organizationId,
    input.userId ?? 'system',
    `${fileId}${extensionFor(mime, input.originalName)}`,
  );
  const absolute = path.join(env.storageDir, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, input.buffer, { mode: 0o600 });

  db.prepare(`
    INSERT INTO files (id, organization_id, user_id, original_name, stored_path, mime_type,
                       size_bytes, checksum, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fileId, input.organizationId, input.userId, sanitizeName(input.originalName), relative,
    mime, input.buffer.length, checksum, input.source ?? 'upload', nowIso(),
  );

  return {
    id: fileId,
    name: sanitizeName(input.originalName),
    mimeType: mime,
    sizeBytes: input.buffer.length,
    createdAt: nowIso(),
    url: `/api/files/${fileId}/content`,
  };
}

export function getFileRow(fileId: string): FileRow | undefined {
  return db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileRow | undefined;
}

/**
 * Charge un fichier en verifiant l'appartenance.
 * Un collaborateur n'accede qu'a ses propres fichiers ; un administrateur
 * accede a ceux de son organisation.
 */
export function getAccessibleFile(
  fileId: string,
  viewer: { organizationId: string; userId: string; role: string },
): FileRow {
  const row = getFileRow(fileId);
  if (!row) throw notFound('Fichier introuvable.');
  if (row.organization_id !== viewer.organizationId) throw notFound('Fichier introuvable.');
  if (viewer.role !== 'admin' && row.user_id !== viewer.userId) {
    throw forbidden("Ce fichier appartient a un autre collaborateur.");
  }
  return row;
}

export function absolutePath(row: FileRow): string {
  const absolute = path.join(env.storageDir, row.stored_path);
  const normalizedRoot = path.resolve(env.storageDir) + path.sep;
  if (!path.resolve(absolute).startsWith(normalizedRoot)) {
    // Garde-fou contre une traversee de chemin depuis une donnee corrompue.
    throw new AppError('internal_error', 'Chemin de fichier invalide.');
  }
  return absolute;
}

export function toStoredFile(row: FileRow): StoredFile {
  return {
    id: row.id,
    name: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    url: `/api/files/${row.id}/content`,
  };
}

/* ------------------------------------------------------------------ */
/* URL publiques signees (acces provider)                              */
/* ------------------------------------------------------------------ */

/**
 * KIE.ai telecharge les images de reference depuis une URL publique.
 * On expose donc une URL non authentifiee mais :
 *   - impossible a deviner (signature HMAC)
 *   - a duree de vie limitee
 *   - liee a un unique identifiant de fichier
 * `PUBLIC_BASE_URL` doit etre joignable depuis Internet.
 */
export function signedPublicUrl(fileId: string, ttlSeconds = env.signedUrlTtlSeconds): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = signPayload(`${fileId}.${expires}`);
  return `${env.publicBaseUrl}/api/files/public/${fileId}?expires=${expires}&signature=${signature}`;
}

export function verifyPublicAccess(fileId: string, expires: string, signature: string): FileRow {
  const expiresAt = Number.parseInt(expires, 10);
  if (!Number.isFinite(expiresAt)) throw badRequest('Lien invalide.');
  if (expiresAt * 1000 < Date.now()) throw forbidden('Ce lien a expire.');
  if (!verifySignature(`${fileId}.${expiresAt}`, signature)) throw forbidden('Signature invalide.');
  const row = getFileRow(fileId);
  if (!row) throw notFound('Fichier introuvable.');
  return row;
}

/** Resout des identifiants de fichiers en URL publiques signees. */
export function resolveFileUrls(
  fileIds: string[],
  viewer: { organizationId: string; userId: string; role: string },
): { urls: string[]; rows: FileRow[] } {
  const rows = fileIds.map((fid) => getAccessibleFile(fid, viewer));
  return { urls: rows.map((r) => signedPublicUrl(r.id)), rows };
}

/* ------------------------------------------------------------------ */
/* Recopie des sorties provider                                        */
/* ------------------------------------------------------------------ */

/**
 * Telecharge un fichier produit par le provider vers le stockage local.
 * Les URL provider sont souvent temporaires : la recopie garantit que la
 * galerie reste consultable dans la duree. En cas d'echec, l'appelant
 * conserve l'URL distante.
 */
export async function mirrorRemoteFile(input: {
  organizationId: string;
  userId: string;
  url: string;
  timeoutMs?: number;
  maxSizeBytes?: number;
}): Promise<StoredFile | null> {
  if (!env.mirrorOutputs) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
  try {
    const response = await fetch(input.url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0];
    const buffer = Buffer.from(await response.arrayBuffer());
    const name = sanitizeName(decodeURIComponent(new URL(input.url).pathname.split('/').pop() ?? 'resultat'));
    return saveFile({
      organizationId: input.organizationId,
      userId: input.userId,
      buffer,
      originalName: name,
      mimeType: contentType,
      source: 'provider_output',
      maxSizeBytes: input.maxSizeBytes ?? 512 * 1024 * 1024,
    });
  } catch (error) {
    logger.warn('Recopie du fichier provider impossible, URL distante conservee', {
      url: input.url.slice(0, 120),
      error: String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function deleteStoredFiles(relativePaths: string[]): void {
  for (const relative of relativePaths) {
    try {
      const absolute = path.join(env.storageDir, relative);
      if (path.resolve(absolute).startsWith(path.resolve(env.storageDir) + path.sep)) {
        fs.rmSync(absolute, { force: true });
      }
    } catch (error) {
      logger.warn('Suppression du fichier impossible', { relative, error: String(error) });
    }
  }
}

export function deleteFileById(fileId: string): void {
  const row = getFileRow(fileId);
  if (!row) return;
  deleteStoredFiles([row.stored_path]);
  db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
}

export function listUserFiles(organizationId: string, userId: string, limit = 60): StoredFile[] {
  const rows = db.prepare(
    `SELECT * FROM files WHERE organization_id = ? AND user_id = ? AND source = 'upload'
     ORDER BY created_at DESC LIMIT ?`,
  ).all(organizationId, userId, limit) as FileRow[];
  return rows.map(toStoredFile);
}
