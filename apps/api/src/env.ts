import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/** Chargement minimal d'un fichier .env (pas de dependance externe). */
function loadDotEnv(): void {
  for (const candidate of [path.join(repoRoot, '.env'), path.join(repoRoot, 'apps/api/.env')]) {
    if (!fs.existsSync(candidate)) continue;
    const content = fs.readFileSync(candidate, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
loadDotEnv();

const isProd = process.env.NODE_ENV === 'production';

function requiredSecret(name: string): string {
  const value = process.env[name];
  if (value && value.length >= 32) return value;
  if (isProd) {
    throw new Error(
      `${name} est obligatoire en production et doit faire au moins 32 caracteres. ` +
        `Generer une valeur avec: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
    );
  }
  // En developpement uniquement : secret stable derive du repertoire du projet
  // pour ne pas invalider les sessions a chaque redemarrage.
  const devFile = path.join(repoRoot, 'data', `.dev-${name.toLowerCase()}`);
  fs.mkdirSync(path.dirname(devFile), { recursive: true });
  if (fs.existsSync(devFile)) return fs.readFileSync(devFile, 'utf8').trim();
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(devFile, generated, { mode: 0o600 });
  return generated;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, 'data'));
const storageDir = path.resolve(process.env.STORAGE_DIR ?? path.join(repoRoot, 'storage'));

export const env = {
  isProd,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int('PORT', 4000),
  host: process.env.HOST ?? '0.0.0.0',

  /** Secret maitre : signature de session, chiffrement des cles API, URLs signees. */
  appSecret: requiredSecret('APP_SECRET'),

  dataDir,
  storageDir,
  dbPath: process.env.DATABASE_PATH ?? path.join(dataDir, 'nova.sqlite'),

  /**
   * URL publique de l'API. DOIT etre joignable depuis Internet pour que
   * KIE.ai puisse telecharger les fichiers de reference (URLs signees) et
   * appeler le webhook de callback. En local, utiliser un tunnel.
   */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${int('PORT', 4000)}`).replace(/\/$/, ''),

  /** Origines autorisees pour le navigateur (frontend). */
  webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),

  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'nova_session',
  sessionTtlDays: int('SESSION_TTL_DAYS', 7),
  cookieSecure: bool('COOKIE_SECURE', isProd),

  /** Cle KIE.ai par defaut (peut aussi etre saisie depuis l'espace admin). */
  kieApiKey: process.env.KIE_API_KEY ?? '',
  kieBaseUrl: (process.env.KIE_BASE_URL ?? 'https://api.kie.ai').replace(/\/$/, ''),
  kieRequestTimeoutMs: int('KIE_REQUEST_TIMEOUT_MS', 30_000),

  /**
   * Service d'envoi d'e-mails (invitations, reinitialisation de mot de passe).
   * Ces valeurs servent de repli : une configuration saisie depuis l'espace
   * Administrateur est prioritaire. Sans configuration, les liens restent
   * fonctionnels mais doivent etre transmis manuellement.
   */
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: int('SMTP_PORT', 587),
  smtpSecure: bool('SMTP_SECURE', false),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  mailFromEmail: process.env.MAIL_FROM_EMAIL ?? '',
  mailFromName: process.env.MAIL_FROM_NAME ?? 'Nova Studio',
  mailReplyTo: process.env.MAIL_REPLY_TO ?? '',
  mailTimeoutMs: int('MAIL_TIMEOUT_MS', 15_000),
  /**
   * Redirige les appels aux fournisseurs d'e-mail HTTP vers une autre URL.
   * Reserve aux tests d'integration : laisser vide en usage normal.
   */
  emailApiEndpointOverride: process.env.EMAIL_API_ENDPOINT_OVERRIDE ?? '',

  /** Intervalle de sondage des taches en cours (ms). */
  pollIntervalMs: int('POLL_INTERVAL_MS', 5_000),
  pollBatchSize: int('POLL_BATCH_SIZE', 20),
  workerEnabled: bool('WORKER_ENABLED', true),

  /** Recopie les fichiers produits chez le provider vers le stockage local. */
  mirrorOutputs: bool('MIRROR_OUTPUTS', true),

  maxUploadSizeMb: int('MAX_UPLOAD_SIZE_MB', 25),
  signedUrlTtlSeconds: int('SIGNED_URL_TTL_SECONDS', 60 * 60 * 6),

  /** Compte administrateur cree au premier demarrage. */
  bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@nova.studio',
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '',
  bootstrapAdminName: process.env.BOOTSTRAP_ADMIN_NAME ?? 'Administrateur',
  bootstrapOrgName: process.env.BOOTSTRAP_ORG_NAME ?? 'Mon organisation',

  /** Sert le frontend compile depuis l'API (deploiement mono-processus). */
  serveWeb: bool('SERVE_WEB', isProd),
  webDistPath: process.env.WEB_DIST_PATH ?? path.join(repoRoot, 'apps/web/dist'),
} as const;

fs.mkdirSync(env.dataDir, { recursive: true });
fs.mkdirSync(env.storageDir, { recursive: true });
