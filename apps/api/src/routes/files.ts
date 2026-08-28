import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../env.js';
import { AppError, badRequest } from '../lib/errors.js';
import { asyncRoute } from '../middleware/error.js';
import { currentUser, requireAuth } from '../middleware/context.js';
import {
  ALLOWED_MIME_PREFIXES, absolutePath, deleteFileById, getAccessibleFile,
  listUserFiles, saveFile, toStoredFile, verifyPublicAccess,
} from '../services/files.js';
import { getSettings } from '../services/organizations.js';
import { viewerOf } from './helpers.js';

export const filesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadSizeMb * 1024 * 1024, files: 10 },
  // Premier filtre (type declare). Le contenu reel est verifie ensuite par
  // `saveFile`, qui controle aussi la signature binaire du fichier.
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').split(';')[0].toLowerCase();
    if (ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) cb(null, true);
    else {
      cb(new AppError('upload_error', `Type de fichier non autorise : ${mime || 'inconnu'}. Formats acceptes : images, audio, video.`));
    }
  },
});

/**
 * URL publique signee : seul point d'acces non authentifie de l'application.
 * Elle existe parce que KIE.ai doit pouvoir telecharger les fichiers de
 * reference. Elle est signee (HMAC) et expire automatiquement.
 * Declaree avant `/:fileId/content` pour ne pas etre captee par ce dernier.
 */
filesRouter.get('/public/:fileId', asyncRoute(async (req, res) => {
  const row = verifyPublicAccess(
    req.params.fileId,
    String(req.query.expires ?? ''),
    String(req.query.signature ?? ''),
  );
  const absolute = absolutePath(row);
  if (!fs.existsSync(absolute)) throw badRequest('Fichier indisponible.');
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(absolute).pipe(res);
}));

filesRouter.use(requireAuth);

filesRouter.get('/', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  res.json({ files: listUserFiles(user.organization_id, user.id) });
}));

/** Televersement des references. Validation stricte du type et de la taille. */
filesRouter.post('/', upload.array('files', 10), asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const settings = getSettings(user.organization_id);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw badRequest('Aucun fichier recu.');

  const stored = files.map((file) =>
    saveFile({
      organizationId: user.organization_id,
      userId: user.id,
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      maxSizeBytes: settings.maxUploadSizeMb * 1024 * 1024,
    }),
  );
  res.status(201).json({ files: stored });
}));

filesRouter.get('/:fileId/content', asyncRoute(async (req, res) => {
  const row = getAccessibleFile(req.params.fileId, viewerOf(req));
  const absolute = absolutePath(row);
  if (!fs.existsSync(absolute)) throw badRequest('Fichier indisponible.');
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${row.original_name.replace(/"/g, '')}"`);
  }
  fs.createReadStream(absolute).pipe(res);
}));

filesRouter.get('/:fileId', asyncRoute(async (req, res) => {
  res.json({ file: toStoredFile(getAccessibleFile(req.params.fileId, viewerOf(req))) });
}));

filesRouter.delete('/:fileId', asyncRoute(async (req, res) => {
  const row = getAccessibleFile(req.params.fileId, viewerOf(req));
  deleteFileById(row.id);
  res.json({ ok: true });
}));
