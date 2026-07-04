import { useEffect, useState } from 'react';
import { request } from './api';
import type { Ticket, User } from './types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

const STATUS_OPTIONS: Ticket['status'][] = [
  'open',
  'in_progress',
  'resolved',
  'closed',
];

export function TicketList() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [agents, setAgents] = useState<User[]>([]);
  const [status, setStatus] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<User[]>('/users')
      .then(setAgents)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (assigneeId) params.set('assigneeId', assigneeId);
    const query = params.toString();

    setTickets(null);
    request<Ticket[]>(`/tickets${query ? `?${query}` : ''}`)
      .then(setTickets)
      .catch((err: Error) => setError(err.message));
  }, [status, assigneeId]);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="filters">
        <label>
          Status{' '}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assignee{' '}
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">All</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!tickets ? (
        <p className="muted">Loading tickets…</p>
      ) : tickets.length === 0 ? (
        <p className="muted">No tickets match these filters.</p>
      ) : (
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assignee</th>
              <th>Comments</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td>
                  <a href={`#/tickets/${ticket.id}`}>{ticket.subject}</a>
                </td>
                <td>
                  <span className={`badge status-${ticket.status}`}>
                    {ticket.status.replace('_', ' ')}
                  </span>
                </td>
                <td>{ticket.priority}</td>
                <td>{ticket.assigneeName ?? '—'}</td>
                <td>{ticket.commentCount}</td>
                <td>{formatDate(ticket.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
