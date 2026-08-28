import type { EmailConfigurationStatus } from '@nova/shared';
import { db, nowIso } from '../db/index.js';
import { env } from '../env.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { id } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

interface EmailConfigRow {
  id: string; organization_id: string; enabled: number; host: string; port: number;
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

/** Parametres reellement utilisables pour se connecter au serveur SMTP. */
export interface ResolvedSmtp {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
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
export function resolveSmtp(organizationId: string): ResolvedSmtp | null {
  const config = row(organizationId);

  if (config?.enabled === 1 && config.host && config.from_email) {
    let password = '';
    if (config.password_encrypted) {
      try {
        password = decryptSecret(config.password_encrypted);
      } catch (error) {
        logger.error("Dechiffrement du mot de passe SMTP impossible", {
          organizationId,
          error: String(error),
        });
        return null;
      }
    }
    return {
      host: config.host,
      port: config.port,
      secure: config.secure === 1,
      username: config.username,
      password,
      fromName: config.from_name || env.mailFromName,
      fromEmail: config.from_email,
      replyTo: config.reply_to,
      source: 'organization',
    };
  }

  if (env.smtpHost && env.mailFromEmail) {
    return {
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      username: env.smtpUser,
      password: env.smtpPassword,
      fromName: env.mailFromName,
      fromEmail: env.mailFromEmail,
      replyTo: env.mailReplyTo,
      source: 'environment',
    };
  }

  return null;
}

export function getEmailConfigurationStatus(organizationId: string): EmailConfigurationStatus {
  ensureEmailConfiguration(organizationId);
  const config = row(organizationId)!;
  const resolved = resolveSmtp(organizationId);

  return {
    enabled: config.enabled === 1,
    configured: Boolean(resolved),
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

  db.prepare(`
    UPDATE email_configurations
    SET enabled = ?, host = ?, port = ?, secure = ?, username = ?, password_encrypted = ?,
        from_name = ?, from_email = ?, reply_to = ?, updated_by = ?, updated_at = ?
    WHERE organization_id = ?
  `).run(
    (patch.enabled ?? current.enabled === 1) ? 1 : 0,
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
