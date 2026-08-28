import bcrypt from 'bcryptjs';
import type { PublicUser, Role, UserStatus } from '@nova/shared';
import { db, nowIso, tx } from '../db/index.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { id } from '../lib/ids.js';
import { ensureBalance, applyLedgerEntry, getBalance } from './credits.js';
import { getSettings } from './organizations.js';

const BCRYPT_ROUNDS = 12;

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6',
  '#0ea5e9', '#22c55e', '#eab308', '#ef4444', '#06b6d4',
];

export interface UserRow {
  id: string; organization_id: string; email: string; email_lower: string;
  password_hash: string; name: string; role: Role; status: UserStatus;
  avatar_color: string; created_at: string; updated_at: string; last_login_at: string | null;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

export function findUserByEmail(organizationId: string, email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE organization_id = ? AND email_lower = ?')
    .get(organizationId, email.trim().toLowerCase()) as UserRow | undefined;
}

/** Recherche globale par e-mail (mono-organisation en pratique). */
export function findUserByEmailGlobal(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email_lower = ? ORDER BY created_at ASC LIMIT 1')
    .get(email.trim().toLowerCase()) as UserRow | undefined;
}

export function getUserById(userId: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
}

export function requireUser(organizationId: string, userId: string): UserRow {
  const row = db.prepare('SELECT * FROM users WHERE id = ? AND organization_id = ?')
    .get(userId, organizationId) as UserRow | undefined;
  if (!row) throw notFound('Utilisateur introuvable.');
  return row;
}

export interface CreateUserInput {
  organizationId: string;
  email: string;
  name: string;
  password: string;
  role: Role;
  initialCredits?: number;
  status?: UserStatus;
  actorUserId?: string | null;
}

export function createUser(input: CreateUserInput): PublicUser {
  const emailLower = input.email.trim().toLowerCase();
  if (findUserByEmail(input.organizationId, emailLower)) {
    throw conflict('Un compte existe deja avec cette adresse e-mail.');
  }
  const settings = getSettings(input.organizationId);
  const credits = input.initialCredits ?? settings.defaultCollaboratorCredits;

  return tx(() => {
    const userId = id('usr');
    const now = nowIso();
    db.prepare(`
      INSERT INTO users (id, organization_id, email, email_lower, password_hash, name, role,
                         status, avatar_color, created_at, updated_at)
      VALUES (@id, @organizationId, @email, @emailLower, @passwordHash, @name, @role,
              @status, @avatarColor, @now, @now)
    `).run({
      id: userId,
      organizationId: input.organizationId,
      email: input.email.trim(),
      emailLower,
      passwordHash: hashPassword(input.password),
      name: input.name.trim(),
      role: input.role,
      status: input.status ?? 'active',
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      now,
    });

    ensureBalance(userId, input.organizationId, settings.allowOverdraftByDefault);
    if (credits > 0) {
      applyLedgerEntry({
        organizationId: input.organizationId,
        userId,
        type: 'grant',
        amount: credits,
        reason: 'Dotation initiale',
        actorUserId: input.actorUserId ?? null,
      });
    }

    return toPublicUser(getUserById(userId)!);
  });
}

export function updateUserProfile(
  userId: string,
  patch: { name?: string; avatarColor?: string },
): PublicUser {
  const row = getUserById(userId);
  if (!row) throw notFound('Utilisateur introuvable.');
  db.prepare('UPDATE users SET name = ?, avatar_color = ?, updated_at = ? WHERE id = ?').run(
    patch.name?.trim() || row.name,
    patch.avatarColor || row.avatar_color,
    nowIso(),
    userId,
  );
  return toPublicUser(getUserById(userId)!);
}

export function changePassword(userId: string, newPassword: string): void {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(newPassword), nowIso(), userId);
}

export function setUserStatus(organizationId: string, userId: string, status: UserStatus): PublicUser {
  const row = requireUser(organizationId, userId);
  if (row.role === 'admin' && status === 'disabled' && countActiveAdmins(organizationId) <= 1) {
    throw new AppError('conflict', "Impossible de desactiver le dernier administrateur de l'organisation.");
  }
  db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), userId);
  if (status === 'disabled') revokeAllSessions(userId);
  return toPublicUser(getUserById(userId)!);
}

export function setUserRole(organizationId: string, userId: string, role: Role): PublicUser {
  const row = requireUser(organizationId, userId);
  if (row.role === 'admin' && role !== 'admin' && countActiveAdmins(organizationId) <= 1) {
    throw new AppError('conflict', "Impossible de retrograder le dernier administrateur de l'organisation.");
  }
  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, nowIso(), userId);
  return toPublicUser(getUserById(userId)!);
}

export function countActiveAdmins(organizationId: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS c FROM users WHERE organization_id = ? AND role = 'admin' AND status = 'active'",
  ).get(organizationId) as { c: number };
  return row.c;
}

