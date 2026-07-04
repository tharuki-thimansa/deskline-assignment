import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { pool } from '../src/db';
import { ensureTestDatabase, resetDatabase } from './helpers';

const app = buildServer({ logger: false });

beforeAll(async () => {
  await ensureTestDatabase();
  await app.ready();
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('GET /tickets', () => {
  it('returns all tickets with assignee name and comment count', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets' });

    expect(res.statusCode).toBe(200);
    const tickets = res.json();
    expect(tickets).toHaveLength(3);

    const printer = tickets.find((t: any) => t.subject === 'Printer on fire');
    expect(printer).toMatchObject({
      status: 'open',
      priority: 'urgent',
      assigneeName: 'Ada Fixture',
      commentCount: 2,
      slaHours: 4,
    });
    expect(printer.createdAt).toBeTypeOf('string');

    const unassigned = tickets.find((t: any) => t.subject === 'Unassigned question');
    expect(unassigned.assigneeId).toBeNull();
    expect(unassigned.assigneeName).toBeNull();
    expect(unassigned.commentCount).toBe(0);
  });

  it('filters by status', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets?status=open' });

    expect(res.statusCode).toBe(200);
    const tickets = res.json();
    expect(tickets).toHaveLength(2);
    expect(tickets.every((t: any) => t.status === 'open')).toBe(true);
  });

  it('filters by assignee', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets?assigneeId=1' });

    expect(res.statusCode).toBe(200);
    const tickets = res.json();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].subject).toBe('Printer on fire');
  });

  it('combines status and assignee filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tickets?status=in_progress&assigneeId=2',
    });

    expect(res.statusCode).toBe(200);
    const tickets = res.json();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].subject).toBe('Slow reports page');
  });

  it('returns an empty list when filters match nothing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tickets?status=open&assigneeId=2',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('rejects an unknown status filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets?status=archived' });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /users', () => {
  it('returns the agents ordered by name', async () => {
    const res = await app.inject({ method: 'GET', url: '/users' });

    expect(res.statusCode).toBe(200);
    const users = res.json();
    expect(users).toEqual([
      { id: 1, name: 'Ada Fixture' },
      { id: 2, name: 'Grace Fixture' },
    ]);
  });
});

describe('SLA status', () => {
  it('flags an unresolved ticket past its deadline as breached, others on_track', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets' });

    const tickets = res.json();
    const printer = tickets.find((t: any) => t.subject === 'Printer on fire');
    const slow = tickets.find((t: any) => t.subject === 'Slow reports page');
    // Printer: 2h old, 4h SLA -> deadline still ahead. Slow reports: 2d old,
    // 24h SLA -> deadline already passed while unresolved.
    expect(printer.slaStatus).toBe('on_track');
    expect(slow.slaStatus).toBe('breached');
  });

  it('marks a ticket resolved before its deadline as met', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/tickets/1/status',
      payload: { status: 'resolved' },
    });

    const res = await app.inject({ method: 'GET', url: '/tickets/1' });
    expect(res.json().slaStatus).toBe('met');
  });

  it('marks a ticket resolved after its deadline as breached', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/tickets/2/status',
      payload: { status: 'resolved' },
    });

    const res = await app.inject({ method: 'GET', url: '/tickets/2' });
    expect(res.json().slaStatus).toBe('breached');
  });

  it('filters by sla status', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets?slaStatus=breached' });

    expect(res.statusCode).toBe(200);
    const tickets = res.json();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].subject).toBe('Slow reports page');
  });

  it('combines sla status with other filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tickets?slaStatus=on_track&status=open',
    });

    expect(res.statusCode).toBe(200);
    const tickets = res.json();
    expect(tickets).toHaveLength(2);
    expect(
      tickets.every((t: any) => t.slaStatus === 'on_track' && t.status === 'open')
    ).toBe(true);
  });

  it('rejects an unknown sla status filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets?slaStatus=late' });

    expect(res.statusCode).toBe(400);
  });

  it('returns null (unknown) for terminal tickets that never recorded a resolved_at', async () => {
    // A closed ticket with no resolved_at: we can't know when it actually
    // finished, so we don't guess met/breached from another timestamp.
    await pool.query(`
      insert into tickets
        (subject, description, status, priority, assignee_id, sla_hours, created_at, updated_at, resolved_at)
      values
        ('Closed, no resolved_at', 'x', 'closed', 'low', null, 4,
         now() - interval '10 days', now() - interval '9 days', null)
    `);

    const tickets = (await app.inject({ method: 'GET', url: '/tickets' })).json();
    const t = tickets.find((x: any) => x.subject === 'Closed, no resolved_at');
    expect(t.slaStatus).toBeNull();
  });

  it('filters by sla status = unknown', async () => {
    await pool.query(`
      insert into tickets
        (subject, description, status, priority, assignee_id, sla_hours, created_at, updated_at, resolved_at)
      values
        ('Closed, no resolved_at', 'x', 'closed', 'low', null, 4,
         now() - interval '10 days', now() - interval '9 days', null)
    `);

    const res = await app.inject({ method: 'GET', url: '/tickets?slaStatus=unknown' });

    expect(res.statusCode).toBe(200);
    const tickets = res.json();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].subject).toBe('Closed, no resolved_at');
    expect(tickets[0].slaStatus).toBeNull();
  });

  it('treats a reopened active ticket as live, ignoring a stale resolved_at', async () => {
    // in_progress, but carries an old resolved_at from work that was later
    // reverted. It is back in the active queue, so its SLA runs against now()
    // (overdue -> breached), not "met" off the stale timestamp.
    await pool.query(`
      insert into tickets
        (subject, description, status, priority, assignee_id, sla_hours, created_at, updated_at, resolved_at)
      values
        ('Reopened, stale resolved_at', 'z', 'in_progress', 'low', null, 24,
         now() - interval '10 days', now() - interval '1 day', now() - interval '9 days')
    `);

    const tickets = (await app.inject({ method: 'GET', url: '/tickets' })).json();
    const t = tickets.find((x: any) => x.subject === 'Reopened, stale resolved_at');
    expect(t.slaStatus).toBe('breached');
  });
});

describe('GET /tickets/:id', () => {
  it('returns the ticket with its comments', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets/1' });

    expect(res.statusCode).toBe(200);
    const ticket = res.json();
    expect(ticket.subject).toBe('Printer on fire');
    expect(ticket.comments).toHaveLength(2);
    expect(ticket.comments[0]).toMatchObject({
      ticketId: 1,
      authorName: 'Grace Fixture',
      body: 'Extinguisher deployed, assessing damage.',
    });
  });

  it('returns 404 for an unknown ticket', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets/999' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Ticket 999 not found' });
  });
});

describe('POST /tickets', () => {
  it('creates a ticket with defaults applied', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: {
        subject: 'Keyboard missing keys',
        description: 'The E and R keys have vanished.',
      },
    });

    expect(res.statusCode).toBe(201);
    const ticket = res.json();
    expect(ticket).toMatchObject({
      subject: 'Keyboard missing keys',
      status: 'open',
      priority: 'medium',
      assigneeId: null,
      assigneeName: null,
      slaHours: 8,
      commentCount: 0,
      resolvedAt: null,
    });
  });

  it('rejects an invalid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: { subject: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation failed');
  });
});

describe('PATCH /tickets/:id/status', () => {
  it('updates the status and returns the ticket', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/1/status',
      payload: { status: 'in_progress' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('in_progress');
  });

  it('rejects an unknown status value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/tickets/1/status',
      payload: { status: 'archived' },
    });

    expect(res.statusCode).toBe(400);
  });
});
