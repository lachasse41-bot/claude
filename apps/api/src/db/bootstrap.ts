import crypto from 'node:crypto';
import { db, nowIso } from './index.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { id } from '../lib/ids.js';
import { DEFAULT_SETTINGS } from '../services/organizations.js';
import { ensureApiConfiguration } from '../services/apiConfig.js';
import { seedModelsForOrganization } from '../services/models.js';
import { createUser } from '../services/users.js';

const ROLES = [
  {
    key: 'admin',
    label: 'Administrateur',
    description:
      "Supervise l'organisation : collaborateurs, credits, modeles, parametres et journal d'activite. Dispose aussi de toutes les fonctions de generation.",
    permissions: [
      'organization.manage', 'users.manage', 'users.delete', 'credits.manage',
      'models.manage', 'activity.read', 'generation.create', 'gallery.own', 'workflows.own',
    ],
  },
  {
    key: 'collaborator',
    label: 'Collaborateur',
    description:
      'Travaille dans son propre espace : generations, galerie, workflows et suivi de sa consommation de credits.',
    permissions: ['generation.create', 'gallery.own', 'workflows.own', 'credits.read_own'],
  },
];

/**
 * Initialisation au premier demarrage :
 *   - roles de reference
 *   - organisation principale
 *   - catalogue de modeles
 *   - compte administrateur
 *
 * Idempotent : les demarrages suivants ne modifient rien.
 */
export function bootstrap(): void {
  const insertRole = db.prepare(
    'INSERT OR REPLACE INTO roles (key, label, description, permissions) VALUES (?, ?, ?, ?)',
  );
  for (const role of ROLES) {
    insertRole.run(role.key, role.label, role.description, JSON.stringify(role.permissions));
  }

  const existing = db.prepare('SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined;

  if (existing) {
    ensureApiConfiguration(existing.id);
    seedModelsForOrganization(existing.id);
    return;
  }

  const organizationId = id('org');
  const slug = env.bootstrapOrgName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'organisation';

  db.prepare(`
    INSERT INTO organizations (id, name, slug, settings_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(organizationId, env.bootstrapOrgName, slug, JSON.stringify(DEFAULT_SETTINGS), nowIso(), nowIso());

  ensureApiConfiguration(organizationId);
  seedModelsForOrganization(organizationId);

  const password = env.bootstrapAdminPassword || generatePassword();
  createUser({
    organizationId,
    email: env.bootstrapAdminEmail,
    name: env.bootstrapAdminName,
    password,
    role: 'admin',
    initialCredits: 5000,
  });

  logger.info('Organisation initialisee', { organizationId, name: env.bootstrapOrgName });
  if (!env.bootstrapAdminPassword) {
    // Le mot de passe genere n'est affiche qu'une seule fois, au premier
    // demarrage, et n'est jamais stocke en clair.
    process.stdout.write(
      [
        '',
        '='.repeat(72),
        '  COMPTE ADMINISTRATEUR CREE',
        `  E-mail        : ${env.bootstrapAdminEmail}`,
        `  Mot de passe  : ${password}`,
        '  Ce mot de passe ne sera plus affiche. Changez-le apres connexion.',
        '='.repeat(72),
        '',
      ].join('\n'),
    );
  }
}

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(18);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out}7a`;
}
