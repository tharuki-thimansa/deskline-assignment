export interface TicketRow {
  id: number;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assignee_id: number | null;
  sla_hours: number;
  sla_status: string;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

export interface CommentRow {
  id: number;
  ticket_id: number;
  author_id: number;
  author_name: string;
  body: string;
  created_at: Date;
}

export interface TicketDto {
  id: number;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assigneeId: number | null;
  assigneeName: string | null;
  slaHours: number;
  slaStatus: string;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CommentDto {
  id: number;
  ticketId: number;
  authorId: number;
  authorName: string;
  body: string;
  createdAt: string;
}

export function toTicketDto(
  row: TicketRow,
  assigneeName: string | null,
  commentCount: number
): TicketDto {
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    assigneeName,
    slaHours: row.sla_hours,
    slaStatus: row.sla_status,
    commentCount,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

export function toCommentDto(row: CommentRow): CommentDto {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  };
}