export function revokeAllSessions(userId: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(nowIso(), userId);
}

/**
 * Suppression definitive d'un collaborateur.
 * Les suppressions en cascade sont assurees par le schema (ON DELETE CASCADE).
 * Retourne un resume des donnees effacees pour la journalisation.
 */
export function deleteUser(organizationId: string, userId: string) {
  const row = requireUser(organizationId, userId);
  if (row.role === 'admin' && countActiveAdmins(organizationId) <= 1) {
    throw new AppError('conflict', "Impossible de supprimer le dernier administrateur de l'organisation.");
  }
  const summary = getUserFootprint(organizationId, userId);
  const filePaths = db.prepare('SELECT stored_path FROM files WHERE user_id = ?')
    .all(userId) as Array<{ stored_path: string }>;

  tx(() => {
    // Les generations/galerie/workflows/fichiers/credits sont supprimes en cascade.
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  return { user: toPublicUser(row), summary, filePaths: filePaths.map((f) => f.stored_path) };
}

export interface UserFootprint {
  generations: number;
  galleryItems: number;
  workflows: number;
  files: number;
  creditsSpent: number;
  balance: number;
}

/** Volume de donnees rattachees a un utilisateur (avertissement avant suppression). */
export function getUserFootprint(organizationId: string, userId: string): UserFootprint {
  const one = (sql: string) => (db.prepare(sql).get(organizationId, userId) as { c: number }).c;
  const spent = db.prepare(
    "SELECT COALESCE(SUM(-amount), 0) AS c FROM credit_transactions WHERE organization_id = ? AND user_id = ? AND type = 'debit'",
  ).get(organizationId, userId) as { c: number };
  return {
    generations: one('SELECT COUNT(*) AS c FROM generations WHERE organization_id = ? AND user_id = ?'),
    galleryItems: one('SELECT COUNT(*) AS c FROM gallery_items WHERE organization_id = ? AND user_id = ?'),
    workflows: one('SELECT COUNT(*) AS c FROM workflows WHERE organization_id = ? AND user_id = ?'),
    files: one('SELECT COUNT(*) AS c FROM files WHERE organization_id = ? AND user_id = ?'),
    creditsSpent: spent.c,
    balance: getBalance(userId).balance,
  };
}

export interface ListUsersOptions {
  organizationId: string;
  search?: string;
  role?: Role;
  status?: UserStatus;
  sort?: 'name' | 'created' | 'credits' | 'activity';
  page?: number;
  pageSize?: number;
}

export interface AdminUserRow extends PublicUser {
  balance: number;
  totalSpent: number;
  totalGranted: number;
  allowOverdraft: boolean;
  generations: number;
  lastGenerationAt: string | null;
}

export function listUsers(opts: ListUsersOptions) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25));
  const where = ['u.organization_id = @organizationId'];
  const params: Record<string, unknown> = { organizationId: opts.organizationId };
  if (opts.search) {
    where.push('(u.name LIKE @search OR u.email LIKE @search)');
    params.search = `%${opts.search}%`;
  }
  if (opts.role) { where.push('u.role = @role'); params.role = opts.role; }
  if (opts.status) { where.push('u.status = @status'); params.status = opts.status; }
  const clause = where.join(' AND ');

  const orderBy = {
    name: 'u.name ASC',
    created: 'u.created_at DESC',
    credits: 'b.total_spent DESC',
    activity: 'last_generation_at DESC',
  }[opts.sort ?? 'created'];

  const total = db.prepare(`SELECT COUNT(*) AS c FROM users u WHERE ${clause}`).get(params) as { c: number };

  const rows = db.prepare(`
    SELECT u.*,
           COALESCE(b.balance, 0)        AS balance,
           COALESCE(b.total_spent, 0)    AS total_spent,
           COALESCE(b.total_granted, 0)  AS total_granted,
           COALESCE(b.allow_overdraft,0) AS allow_overdraft,
           (SELECT COUNT(*) FROM generations g WHERE g.user_id = u.id)          AS generations,
           (SELECT MAX(created_at) FROM generations g WHERE g.user_id = u.id)   AS last_generation_at
    FROM users u
    LEFT JOIN credit_balances b ON b.user_id = u.id
    WHERE ${clause}
    ORDER BY ${orderBy}
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Array<
    UserRow & {
      balance: number; total_spent: number; total_granted: number; allow_overdraft: number;
      generations: number; last_generation_at: string | null;
    }
  >;

  const items: AdminUserRow[] = rows.map((r) => ({
    ...toPublicUser(r),
    balance: r.balance,
    totalSpent: r.total_spent,
    totalGranted: r.total_granted,
    allowOverdraft: r.allow_overdraft === 1,
    generations: r.generations,
    lastGenerationAt: r.last_generation_at,
  }));

  return { items, total: total.c, page, pageSize, hasMore: page * pageSize < total.c };
}
