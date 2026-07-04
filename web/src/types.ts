export interface Ticket {
  id: number;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigneeId: number | null;
  assigneeName: string | null;
  slaHours: number;
  slaStatus: 'on_track' | 'met' | 'breached' | null;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface User {
  id: number;
  name: string;
}

export interface Comment {
  id: number;
  ticketId: number;
  authorId: number;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface TicketWithComments extends Ticket {
  comments: Comment[];
}
