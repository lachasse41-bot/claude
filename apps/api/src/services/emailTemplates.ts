/**
 * Modeles de messages.
 * ---------------------------------------------------------------------------
 * Chaque message est produit en texte brut ET en HTML : certains clients de
 * messagerie bloquent le HTML, et un e-mail transactionnel doit rester lisible
 * dans les deux cas. Le HTML reste volontairement simple (styles en ligne,
 * aucune image distante) pour traverser les filtres.
 */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(options: {
  title: string;
  intro: string;
  ctaLabel?: string;
  ctaUrl?: string;
  outro?: string;
  footnote?: string;
}): string {
  const { title, intro, ctaLabel, ctaUrl, outro, footnote } = options;
  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#131722;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e6ef;border-radius:12px;">
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0 0 18px;font-size:15px;font-weight:600;color:#4f46e5;">Nova Studio</p>
      <h1 style="margin:0 0 12px;font-size:19px;line-height:1.35;">${escapeHtml(title)}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#555f74;">${escapeHtml(intro)}</p>
      ${
        ctaUrl && ctaLabel
          ? `<p style="margin:0 0 20px;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px;font-weight:500;">${escapeHtml(ctaLabel)}</a></p>
      <p style="margin:0 0 20px;font-size:12px;line-height:1.6;color:#8b94a7;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><span style="word-break:break-all;color:#555f74;">${escapeHtml(ctaUrl)}</span></p>`
          : ''
      }
      ${outro ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#555f74;">${escapeHtml(outro)}</p>` : ''}
    </td></tr>
    ${
      footnote
        ? `<tr><td style="padding:0 28px 24px;"><p style="margin:0;padding-top:16px;border-top:1px solid #e2e6ef;font-size:12px;line-height:1.6;color:#8b94a7;">${escapeHtml(footnote)}</p></td></tr>`
        : ''
    }
  </table>
</body></html>`;
}

function textBlock(lines: Array<string | undefined>): string {
  return lines.filter(Boolean).join('\n\n');
}

export function invitationEmail(input: {
  organizationName: string;
  inviterName: string;
  inviteUrl: string;
  role: 'admin' | 'collaborator';
  expiresAt: string;
  credits: number;
}): RenderedEmail {
  const roleLabel = input.role === 'admin' ? 'administrateur' : 'collaborateur';
  const expires = new Date(input.expiresAt).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const intro =
    `${input.inviterName} vous invite a rejoindre l'espace ${input.organizationName} ` +
    `en tant que ${roleLabel}. Creez votre compte pour commencer a generer des contenus.`;
  const footnote =
    `Ce lien est personnel, utilisable une seule fois et expire le ${expires}. ` +
    `Si vous n'attendiez pas cette invitation, ignorez ce message.`;

  return {
    subject: `Rejoignez ${input.organizationName} sur Nova Studio`,
    text: textBlock([
      intro,
      `Creer mon compte : ${input.inviteUrl}`,
      `Votre espace demarre avec ${input.credits} credits de generation.`,
      footnote,
    ]),
    html: layout({
      title: `Rejoignez ${input.organizationName}`,
      intro,
      ctaLabel: 'Creer mon compte',
      ctaUrl: input.inviteUrl,
      outro: `Votre espace demarre avec ${input.credits} credits de generation.`,
      footnote,
    }),
  };
}

export function passwordResetEmail(input: {
  name: string;
  resetUrl: string;
  expiresAt: string;
}): RenderedEmail {
  const intro =
    `Bonjour ${input.name}, vous avez demande la reinitialisation de votre mot de passe Nova Studio.`;
  const footnote =
    "Ce lien expire dans une heure et ne peut servir qu'une fois. " +
    "Si vous n'etes pas a l'origine de cette demande, ignorez ce message : votre mot de passe reste inchange.";

  return {
    subject: 'Reinitialisation de votre mot de passe Nova Studio',
    text: textBlock([intro, `Definir un nouveau mot de passe : ${input.resetUrl}`, footnote]),
    html: layout({
      title: 'Reinitialisation de mot de passe',
      intro,
      ctaLabel: 'Definir un nouveau mot de passe',
      ctaUrl: input.resetUrl,
      footnote,
    }),
  };
}

export function accountCreatedEmail(input: {
  name: string;
  organizationName: string;
  loginUrl: string;
  credits: number;
}): RenderedEmail {
  const intro =
    `Bonjour ${input.name}, un compte vous a ete cree sur l'espace ${input.organizationName}. ` +
    `Votre mot de passe provisoire vous est communique separement par votre administrateur.`;
  const footnote =
    "Par securite, aucun mot de passe n'est transmis par e-mail. " +
    'Changez le votre depuis Profil des votre premiere connexion.';

  return {
    subject: `Votre acces a ${input.organizationName}`,
    text: textBlock([
      intro,
      `Se connecter : ${input.loginUrl}`,
      `Votre espace demarre avec ${input.credits} credits de generation.`,
      footnote,
    ]),
    html: layout({
      title: 'Votre acces est pret',
      intro,
      ctaLabel: 'Se connecter',
      ctaUrl: input.loginUrl,
      outro: `Votre espace demarre avec ${input.credits} credits de generation.`,
      footnote,
    }),
  };
}

export function testEmail(input: { organizationName: string; actorName: string }): RenderedEmail {
  const intro =
    `Cet e-mail de test confirme que l'envoi depuis Nova Studio fonctionne pour ` +
    `${input.organizationName}. Demande par ${input.actorName}.`;
  return {
    subject: 'Test de configuration — Nova Studio',
    text: textBlock([intro, 'Aucune action requise.']),
    html: layout({ title: 'Configuration validee', intro, outro: 'Aucune action requise.' }),
  };
}
