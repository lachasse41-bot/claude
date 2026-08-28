import { env } from '../../env.js';
import { logger } from '../../lib/logger.js';
import type { RenderedEmail } from '../../services/emailTemplates.js';

/**
 * Fournisseurs d'e-mail par API HTTP.
 * ---------------------------------------------------------------------------
 * Alternative au relais SMTP : une simple cle API suffit, sans serveur de
 * messagerie a heberger ni port a ouvrir. Chaque fournisseur decrit son point
 * d'entree, son en-tete d'authentification et la forme de son corps de
 * requete ; le reste de l'application ne voit aucune difference.
 *
 * Contrats implementes d'apres les API publiques des fournisseurs, verifiables
 * sans risque depuis Administration > Parametres (bouton de test).
 */

export type HttpEmailProvider = 'resend' | 'brevo';

export interface HttpProviderSpec {
  label: string;
  /** Page ou obtenir une cle API. */
  consoleUrl: string;
  endpoint: string;
  authHeader: (apiKey: string) => Record<string, string>;
  buildBody: (input: {
    fromName: string;
    fromEmail: string;
    to: string;
    replyTo: string;
    message: RenderedEmail;
  }) => Record<string, unknown>;
  /** Identifiant de message renvoye, pour la journalisation. */
  messageId: (payload: unknown) => string | null;
}

export const HTTP_PROVIDERS: Record<HttpEmailProvider, HttpProviderSpec> = {
  resend: {
    label: 'Resend',
    consoleUrl: 'https://resend.com/api-keys',
    endpoint: 'https://api.resend.com/emails',
    authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    buildBody: ({ fromName, fromEmail, to, replyTo, message }) => ({
      from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
      to: [to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
    messageId: (payload) => (payload as { id?: string } | null)?.id ?? null,
  },
  brevo: {
    label: 'Brevo',
    consoleUrl: 'https://app.brevo.com/settings/keys/api',
    endpoint: 'https://api.brevo.com/v3/smtp/email',
    authHeader: (apiKey) => ({ 'api-key': apiKey }),
    buildBody: ({ fromName, fromEmail, to, replyTo, message }) => ({
      sender: { email: fromEmail, ...(fromName ? { name: fromName } : {}) },
      to: [{ email: to }],
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    }),
    messageId: (payload) => (payload as { messageId?: string } | null)?.messageId ?? null,
  },
};

export interface HttpSendResult {
  ok: boolean;
  /** Message destine a l'administrateur, jamais a l'utilisateur final. */
  message: string;
}

/** Envoi via API HTTP, avec delai maximum et message d'erreur exploitable. */
export async function sendViaHttpProvider(input: {
  provider: HttpEmailProvider;
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  to: string;
  message: RenderedEmail;
  /** Surcharge du point d'entree (tests). */
  endpointOverride?: string;
}): Promise<HttpSendResult> {
  const spec = HTTP_PROVIDERS[input.provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.mailTimeoutMs);

  try {
    const response = await fetch(input.endpointOverride ?? spec.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...spec.authHeader(input.apiKey),
      },
      body: JSON.stringify(
        spec.buildBody({
          fromName: input.fromName,
          fromEmail: input.fromEmail,
          to: input.to,
          replyTo: input.replyTo,
          message: input.message,
        }),
      ),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      // Les fournisseurs renvoient une raison explicite (cle invalide, domaine
      // non verifie, quota atteint) : elle est utile a l'administrateur.
      const body = payload as { message?: string; error?: string } | null;
      const detail = body?.message ?? body?.error ?? text.slice(0, 200);
      return {
        ok: false,
        message: `${spec.label} a refuse l'envoi (HTTP ${response.status}) : ${detail || 'raison inconnue'}`,
      };
    }

    logger.info('E-mail envoye via API', {
      provider: input.provider,
      messageId: spec.messageId(payload),
    });
    return { ok: true, message: `Message accepte par ${spec.label}.` };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      message: aborted
        ? `${spec.label} n'a pas repondu dans le temps imparti.`
        : `${spec.label} est injoignable.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
