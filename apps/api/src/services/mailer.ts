import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailDeliveryResult } from '@nova/shared';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { resolveMailer, type ResolvedMailer } from './emailConfig.js';
import { sendViaHttpProvider, type HttpEmailProvider } from '../providers/email/httpProviders.js';
import type { RenderedEmail } from './emailTemplates.js';

/**
 * Service d'envoi d'e-mails.
 * ---------------------------------------------------------------------------
 * Trois modes, choisis automatiquement selon la configuration :
 *  - relais SMTP        : connexion a un serveur de messagerie ;
 *  - fournisseur HTTP   : une cle API suffit, aucun relais a heberger ;
 *  - aucun service      : le message est journalise cote serveur et l'appelant
 *                         recoit `delivered: false` avec la raison. Les
 *                         parcours concernes restent fonctionnels : le lien est
 *                         alors transmis a la main.
 *
 * Un echec d'envoi ne doit JAMAIS faire echouer l'operation metier : une
 * invitation reste valable meme si l'e-mail n'est pas parti.
 */

/** Les transporteurs sont mis en cache par configuration pour reutiliser la connexion. */
const transporters = new Map<string, Transporter>();

function cacheKey(smtp: ResolvedMailer): string {
  return [smtp.host, smtp.port, smtp.secure, smtp.username, smtp.fromEmail].join('|');
}

function getTransporter(smtp: ResolvedMailer): Transporter {
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

  const mailer = resolveMailer(options.organizationId);
  if (!mailer) {
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

  // Fournisseur par API HTTP : aucun relais requis.
  if (mailer.provider !== 'smtp') {
    const result = await sendViaHttpProvider({
      provider: mailer.provider as HttpEmailProvider,
      apiKey: mailer.apiKey,
      fromName: mailer.fromName,
      fromEmail: mailer.fromEmail,
      replyTo: mailer.replyTo,
      to,
      message: options.message,
      endpointOverride: env.emailApiEndpointOverride || undefined,
    });
    if (!result.ok) {
      logger.error("Echec d'envoi d'e-mail", { kind: options.kind, to, detail: result.message });
    }
    return { delivered: result.ok, reason: result.ok ? null : result.message };
  }

  try {
    const info = await getTransporter(mailer).sendMail({
      from: mailer.fromName ? { name: mailer.fromName, address: mailer.fromEmail } : mailer.fromEmail,
      replyTo: mailer.replyTo || undefined,
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
      host: mailer.host,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      delivered: false,
      reason: "L'e-mail n'a pas pu etre envoye. Verifiez la configuration.",
    };
  }
}

/**
 * Verifie la configuration d'envoi.
 * En SMTP, la connexion est testee sans envoyer de message. Pour un
 * fournisseur HTTP, seule la presence d'une cle est verifiable sans consommer
 * de quota : la validation reelle se fait via l'envoi d'un message de test.
 */
export async function verifyMailer(organizationId: string): Promise<{ ok: boolean; message: string }> {
  const mailer = resolveMailer(organizationId);
  if (!mailer) {
    return { ok: false, message: "Aucune configuration d'envoi active." };
  }

  if (mailer.provider !== 'smtp') {
    if (!mailer.apiKey) return { ok: false, message: 'Aucune cle API enregistree.' };
    if (!mailer.fromEmail) return { ok: false, message: "Adresse d'expedition manquante." };
    return {
      ok: true,
      message: "Cle API enregistree. Envoyez un message de test pour valider l'expedition.",
    };
  }

  try {
    await getTransporter(mailer).verify();
    return { ok: true, message: `Connexion etablie avec ${mailer.host}:${mailer.port}.` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message.slice(0, 200) : 'Connexion impossible.',
    };
  }
}
