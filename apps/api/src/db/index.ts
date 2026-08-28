import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

export const db = new Database(env.dbPath);

// WAL : lectures concurrentes pendant les ecritures ; foreign_keys : integrite
// referentielle reellement appliquee (desactivee par defaut dans SQLite).
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Application du schema.
 * Executee au chargement du module : les services preparent leurs requetes
 * des l'import, le schema doit donc exister avant toute autre importation.
 * Idempotente (CREATE TABLE IF NOT EXISTS).
 */
export function migrate(): void {
  const schemaPath = fs.existsSync(path.join(here, 'schema.sql'))
    ? path.join(here, 'schema.sql')
    : path.resolve(here, '../../src/db/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  logger.info('Migration de la base terminee', { path: env.dbPath });
}

/** Execute `fn` dans une transaction. better-sqlite3 est synchrone. */
migrate();

export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}

export const nowIso = (): string => new Date().toISOString();

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
