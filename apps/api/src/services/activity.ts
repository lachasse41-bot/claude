import type { ActivityLog } from '@nova/shared';
import { db, nowIso, parseJson } from '../db/index.js';
import { id } from '../lib/ids.js';

export interface ActivityInput {
  organizationId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  targetUserId?: string | null;
  targetName?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

const insertStmt = db.prepare(`
  INSERT INTO activity_logs (
    id, organization_id, actor_user_id, actor_name, actor_email,
    target_user_id, target_name, action, entity_type, entity_id,
    metadata_json, ip, created_at
  ) VALUES (
    @id, @organizationId, @actorUserId, @actorName, @actorEmail,
    @targetUserId, @targetName, @action, @entityType, @entityId,
    @metadata, @ip, @createdAt
  )
`);

/** Journalise une action sensible. Ne doit jamais faire echouer l'action metier. */
export function logActivity(input: ActivityInput): void {
  try {
    insertStmt.run({
      id: id('act'),
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      actorName: input.actorName ?? null,
      actorEmail: input.actorEmail ?? null,
      targetUserId: input.targetUserId ?? null,
      targetName: input.targetName ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
      ip: input.ip ?? null,
      createdAt: nowIso(),
    });
  } catch {
    // La journalisation ne bloque jamais l'operation metier.
  }
}

interface ActivityRow {
  id: string; actor_user_id: string | null; actor_name: string | null; actor_email: string | null;
  target_user_id: string | null; target_name: string | null; action: string;
  entity_type: string | null; entity_id: string | null; metadata_json: string;
  ip: string | null; created_at: string;
}

function toDto(row: ActivityRow): ActivityLog {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    targetUserId: row.target_user_id,
    targetName: row.target_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    ip: row.ip,
    createdAt: row.created_at,
  };
}

export function listActivity(opts: {
  organizationId: string;
  actorUserId?: string;
  action?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const where: string[] = ['organization_id = @organizationId'];
  const params: Record<string, unknown> = { organizationId: opts.organizationId };

  if (opts.actorUserId) { where.push('actor_user_id = @actorUserId'); params.actorUserId = opts.actorUserId; }
  if (opts.action) { where.push('action = @action'); params.action = opts.action; }
  if (opts.from) { where.push('created_at >= @from'); params.from = opts.from; }
  if (opts.to) { where.push('created_at <= @to'); params.to = opts.to; }
  if (opts.search) {
    where.push('(action LIKE @search OR actor_name LIKE @search OR actor_email LIKE @search OR target_name LIKE @search)');
    params.search = `%${opts.search}%`;
  }

  const clause = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM activity_logs WHERE ${clause}`).get(params) as { c: number };
  const rows = db.prepare(
    `SELECT * FROM activity_logs WHERE ${clause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
  ).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as ActivityRow[];

  return {
    items: rows.map(toDto),
    total: total.c,
    page,
    pageSize,
    hasMore: page * pageSize < total.c,
  };
}

export function recentActivity(organizationId: string, limit = 12): ActivityLog[] {
  const rows = db.prepare(
    'SELECT * FROM activity_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(organizationId, limit) as ActivityRow[];
  return rows.map(toDto);
}
