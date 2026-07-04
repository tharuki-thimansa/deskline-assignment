import { pool } from '../db';
import { toTicketDto, type TicketDto, type TicketRow } from '../mappers';
import * as usersRepository from '../users/users.repository';
import * as commentsRepository from '../comments/comments.repository';

export interface ListTicketsFilters {
  status?: string;
  assigneeId?: number;
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
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const { rows } = await pool.query<TicketRow>(
    `select * from tickets ${where} order by created_at desc`,
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
     returning *`,
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
