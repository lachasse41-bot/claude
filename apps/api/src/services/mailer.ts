import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailDeliveryResult } from '@nova/shared';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { resolveSmtp, type ResolvedSmtp } from './emailConfig.js';
import type { RenderedEmail } from './emailTemplates.js';

/**
 * Service d'envoi d'e-mails.
 * ---------------------------------------------------------------------------
 * Deux modes, choisis automatiquement :
 *  - SMTP configure  : le message est reellement envoye ;
 *  - non configure   : le message est journalise cote serveur et l'appelant
 *                      recoit `delivered: false` avec la raison. Les parcours
 *                      concernes (invitation, mot de passe oublie) restent
 *                      fonctionnels : le lien est alors transmis a la main.
 *
 * Un echec d'envoi ne doit JAMAIS faire echouer l'operation metier : une
 * invitation reste valable meme si l'e-mail n'est pas parti.
 */

/** Les transporteurs sont mis en cache par configuration pour reutiliser la connexion. */
const transporters = new Map<string, Transporter>();

function cacheKey(smtp: ResolvedSmtp): string {
  return [smtp.host, smtp.port, smtp.secure, smtp.username, smtp.fromEmail].join('|');
}

function getTransporter(smtp: ResolvedSmtp): Transporter {
  const key = cacheKey(smtp);
  const existing = transporters.get(key);
  if (existing) return existing;

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    connectionTimeout: env.mailTimeoutMs,
    greetingTimeout: env.mailTimeoutMs,
    socketTimeout: env.mailTimeoutMs,
    pool: true,
    maxConnections: 3,
  });
  transporters.set(key, transporter);
  return transporter;
}

/** Vide le cache : a appeler apres modification de la configuration. */
export function resetTransporters(): void {
  for (const transporter of transporters.values()) transporter.close();
  transporters.clear();
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export interface SendOptions {
  organizationId: string;
  to: string;
  message: RenderedEmail;
  /** Contexte de journalisation (type de message envoye). */
  kind: string;
}

export async function sendEmail(options: SendOptions): Promise<EmailDeliveryResult> {
  const to = options.to.trim();
  // Garde-fou contre l'injection d'en-tetes : une adresse ne contient ni
  // saut de ligne, ni virgule, ni point-virgule.
  if (!EMAIL_RE.test(to)) {
    logger.warn('Adresse destinataire invalide, envoi abandonne', { kind: options.kind });
    return { delivered: false, reason: 'Adresse destinataire invalide.' };
  }

  const smtp = resolveSmtp(options.organizationId);
  if (!smtp) {
    // Mode « lien a transmettre » : trace serveur uniquement.
    logger.info("Envoi d'e-mail non configure — message journalise", {
      kind: options.kind,
      to,
      subject: options.message.subject,
    });
    return {
      delivered: false,
      reason: "L'envoi d'e-mails n'est pas configure.",
    };
  }

  try {
    const info = await getTransporter(smtp).sendMail({
      from: smtp.fromName ? { name: smtp.fromName, address: smtp.fromEmail } : smtp.fromEmail,
      replyTo: smtp.replyTo || undefined,
      to,
      subject: options.message.subject,
      text: options.message.text,
      html: options.message.html,
    });
    logger.info('E-mail envoye', { kind: options.kind, to, messageId: info.messageId });
    return { delivered: true, reason: null };
  } catch (error) {
    // Le detail technique reste cote serveur ; l'appelant recoit un message neutre.
    logger.error("Echec d'envoi d'e-mail", {
      kind: options.kind,
      to,
      host: smtp.host,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      delivered: false,
      reason: "L'e-mail n'a pas pu etre envoye. Verifiez la configuration SMTP.",
    };
  }
}

/** Verifie la connexion SMTP sans envoyer de message. */
export async function verifySmtp(organizationId: string): Promise<{ ok: boolean; message: string }> {
  const smtp = resolveSmtp(organizationId);
  if (!smtp) {
    return { ok: false, message: "Aucune configuration d'envoi active." };
  }
  try {
    await getTransporter(smtp).verify();
    return { ok: true, message: `Connexion etablie avec ${smtp.host}:${smtp.port}.` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message.slice(0, 200) : 'Connexion impossible.',
    };
  }
}
