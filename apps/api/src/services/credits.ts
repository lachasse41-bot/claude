import type { CreditSummary, CreditTransaction, CreditTransactionType } from '@nova/shared';
import { db, nowIso, tx } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { id } from '../lib/ids.js';

interface BalanceRow {
  user_id: string;
  organization_id: string;
  balance: number;
  total_granted: number;
  total_spent: number;
  allow_overdraft: number;
  updated_at: string;
}

const selectBalance = db.prepare('SELECT * FROM credit_balances WHERE user_id = ?');
const insertBalance = db.prepare(`
  INSERT INTO credit_balances (user_id, organization_id, balance, total_granted, total_spent, allow_overdraft, updated_at)
  VALUES (?, ?, 0, 0, 0, ?, ?)
`);
const insertTx = db.prepare(`
  INSERT INTO credit_transactions (
    id, organization_id, user_id, type, amount, balance_after,
    generation_id, model_key, reason, actor_user_id, created_at
  ) VALUES (
    @id, @organizationId, @userId, @type, @amount, @balanceAfter,
    @generationId, @modelKey, @reason, @actorUserId, @createdAt
  )
`);

export function ensureBalance(userId: string, organizationId: string, allowOverdraft = false): CreditSummary {
  const existing = selectBalance.get(userId) as BalanceRow | undefined;
  if (existing) return toSummary(existing);
  insertBalance.run(userId, organizationId, allowOverdraft ? 1 : 0, nowIso());
  return { balance: 0, totalGranted: 0, totalSpent: 0, allowOverdraft };
}

function toSummary(row: BalanceRow): CreditSummary {
  return {
    balance: row.balance,
    totalGranted: row.total_granted,
    totalSpent: row.total_spent,
    allowOverdraft: row.allow_overdraft === 1,
  };
}

export function getBalance(userId: string): CreditSummary {
  const row = selectBalance.get(userId) as BalanceRow | undefined;
  if (!row) return { balance: 0, totalGranted: 0, totalSpent: 0, allowOverdraft: false };
  return toSummary(row);
}

export interface LedgerEntry {
  organizationId: string;
  userId: string;
  type: CreditTransactionType;
  /** Montant positif ; le signe est deduit du type. */
  amount: number;
  reason: string;
  generationId?: string | null;
  modelKey?: string | null;
  actorUserId?: string | null;
}

/**
 * Ecriture atomique au grand livre des credits.
 * Toute variation de solde passe obligatoirement par cette fonction : le solde
 * et l'historique restent ainsi toujours coherents.
 */
export function applyLedgerEntry(entry: LedgerEntry): CreditSummary {
  if (!Number.isInteger(entry.amount) || entry.amount < 0) {
    throw new AppError('internal_error', 'Montant de credits invalide.');
  }

  return tx(() => {
    const row = selectBalance.get(entry.userId) as BalanceRow | undefined;
    if (!row) throw new AppError('not_found', 'Solde de credits introuvable.');

    const signed = entry.type === 'debit' ? -entry.amount : entry.amount;
    const nextBalance = row.balance + signed;

    if (entry.type === 'debit' && nextBalance < 0 && row.allow_overdraft !== 1) {
      throw new AppError(
        'insufficient_credits',
        `Credits insuffisants : ${entry.amount} credits requis, ${row.balance} disponibles.`,
      );
    }

    const totalGranted = row.total_granted + (entry.type === 'grant' ? entry.amount : 0);
    const totalSpent =
      row.total_spent +
      (entry.type === 'debit' ? entry.amount : 0) -
      (entry.type === 'refund' ? entry.amount : 0);

    db.prepare(
      `UPDATE credit_balances
       SET balance = ?, total_granted = ?, total_spent = ?, updated_at = ?
       WHERE user_id = ?`,
    ).run(nextBalance, totalGranted, Math.max(0, totalSpent), nowIso(), entry.userId);

    insertTx.run({
      id: id('ctx'),
      organizationId: entry.organizationId,
      userId: entry.userId,
      type: entry.type,
      amount: signed,
      balanceAfter: nextBalance,
      generationId: entry.generationId ?? null,
      modelKey: entry.modelKey ?? null,
      reason: entry.reason,
      actorUserId: entry.actorUserId ?? null,
      createdAt: nowIso(),
    });

    return {
      balance: nextBalance,
      totalGranted,
      totalSpent: Math.max(0, totalSpent),
      allowOverdraft: row.allow_overdraft === 1,
    };
  });
}

/** Verifie qu'un debit est possible sans l'appliquer (verification prealable). */
export function assertCanSpend(userId: string, amount: number): void {
  const row = selectBalance.get(userId) as BalanceRow | undefined;
  if (!row) throw new AppError('not_found', 'Solde de credits introuvable.');
  if (row.allow_overdraft === 1) return;
  if (row.balance < amount) {
    throw new AppError(
      'insufficient_credits',
      `Credits insuffisants : ${amount} credits requis, ${row.balance} disponibles.`,
    );
  }
}

export function setOverdraft(userId: string, allow: boolean): void {
  db.prepare('UPDATE credit_balances SET allow_overdraft = ?, updated_at = ? WHERE user_id = ?')
    .run(allow ? 1 : 0, nowIso(), userId);
}

interface TxRow {
  id: string; user_id: string; type: CreditTransactionType; amount: number; balance_after: number;
  generation_id: string | null; model_key: string | null; reason: string;
  actor_user_id: string | null; created_at: string; user_name?: string;
}

export function listTransactions(opts: {
  organizationId: string;
  userId?: string;
  type?: CreditTransactionType;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const where = ['t.organization_id = @organizationId'];
  const params: Record<string, unknown> = { organizationId: opts.organizationId };
  if (opts.userId) { where.push('t.user_id = @userId'); params.userId = opts.userId; }
  if (opts.type) { where.push('t.type = @type'); params.type = opts.type; }
  if (opts.from) { where.push('t.created_at >= @from'); params.from = opts.from; }
  if (opts.to) { where.push('t.created_at <= @to'); params.to = opts.to; }
  const clause = where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) AS c FROM credit_transactions t WHERE ${clause}`).get(params) as { c: number };
  const rows = db.prepare(
    `SELECT t.*, u.name AS user_name FROM credit_transactions t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE ${clause} ORDER BY t.created_at DESC LIMIT @limit OFFSET @offset`,
  ).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as TxRow[];

  const items: CreditTransaction[] = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userName: r.user_name ?? undefined,
    type: r.type,
    amount: r.amount,
    balanceAfter: r.balance_after,
    generationId: r.generation_id,
    modelKey: r.model_key,
    reason: r.reason,
    actorUserId: r.actor_user_id,
    createdAt: r.created_at,
  }));

  return { items, total: total.c, page, pageSize, hasMore: page * pageSize < total.c };
}

/** Somme des credits consommes par utilisateur sur une periode. */
export function spendByUser(organizationId: string, from?: string, to?: string) {
  const where = ["t.organization_id = @organizationId", "t.type = 'debit'"];
  const params: Record<string, unknown> = { organizationId };
  if (from) { where.push('t.created_at >= @from'); params.from = from; }
  if (to) { where.push('t.created_at <= @to'); params.to = to; }
  return db.prepare(
    `SELECT t.user_id AS userId, SUM(-t.amount) AS credits, COUNT(*) AS operations
     FROM credit_transactions t WHERE ${where.join(' AND ')} GROUP BY t.user_id`,
  ).all(params) as Array<{ userId: string; credits: number; operations: number }>;
}
