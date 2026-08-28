import { SMTPServer } from 'smtp-server';
import type { AddressInfo } from 'node:net';

/**
 * Serveur SMTP de test : accepte les messages et les conserve en memoire.
 * Permet de verifier le contenu reellement envoye (destinataire, sujet, lien)
 * sans dependre d'un service externe.
 */
export interface CapturedEmail {
  from: string;
  to: string[];
  raw: string;
  subject: string;
}

export interface MockSmtp {
  port: number;
  messages: CapturedEmail[];
  /** Fait echouer les prochains envois (test du chemin d'erreur). */
  rejectAll: boolean;
  close: () => Promise<void>;
}

function headerValue(raw: string, name: string): string {
  // Les en-tetes longs sont replies sur plusieurs lignes (RFC 5322).
  const match = new RegExp(`^${name}:\\s*(.*(?:\\r?\\n[ \\t].*)*)`, 'im').exec(raw);
  if (!match) return '';
  const folded = match[1].replace(/\r?\n[ \t]+/g, ' ').trim();
  // Sujet encode en base64 (=?UTF-8?B?...?=) pour les caracteres non ASCII.
  return folded.replace(/=\?[^?]+\?B\?([^?]+)\?=/gi, (_, b64: string) =>
    Buffer.from(b64, 'base64').toString('utf8'),
  );
}

export async function startMockSmtp(): Promise<MockSmtp> {
  const messages: CapturedEmail[] = [];
  const state = { rejectAll: false };

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    // Accepte toute authentification : le test porte sur le contenu envoye,
    // pas sur la politique d'authentification du serveur de messagerie.
    onAuth(auth, _session, callback) {
      callback(null, { user: auth.username ?? 'test' });
    },
    onData(stream, session, callback) {
      if (state.rejectAll) {
        stream.resume();
        stream.on('end', () => callback(new Error('451 Rejet simule pour les tests')));
        return;
      }
      let raw = '';
      stream.on('data', (chunk) => { raw += chunk; });
      stream.on('end', () => {
        messages.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          raw,
          subject: headerValue(raw, 'Subject'),
        });
        callback();
      });
    },
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // SMTPServer encapsule le serveur net : l'adresse se lit sur `server.server`.
  const port = ((server as unknown as { server: { address: () => AddressInfo } })
    .server.address()).port;

  return {
    port,
    messages,
    get rejectAll() { return state.rejectAll; },
    set rejectAll(value: boolean) { state.rejectAll = value; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  } as MockSmtp;
}

/**
 * Extrait un lien de l'application depuis le corps du message.
 * Le corps est encode en quoted-printable : les coupures de ligne « soft »
 * (`=` en fin de ligne) sont recollees avant recherche.
 */
export function extractLink(raw: string, path: string): string | null {
  const decoded = raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  const match = new RegExp(`https?://[^\\s"'<>]*${path}[^\\s"'<>]*`).exec(decoded);
  return match ? match[0] : null;
}
