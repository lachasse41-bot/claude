import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../middleware/error.js';
import { clientIp, currentUser, requireAuth } from '../middleware/context.js';
import { logActivity } from '../services/activity.js';
import {
  addToGallery, getGalleryItem, listGallery, removeFromGallery, updateGalleryItem,
} from '../services/gallery.js';
import { paginationSchema, scopedUserId, str, viewerOf } from './helpers.js';

export const galleryRouter = Router();
galleryRouter.use(requireAuth);

galleryRouter.get('/', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const { page, pageSize } = paginationSchema.parse(req.query);
  res.json(
    listGallery({
      organizationId: user.organization_id,
      userId: scopedUserId(req),
      kind: str(req.query.kind),
      modelKey: str(req.query.modelKey),
      search: str(req.query.search),
      favorite: req.query.favorite === '1',
      sort: (str(req.query.sort) as 'recent' | 'oldest' | 'title') ?? 'recent',
      page,
      pageSize,
    }),
  );
}));

const addSchema = z.object({
  assetId: z.string().min(1, 'Resultat requis.'),
  title: z.string().max(160).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
});

galleryRouter.post('/', asyncRoute(async (req, res) => {
  const input = addSchema.parse(req.body);
  const user = currentUser(req);
  const item = addToGallery(input, viewerOf(req));
  logActivity({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'gallery.item_added',
    entityType: 'gallery_item',
    entityId: item.id,
    metadata: { modelKey: item.generation.modelKey },
    ip: clientIp(req),
  });
  res.status(201).json({ item });
}));

galleryRouter.get('/:itemId', asyncRoute(async (req, res) => {
  res.json({ item: getGalleryItem(req.params.itemId, viewerOf(req)) });
}));

const patchSchema = z.object({
  title: z.string().max(160).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  favorite: z.boolean().optional(),
});

galleryRouter.patch('/:itemId', asyncRoute(async (req, res) => {
  const patch = patchSchema.parse(req.body);
  res.json({ item: updateGalleryItem(req.params.itemId, patch, viewerOf(req)) });
}));

galleryRouter.delete('/:itemId', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  removeFromGallery(req.params.itemId, viewerOf(req));
  logActivity({
    organizationId: user.organization_id,
    actorUserId: user.id,
    actorName: user.name,
    actorEmail: user.email,
    action: 'gallery.item_removed',
    entityType: 'gallery_item',
    entityId: req.params.itemId,
    ip: clientIp(req),
  });
  res.json({ ok: true });
}));
