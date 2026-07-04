import { pool } from '../db';
import { toTicketDto, type TicketDto, type TicketRow } from '../mappers';
import * as usersRepository from '../users/users.repository';
import * as commentsRepository from '../comments/comments.repository';

// A ticket breaches its SLA if it is not resolved within `sla_hours` of being
// created. The SLA clock stops when the ticket leaves the active queue, so we
// measure against an "effective resolution time": `resolved_at` when present,
// otherwise the last-updated time for tickets already in a terminal state
// (some closed/resolved rows never had `resolved_at` set). Only genuinely open
// tickets are measured against the live clock (`now()`) — without this, a
// long-closed ticket with no `resolved_at` would keep accruing breach forever.
// A ticket with an effective resolution is `met` if it beat the deadline and
// `breached` otherwise; a still-open ticket is `breached` once the deadline has
// passed and `on_track` until then. `alias` qualifies the columns for queries
// that join another table also carrying these names (e.g. users).
function slaStatusSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  const resolvedAt = `coalesce(${p}resolved_at, case when ${p}status in ('resolved', 'closed') then ${p}updated_at end)`;
  const deadline = `${p}created_at + ${p}sla_hours * interval '1 hour'`;
  return `case
    when ${resolvedAt} is not null then
      case when ${resolvedAt} <= ${deadline} then 'met' else 'breached' end
    else
      case when now() > ${deadline} then 'breached' else 'on_track' end
  end`;
}

export interface ListTicketsFilters {
  status?: string;
  assigneeId?: number;
  slaStatus?: string;
}

export async function listTickets(
  filters: ListTicketsFilters = {}
): Promise<TicketDto[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.status !== undefined) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.assigneeId !== undefined) {
    params.push(filters.assigneeId);
    conditions.push(`assignee_id = $${params.length}`);
  }
  if (filters.slaStatus !== undefined) {
    params.push(filters.slaStatus);
    conditions.push(`sla_status = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  // Compute sla_status in a CTE so the filters above can reference it by name.
  const { rows } = await pool.query<TicketRow>(
    `with t as (
       select *, ${slaStatusSql()} as sla_status from tickets
     )
     select * from t ${where} order by created_at desc`,
    params
  );

  const result: TicketDto[] = [];
  for (const row of rows) {
    // look up assignee
    const assigneeName = row.assignee_id
      ? await usersRepository.findNameById(row.assignee_id)
      : null;
    const commentCount = await commentsRepository.countForTicket(row.id);
    result.push(toTicketDto(row, assigneeName, commentCount));
  }
  return result;
}

export async function getTicketById(id: number): Promise<TicketDto | null> {
  const { rows } = await pool.query(
    `select t.*, u.name as assignee_name,
            ${slaStatusSql('t')} as sla_status,
            (select count(*) from comments c where c.ticket_id = t.id) as comment_count
       from tickets t
       left join users u on u.id = t.assignee_id
      where t.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return toTicketDto(row, row.assignee_name ?? null, Number(row.comment_count));
}

export interface CreateTicketInput {
  subject: string;
  description: string;
  priority: string;
  assigneeId: number | null;
  slaHours: number;
}

export async function createTicket(input: CreateTicketInput): Promise<TicketDto> {
  const { rows } = await pool.query<TicketRow>(
    `insert into tickets (subject, description, status, priority, assignee_id, sla_hours)
     values ($1, $2, 'open', $3, $4, $5)
     returning *, ${slaStatusSql()} as sla_status`,
    [input.subject, input.description, input.priority, input.assigneeId, input.slaHours]
  );
  const row = rows[0];
  const assigneeName = row.assignee_id
    ? await usersRepository.findNameById(row.assignee_id)
    : null;
  return toTicketDto(row, assigneeName, 0);
}

export async function updateStatus(id: number, status: string): Promise<void> {
  if (status === 'resolved') {
    // mark resolved
    await pool.query('update tickets set status = $1, resolved_at = now() where id = $2', [
      status,
      id,
    ]);
  } else {
    await pool.query('update tickets set status = $1 where id = $2', [status, id]);
  }
}
