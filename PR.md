# Ticket list: filtering + SLA indicator

Extends the main ticket list with the two things support agents asked for.

## What changed

### 1. Filtering (status + assignee)
- `GET /tickets` accepts optional `status` and `assigneeId` query params, validated by a zod
  schema and applied as a combinable, parameterized `WHERE` clause. No params → unchanged
  behaviour.
- New `GET /users` endpoint (mirrors the tickets routes/repository split) so the UI can
  populate the assignee dropdown with all agents.
- Ticket list gains **Status** and **Assignee** dropdowns; the Vite dev proxy now forwards
  `/users` as well as `/tickets`.

### 2. SLA indicator
- `sla_status` is computed **in SQL** — `met` / `breached` / `on_track` based on
  `resolved_at` vs `created_at + sla_hours`. A single `slaStatusSql()` helper defines the rule
  for `listTickets`, `getTicketById`, and `createTicket`.
- Exposed as `slaStatus` on the ticket DTO; rendered as a coloured **badge** in the list
  (breached = red).
- `GET /tickets` also accepts an optional `slaStatus` filter, combinable with the others, plus
  a matching **SLA** dropdown in the UI.

See [DECISIONS.md](DECISIONS.md) for the assumptions (SLA state model, why SQL, the SLA-filter
scope call) and a couple of pre-existing issues I flagged rather than fixed (N+1 in
`listTickets`, stale `updated_at`).

## How to review
- **Rule of record:** `slaStatusSql()` in
  [api/src/tickets/tickets.repository.ts](api/src/tickets/tickets.repository.ts) — the SLA
  definition, defined once.
- **Filters:** `listTicketsQuerySchema`
  ([api/src/tickets/tickets.schema.ts](api/src/tickets/tickets.schema.ts)) and the dynamic
  `WHERE` in `listTickets` — status, assignee, and SLA all follow the same shape.
- **UI:** [web/src/TicketList.tsx](web/src/TicketList.tsx) — three dropdowns feeding one
  querystring, plus the SLA badge column.
- **Tests:** [api/test/tickets.test.ts](api/test/tickets.test.ts) — SLA block covers on-time
  (`met`), late (`breached`), unresolved-past-deadline (`breached`), the `slaStatus` filter,
  a combined filter, and rejection of an unknown value. Filter block covers status/assignee.

## Verification
- `npm test` — 19/19 pass · `npm --prefix api run typecheck` clean · `npm --prefix web run build` clean.
- Exercised the running API: `slaStatus` on list + detail, filter counts sum to the full set,
  combined filters subset correctly, invalid values → 400.
