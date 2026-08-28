import type { OrganizationSettings } from '@nova/shared';
import { db, nowIso, parseJson } from '../db/index.js';
import { notFound } from '../lib/errors.js';

export const DEFAULT_SETTINGS: OrganizationSettings = {
  allowOverdraftByDefault: false,
  defaultCollaboratorCredits: 500,
  maxConcurrentGenerationsPerUser: 5,
  maxUploadSizeMb: 25,
  invitationsEnabled: true,
};

interface OrgRow {
  id: string; name: string; slug: string; settings_json: string; created_at: string; updated_at: string;
}

export interface Organization {
  id: string; name: string; slug: string; settings: OrganizationSettings; createdAt: string;
}

function toDto(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    settings: { ...DEFAULT_SETTINGS, ...parseJson<Partial<OrganizationSettings>>(row.settings_json, {}) },
    createdAt: row.created_at,
  };
}

export function getOrganization(organizationId: string): Organization {
  const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId) as OrgRow | undefined;
  if (!row) throw notFound('Organisation introuvable.');
  return toDto(row);
}

export function getSettings(organizationId: string): OrganizationSettings {
  return getOrganization(organizationId).settings;
}

export function updateSettings(
  organizationId: string,
  patch: Partial<OrganizationSettings>,
): OrganizationSettings {
  const current = getSettings(organizationId);
  const next: OrganizationSettings = { ...current, ...patch };
  db.prepare('UPDATE organizations SET settings_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(next), nowIso(), organizationId);
  return next;
}

export function renameOrganization(organizationId: string, name: string): Organization {
  db.prepare('UPDATE organizations SET name = ?, updated_at = ? WHERE id = ?')
    .run(name, nowIso(), organizationId);
  return getOrganization(organizationId);
}
