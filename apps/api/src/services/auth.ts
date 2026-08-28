import type { Invitation, Role } from '@nova/shared';
import { db, nowIso, tx } from '../db/index.js';
import { env } from '../env.js';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { id, randomToken, sha256 } from '../lib/ids.js';
import { getSettings } from './organizations.js';
import {
  createUser, findUserByEmail, getUserById, hashPassword, revokeAllSessions,
  toPublicUser, verifyPassword, type UserRow,
} from './users.js';

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export interface IssuedSession {
  token: string;
  expiresAt: string;
  sessionId: string;
}

/**
 * Jetons de session opaques : seul le hash SHA-256 est stocke.
 * Une fuite de la base ne permet donc pas de rejouer une session.
 */
export function createSession(userId: string, meta: { ip?: string; userAgent?: string }): IssuedSession {
  const token = randomToken(32);
  const sessionId = id('ses');
  const now = nowIso();
  const expiresAt = new Date(Date.now() + env.sessionTtlDays * 86_400_000).toISOString();
  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, sha256(token), now, now, expiresAt, meta.ip ?? null, (meta.userAgent ?? '').slice(0, 300));
  return { token, expiresAt, sessionId };
}

export interface ResolvedSession {
  user: UserRow;
  sessionId: string;
}

/** Resout un jeton de session en utilisateur actif. Renouvelle `last_seen_at`. */
export function resolveSession(token: string): ResolvedSession | null {
  if (!token) return null;
  const row = db.prepare(
    'SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL',
  ).get(sha256(token)) as
    | { id: string; user_id: string; expires_at: string; last_seen_at: string }
    | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id);
    return null;
  }
  const user = getUserById(row.user_id);
  if (!user || user.status !== 'active') return null;

  // Expiration glissante : prolongee au plus une fois par heure.
  if (Date.now() - new Date(row.last_seen_at).getTime() > 3_600_000) {
    const expiresAt = new Date(Date.now() + env.sessionTtlDays * 86_400_000).toISOString();
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(nowIso(), expiresAt, row.id);
  }
  return { user, sessionId: row.id };
}

export function revokeSession(sessionId: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(nowIso(), sessionId);
}

export function listSessions(userId: string) {
  return db.prepare(
    `SELECT id, created_at, last_seen_at, expires_at, ip, user_agent
     FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY last_seen_at DESC`,
  ).all(userId, nowIso()) as Array<{
    id: string; created_at: string; last_seen_at: string; expires_at: string;
    ip: string | null; user_agent: string | null;
  }>;
}

export function purgeExpiredSessions(): number {
  const res = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(
    new Date(Date.now() - 30 * 86_400_000).toISOString(),
  );
  return res.changes;
}

/* ------------------------------------------------------------------ */
/* Connexion                                                           */
/* ------------------------------------------------------------------ */

export function authenticate(organizationId: string, email: string, password: string): UserRow {
  const user = findUserByEmail(organizationId, email);
  // Message volontairement identique dans tous les cas d'echec pour ne pas
  // reveler l'existence d'un compte.
  const genericError = unauthorized('Adresse e-mail ou mot de passe incorrect.');
  if (!user) {
    // Cout constant : evite de distinguer un compte inexistant par le temps de reponse.
    verifyPassword(password, '$2a$12$0000000000000000000000000000000000000000000000000000');
    throw genericError;
  }
  if (!verifyPassword(password, user.password_hash)) throw genericError;
  if (user.status === 'disabled') {
    throw new AppError('permission_error', 'Ce compte a ete desactive par un administrateur.');
  }
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
  return { ...user, last_login_at: nowIso() };
}

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

interface InvitationRow {
  id: string; organization_id: string; email: string; email_lower: string; role: Role;
  initial_credits: number; token_hash: string; status: string; expires_at: string;
  created_by: string | null; created_at: string; accepted_at: string | null;
  created_by_name?: string | null;
}

function toInvitationDto(row: InvitationRow): Invitation {
  const expired = row.status === 'pending' && new Date(row.expires_at).getTime() < Date.now();
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    initialCredits: row.initial_credits,
    status: expired ? 'expired' : (row.status as Invitation['status']),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    createdByName: row.created_by_name ?? null,
  };
}

