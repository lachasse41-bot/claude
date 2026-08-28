import type { EmailConfigurationStatus, EmailProvider } from '@nova/shared';
import { db, nowIso } from '../db/index.js';
import { env } from '../env.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { id } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

interface EmailConfigRow {
  id: string; organization_id: string; enabled: number; provider: string;
  api_key_encrypted: string | null; host: string; port: number;
  secure: number; username: string; password_encrypted: string | null;
  from_name: string; from_email: string; reply_to: string;
  last_check_at: string | null; last_check_status: string | null; last_check_message: string | null;
  updated_by: string | null; updated_at: string; updated_by_name?: string | null;
}

function row(organizationId: string): EmailConfigRow | undefined {
  return db.prepare(`
    SELECT c.*, u.name AS updated_by_name FROM email_configurations c
    LEFT JOIN users u ON u.id = c.updated_by
    WHERE c.organization_id = ?
  `).get(organizationId) as EmailConfigRow | undefined;
}

export function ensureEmailConfiguration(organizationId: string): void {
  if (row(organizationId)) return;
  db.prepare(`
    INSERT INTO email_configurations (id, organization_id, port, from_name, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id('mcf'), organizationId, env.smtpPort, env.mailFromName, nowIso());
}

/** Parametres reellement utilisables pour envoyer un message. */
export interface ResolvedMailer {
  provider: EmailProvider;
  /** Renseigne pour le mode SMTP. */
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  /** Renseigne pour les fournisseurs HTTP. */
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  source: 'organization' | 'environment';
}

/**
 * Resolution de la configuration d'envoi :
 *   1. parametres enregistres pour l'organisation (mot de passe dechiffre)
 *   2. a defaut, les variables d'environnement
 * Retourne `null` si aucune configuration exploitable n'existe : l'application
 * bascule alors en mode « lien a transmettre manuellement ».
 */
export function resolveMailer(organizationId: string): ResolvedMailer | null {
  const config = row(organizationId);

  if (config?.enabled === 1 && config.from_email) {
    const provider = (config.provider as EmailProvider) ?? 'smtp';
    const decrypt = (value: string | null, label: string): string | null => {
      if (!value) return '';
      try {
        return decryptSecret(value);
      } catch (error) {
        logger.error(`Dechiffrement ${label} impossible`, { organizationId, error: String(error) });
        return null;
      }
    };

    if (provider === 'smtp') {
      if (!config.host) return envFallback();
      const password = decrypt(config.password_encrypted, 'du mot de passe SMTP');
      if (password === null) return null;
      return {
        provider: 'smtp',
        host: config.host,
        port: config.port,
        secure: config.secure === 1,
        username: config.username,
        password,
        apiKey: '',
        fromName: config.from_name || env.mailFromName,
        fromEmail: config.from_email,
        replyTo: config.reply_to,
        source: 'organization',
      };
    }

    // Fournisseur HTTP : seule la cle API compte.
    const apiKey = decrypt(config.api_key_encrypted, 'de la cle API e-mail');
    if (apiKey === null) return null;
    if (!apiKey) return envFallback();
    return {
      provider,
      host: '', port: 0, secure: false, username: '', password: '',
      apiKey,
      fromName: config.from_name || env.mailFromName,
      fromEmail: config.from_email,
      replyTo: config.reply_to,
      source: 'organization',
    };
  }

  return envFallback();
}

/** Repli sur les variables d'environnement (mode SMTP uniquement). */
function envFallback(): ResolvedMailer | null {
  if (!env.smtpHost || !env.mailFromEmail) return null;
  return {
    provider: 'smtp',
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    username: env.smtpUser,
    password: env.smtpPassword,
    apiKey: '',
    fromName: env.mailFromName,
    fromEmail: env.mailFromEmail,
    replyTo: env.mailReplyTo,
    source: 'environment',
  };
}

export function getEmailConfigurationStatus(organizationId: string): EmailConfigurationStatus {
  ensureEmailConfiguration(organizationId);
  const config = row(organizationId)!;
  const resolved = resolveMailer(organizationId);

  return {
    enabled: config.enabled === 1,
    configured: Boolean(resolved),
    provider: (config.provider as EmailProvider) ?? 'smtp',
    hasApiKey: Boolean(config.api_key_encrypted),
    host: config.host || (resolved?.source === 'environment' ? resolved.host : ''),
    port: config.port,
    secure: config.secure === 1,
    username: config.username,
    fromName: config.from_name || env.mailFromName,
    fromEmail: config.from_email || (resolved?.source === 'environment' ? resolved.fromEmail : ''),
    replyTo: config.reply_to,
    source: resolved ? resolved.source : 'none',
    // Le mot de passe n'est jamais renvoye : seule sa presence est exposee.
    hasPassword: Boolean(config.password_encrypted) || Boolean(env.smtpPassword),
    updatedAt: config.updated_at,
    updatedByName: config.updated_by_name ?? null,
    lastCheckAt: config.last_check_at,
    lastCheckStatus: (config.last_check_status as 'ok' | 'error' | null) ?? null,
    lastCheckMessage: config.last_check_message,
  };
}

export interface EmailConfigPatch {
  enabled?: boolean;
  provider?: EmailProvider;
  /** `null` efface la cle API ; `undefined` la conserve. */
  apiKey?: string | null;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  /** `null` efface le mot de passe ; `undefined` le conserve. */
  password?: string | null;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
}

export function updateEmailConfiguration(
  organizationId: string,
  patch: EmailConfigPatch,
  actorUserId: string,
): EmailConfigurationStatus {
  ensureEmailConfiguration(organizationId);
  const current = row(organizationId)!;

  let encrypted = current.password_encrypted;
  if (patch.password === null) encrypted = null;
  else if (typeof patch.password === 'string' && patch.password.length > 0) {
    encrypted = encryptSecret(patch.password);
  }

  let apiKeyEncrypted = current.api_key_encrypted;
  if (patch.apiKey === null) apiKeyEncrypted = null;
  else if (typeof patch.apiKey === 'string' && patch.apiKey.trim().length > 0) {
    apiKeyEncrypted = encryptSecret(patch.apiKey.trim());
  }

  db.prepare(`
    UPDATE email_configurations
    SET enabled = ?, provider = ?, api_key_encrypted = ?,
        host = ?, port = ?, secure = ?, username = ?, password_encrypted = ?,
        from_name = ?, from_email = ?, reply_to = ?, updated_by = ?, updated_at = ?
    WHERE organization_id = ?
  `).run(
    (patch.enabled ?? current.enabled === 1) ? 1 : 0,
    patch.provider ?? current.provider ?? 'smtp',
    apiKeyEncrypted,
    (patch.host ?? current.host).trim(),
    patch.port ?? current.port,
    (patch.secure ?? current.secure === 1) ? 1 : 0,
    (patch.username ?? current.username).trim(),
    encrypted,
    (patch.fromName ?? current.from_name).trim(),
    (patch.fromEmail ?? current.from_email).trim().toLowerCase(),
    (patch.replyTo ?? current.reply_to).trim().toLowerCase(),
    actorUserId,
    nowIso(),
    organizationId,
  );

  return getEmailConfigurationStatus(organizationId);
}

export function recordEmailCheck(
  organizationId: string,
  status: 'ok' | 'error',
  message: string,
): void {
  ensureEmailConfiguration(organizationId);
  db.prepare(`
    UPDATE email_configurations
    SET last_check_at = ?, last_check_status = ?, last_check_message = ?
    WHERE organization_id = ?
  `).run(nowIso(), status, message.slice(0, 300), organizationId);
}
