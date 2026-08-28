import type { AdminOverview, CollaboratorOverview, ModelKind, Role, UserStatus } from '@nova/shared';
import { db } from '../db/index.js';
import { getBalance } from './credits.js';
import { listGenerations } from './generations.js';
import { recentActivity } from './activity.js';

function dateRange(days: number): { from: string; labels: string[] } {
  const labels: string[] = [];
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    labels.push(d.toISOString().slice(0, 10));
  }
  return { from: start.toISOString(), labels };
}

interface TimelineRow { date: string; generations: number; credits: number }

function buildTimeline(organizationId: string, userId: string | null, days: number): TimelineRow[] {
  const { from, labels } = dateRange(days);
  const rows = db.prepare(`
    SELECT substr(created_at, 1, 10) AS date,
           COUNT(*) AS generations,
           COALESCE(SUM(credit_cost - credits_refunded), 0) AS credits
    FROM generations
    WHERE organization_id = @organizationId AND created_at >= @from
      ${userId ? 'AND user_id = @userId' : ''}
    GROUP BY date
  `).all(userId ? { organizationId, from, userId } : { organizationId, from }) as TimelineRow[];

  const byDate = new Map(rows.map((r) => [r.date, r]));
  return labels.map((date) => byDate.get(date) ?? { date, generations: 0, credits: 0 });
}

function usageByModel(organizationId: string, userId: string | null) {
  return db.prepare(`
    SELECT g.model_key AS modelKey, g.model_name AS modelName, g.kind AS kind,
           COUNT(*) AS generations,
           COALESCE(SUM(g.credit_cost - g.credits_refunded), 0) AS credits
    FROM generations g
    WHERE g.organization_id = @organizationId ${userId ? 'AND g.user_id = @userId' : ''}
    GROUP BY g.model_key, g.model_name, g.kind
    ORDER BY generations DESC
  `).all(userId ? { organizationId, userId } : { organizationId }) as Array<{
    modelKey: string; modelName: string; kind: ModelKind; generations: number; credits: number;
  }>;
}

/** Vue de supervision de l'administrateur (toute l'organisation). */
export function adminOverview(organizationId: string, days = 30): AdminOverview {
  const count = (sql: string, params: unknown[] = []) =>
    (db.prepare(sql).get(organizationId, ...params) as { c: number }).c;

  const totals = {
    collaborators: count("SELECT COUNT(*) AS c FROM users WHERE organization_id = ?"),
    activeCollaborators: count("SELECT COUNT(*) AS c FROM users WHERE organization_id = ? AND status = 'active'"),
    disabledCollaborators: count("SELECT COUNT(*) AS c FROM users WHERE organization_id = ? AND status = 'disabled'"),
    pendingInvitations: count("SELECT COUNT(*) AS c FROM invitations WHERE organization_id = ? AND status = 'pending'"),
    generations: count('SELECT COUNT(*) AS c FROM generations WHERE organization_id = ?'),
    generationsCompleted: count("SELECT COUNT(*) AS c FROM generations WHERE organization_id = ? AND state = 'completed'"),
    generationsFailed: count("SELECT COUNT(*) AS c FROM generations WHERE organization_id = ? AND state = 'failed'"),
    creditsSpent: (db.prepare(
      "SELECT COALESCE(SUM(-amount), 0) AS c FROM credit_transactions WHERE organization_id = ? AND type = 'debit'",
    ).get(organizationId) as { c: number }).c
      - (db.prepare(
        "SELECT COALESCE(SUM(amount), 0) AS c FROM credit_transactions WHERE organization_id = ? AND type = 'refund'",
      ).get(organizationId) as { c: number }).c,
    creditsGranted: (db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS c FROM credit_transactions WHERE organization_id = ? AND type IN ('grant','adjustment')",
    ).get(organizationId) as { c: number }).c,
    creditsAvailable: (db.prepare(
      'SELECT COALESCE(SUM(balance), 0) AS c FROM credit_balances WHERE organization_id = ?',
    ).get(organizationId) as { c: number }).c,
  };

  const byUser = db.prepare(`
    SELECT u.id AS userId, u.name, u.email, u.role, u.status,
           COALESCE(b.balance, 0) AS balance,
           (SELECT COUNT(*) FROM generations g WHERE g.user_id = u.id) AS generations,
           (SELECT COALESCE(SUM(g.credit_cost - g.credits_refunded), 0) FROM generations g WHERE g.user_id = u.id) AS credits,
           (SELECT MAX(g.created_at) FROM generations g WHERE g.user_id = u.id) AS lastActiveAt
    FROM users u LEFT JOIN credit_balances b ON b.user_id = u.id
    WHERE u.organization_id = ?
    ORDER BY credits DESC
  `).all(organizationId) as AdminOverview['byUser'];

  return {
    totals,
    byModel: usageByModel(organizationId, null),
    byUser,
    timeline: buildTimeline(organizationId, null, days),
    recentActivity: recentActivity(organizationId, 12),
  };
}

/** Vue du tableau de bord d'un collaborateur (ses donnees uniquement). */
export function collaboratorOverview(organizationId: string, userId: string, days = 30): CollaboratorOverview {
  const count = (sql: string) =>
    (db.prepare(sql).get(organizationId, userId) as { c: number }).c;

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const spent30d = db.prepare(`
    SELECT COALESCE(SUM(-amount), 0) AS c FROM credit_transactions
    WHERE organization_id = ? AND user_id = ? AND type = 'debit' AND created_at >= ?
  `).get(organizationId, userId, since) as { c: number };

  return {
    credits: getBalance(userId),
    totals: {
      generations: count('SELECT COUNT(*) AS c FROM generations WHERE organization_id = ? AND user_id = ?'),
      completed: count("SELECT COUNT(*) AS c FROM generations WHERE organization_id = ? AND user_id = ? AND state = 'completed'"),
      failed: count("SELECT COUNT(*) AS c FROM generations WHERE organization_id = ? AND user_id = ? AND state = 'failed'"),
      running: count("SELECT COUNT(*) AS c FROM generations WHERE organization_id = ? AND user_id = ? AND state IN ('queued','processing')"),
      galleryItems: count('SELECT COUNT(*) AS c FROM gallery_items WHERE organization_id = ? AND user_id = ?'),
      workflows: count('SELECT COUNT(*) AS c FROM workflows WHERE organization_id = ? AND user_id = ?'),
      creditsSpent30d: spent30d.c,
    },
    byModel: usageByModel(organizationId, userId),
    timeline: buildTimeline(organizationId, userId, days),
    recentGenerations: listGenerations({ organizationId, userId, pageSize: 6 }).items,
  };
}

export type { Role, UserStatus };
