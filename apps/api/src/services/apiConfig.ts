import type { ApiConfigurationStatus } from '@nova/shared';
import { db, nowIso } from '../db/index.js';
import { env } from '../env.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { id } from '../lib/ids.js';

interface ConfigRow {
  id: string; organization_id: string; provider: string; base_url: string;
  api_key_encrypted: string | null; key_last4: string | null;
  last_check_at: string | null; last_check_status: string | null; last_check_message: string | null;
  updated_by: string | null; updated_at: string; updated_by_name?: string | null;
}

function row(organizationId: string): ConfigRow | undefined {
  return db.prepare(`
    SELECT c.*, u.name AS updated_by_name FROM api_configurations c
    LEFT JOIN users u ON u.id = c.updated_by
    WHERE c.organization_id = ? AND c.provider = 'kie'
  `).get(organizationId) as ConfigRow | undefined;
}

export function ensureApiConfiguration(organizationId: string): void {
  if (row(organizationId)) return;
  db.prepare(`
    INSERT INTO api_configurations (id, organization_id, provider, base_url, updated_at)
    VALUES (?, ?, 'kie', ?, ?)
  `).run(id('cfg'), organizationId, env.kieBaseUrl, nowIso());
}

/**
 * Resolution de la cle API :
 *   1. cle enregistree en base pour l'organisation (chiffree AES-256-GCM)
 *   2. a defaut, la variable d'environnement KIE_API_KEY
 * La cle ne quitte jamais le serveur.
 */
export function resolveCredentials(organizationId: string): { baseUrl: string; apiKey: string | null } {
  const config = row(organizationId);
  const baseUrl = config?.base_url || env.kieBaseUrl;
  if (config?.api_key_encrypted) {
    try {
      return { baseUrl, apiKey: decryptSecret(config.api_key_encrypted) };
    } catch (error) {
      logger.error('Dechiffrement de la cle API impossible', { organizationId, error: String(error) });
    }
  }
  return { baseUrl, apiKey: env.kieApiKey || null };
}

export function getApiConfigurationStatus(organizationId: string): ApiConfigurationStatus {
  ensureApiConfiguration(organizationId);
  const config = row(organizationId)!;
  const resolved = resolveCredentials(organizationId);
  return {
    provider: 'kie',
    baseUrl: config.base_url,
    configured: Boolean(resolved.apiKey),
    keyLast4: config.key_last4 ?? (env.kieApiKey ? env.kieApiKey.slice(-4) : null),
    updatedAt: config.updated_at,
    updatedByName: config.updated_by_name ?? null,
    lastCheckAt: config.last_check_at,
    lastCheckStatus: (config.last_check_status as 'ok' | 'error' | null) ?? null,
    lastCheckMessage: config.last_check_message,
  };
}

export function updateApiConfiguration(
  organizationId: string,
  patch: { apiKey?: string | null; baseUrl?: string },
  actorUserId: string,
): ApiConfigurationStatus {
  ensureApiConfiguration(organizationId);
  const current = row(organizationId)!;

  const baseUrl = (patch.baseUrl ?? current.base_url).replace(/\/$/, '');
  let encrypted = current.api_key_encrypted;
  let last4 = current.key_last4;

  if (patch.apiKey === null) {
    encrypted = null;
    last4 = null;
  } else if (typeof patch.apiKey === 'string' && patch.apiKey.trim().length > 0) {
    const key = patch.apiKey.trim();
    encrypted = encryptSecret(key);
    last4 = key.slice(-4);
  }

  db.prepare(`
    UPDATE api_configurations
    SET base_url = ?, api_key_encrypted = ?, key_last4 = ?, updated_by = ?, updated_at = ?
    WHERE organization_id = ? AND provider = 'kie'
  `).run(baseUrl, encrypted, last4, actorUserId, nowIso(), organizationId);

  return getApiConfigurationStatus(organizationId);
}

export function recordConnectivityCheck(
  organizationId: string,
  status: 'ok' | 'error',
  message: string,
): void {
  db.prepare(`
    UPDATE api_configurations SET last_check_at = ?, last_check_status = ?, last_check_message = ?
    WHERE organization_id = ? AND provider = 'kie'
  `).run(nowIso(), status, message.slice(0, 300), organizationId);
}