export function createInvitation(input: {
  organizationId: string;
  email: string;
  role: Role;
  initialCredits?: number;
  createdBy: string;
  ttlDays?: number;
}): Invitation {
  const emailLower = input.email.trim().toLowerCase();
  if (findUserByEmail(input.organizationId, emailLower)) {
    throw conflict('Un compte existe deja avec cette adresse e-mail.');
  }
  const pending = db.prepare(
    "SELECT id FROM invitations WHERE organization_id = ? AND email_lower = ? AND status = 'pending'",
  ).get(input.organizationId, emailLower) as { id: string } | undefined;
  if (pending) {
    db.prepare("UPDATE invitations SET status = 'revoked' WHERE id = ?").run(pending.id);
  }

  const settings = getSettings(input.organizationId);
  const token = randomToken(24);
  const invitationId = id('inv');
  const expiresAt = new Date(Date.now() + (input.ttlDays ?? 14) * 86_400_000).toISOString();

  db.prepare(`
    INSERT INTO invitations (id, organization_id, email, email_lower, role, initial_credits,
                             token_hash, status, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    invitationId, input.organizationId, input.email.trim(), emailLower, input.role,
    input.initialCredits ?? settings.defaultCollaboratorCredits,
    sha256(token), expiresAt, input.createdBy, nowIso(),
  );

  const row = db.prepare('SELECT * FROM invitations WHERE id = ?').get(invitationId) as InvitationRow;
  return {
    ...toInvitationDto(row),
    // Le jeton en clair n'est renvoye qu'une seule fois, a la creation.
    inviteUrl: `${env.webOrigins[0] ?? env.publicBaseUrl}/register?token=${token}`,
  };
}

export function listInvitations(organizationId: string): Invitation[] {
  const rows = db.prepare(`
    SELECT i.*, u.name AS created_by_name FROM invitations i
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.organization_id = ? ORDER BY i.created_at DESC
  `).all(organizationId) as InvitationRow[];
  return rows.map(toInvitationDto);
}

export function revokeInvitation(organizationId: string, invitationId: string): Invitation {
  const row = db.prepare('SELECT * FROM invitations WHERE id = ? AND organization_id = ?')
    .get(invitationId, organizationId) as InvitationRow | undefined;
  if (!row) throw notFound('Invitation introuvable.');
  if (row.status !== 'pending') throw conflict('Cette invitation ne peut plus etre revoquee.');
  db.prepare("UPDATE invitations SET status = 'revoked' WHERE id = ?").run(invitationId);
  return toInvitationDto({ ...row, status: 'revoked' });
}

export interface InvitationPreview {
  email: string;
  role: Role;
  organizationName: string;
  expiresAt: string;
}

function loadPendingInvitation(token: string): InvitationRow {
  const row = db.prepare("SELECT * FROM invitations WHERE token_hash = ? AND status = 'pending'")
    .get(sha256(token)) as InvitationRow | undefined;
  if (!row) throw badRequest("Cette invitation est invalide ou a deja ete utilisee.");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw badRequest('Cette invitation a expire. Demandez-en une nouvelle a votre administrateur.');
  }
  return row;
}

/** Verifie un jeton d'invitation avant l'affichage du formulaire d'inscription. */
export function previewInvitation(token: string): InvitationPreview {
  const row = loadPendingInvitation(token);
  const org = db.prepare('SELECT name FROM organizations WHERE id = ?').get(row.organization_id) as
    | { name: string }
    | undefined;
  return {
    email: row.email,
    role: row.role,
    organizationName: org?.name ?? '',
    expiresAt: row.expires_at,
  };
}

/** Cree le compte du collaborateur a partir d'une invitation valide. */
export function acceptInvitation(input: { token: string; name: string; password: string }) {
  const row = loadPendingInvitation(input.token);
  const settings = getSettings(row.organization_id);
  if (!settings.invitationsEnabled) {
    throw new AppError('permission_error', "Les inscriptions sont actuellement fermees par l'administrateur.");
  }
  return tx(() => {
    const user = createUser({
      organizationId: row.organization_id,
      email: row.email,
      name: input.name,
      password: input.password,
      role: row.role,
      initialCredits: row.initial_credits,
      actorUserId: row.created_by,
    });
    db.prepare("UPDATE invitations SET status = 'accepted', accepted_at = ? WHERE id = ?")
      .run(nowIso(), row.id);
    return user;
  });
}

/* ------------------------------------------------------------------ */
/* Reinitialisation de mot de passe                                    */
/* ------------------------------------------------------------------ */

export interface ResetTicket {
  token: string;
  expiresAt: string;
  email: string;
}

/**
 * Cree un ticket de reinitialisation.
 * Aucun service d'envoi d'e-mail n'est configure dans cet environnement :
 * le lien est retourne au serveur et journalise. POINT DE BRANCHEMENT :
 * remplacer `deliverResetLink` par l'appel au fournisseur d'e-mails.
 */
export function createPasswordReset(email: string): ResetTicket | null {
  const user = db.prepare('SELECT * FROM users WHERE email_lower = ?')
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!user || user.status !== 'active') return null;

  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  db.prepare(`
    INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id('pwr'), user.id, sha256(token), expiresAt, nowIso());

  return { token, expiresAt, email: user.email };
}

export function consumePasswordReset(token: string, newPassword: string): UserRow {
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL')
    .get(sha256(token)) as
    | { id: string; user_id: string; expires_at: string }
    | undefined;
  if (!row) throw badRequest('Ce lien de reinitialisation est invalide ou a deja ete utilise.');
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw badRequest('Ce lien de reinitialisation a expire.');
  }
  const user = getUserById(row.user_id);
  if (!user) throw notFound('Utilisateur introuvable.');

  return tx(() => {
    db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashPassword(newPassword), nowIso(), user.id);
    // Toute session existante est invalidee apres un changement de mot de passe.
    revokeAllSessions(user.id);
    return getUserById(user.id)!;
  });
}

export { toPublicUser };
