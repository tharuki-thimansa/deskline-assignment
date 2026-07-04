# Ticket list: filtering + SLA indicator

Extends the main ticket list with the two things support agents asked for:
combinable filtering, and an at-a-glance SLA status.

## What changed

### 1. Filtering (status + assignee)
- `GET /tickets` accepts optional `status` and `assigneeId` query params, validated by a zod
  schema and applied as a combinable, parameterized `WHERE` clause. No params → unchanged
  behaviour.
- New `GET /users` endpoint (mirrors the tickets routes/repository split) so the UI can populate
  the assignee dropdown with all agents.
- The list gains **Status** and **Assignee** dropdowns; the Vite dev proxy now forwards `/users`
  as well as `/tickets`.

### 2. SLA indicator
- `sla_status` is computed **in SQL** via a single `slaStatusSql()` helper shared by `listTickets`,
  `getTicketById`, and `createTicket`, and exposed as `slaStatus` on the ticket DTO.
- Rendered as a coloured **badge** in the list: `on_track`, `met`, `breached` (red), or `—` when
  the SLA can't be determined.
- The rule keys off **status**, not just `resolved_at`:
  - **active** (`open`/`in_progress`) → measured against `now()`, ignoring any stale `resolved_at`;
  - **terminal** (`resolved`/`closed`) → judged by `resolved_at` (`met`/`breached`);
  - **terminal with no `resolved_at`** → `null` (unknown / `—`), rather than guessing from another
    timestamp.
- `GET /tickets` accepts an optional `slaStatus` filter (`on_track` | `met` | `breached` |
  `unknown`), combinable with the others, with a matching **SLA** dropdown in the UI.

See [DECISIONS.md](DECISIONS.md) for the reasoning — the SLA state model, why it's computed in
SQL, the "unknown over a guess" call, and the pre-existing issues I flagged.

## Branch layout
- **`main`** — this PR: the two features + the SLA correctness decisions. Small and reviewable.
- **`perf/list-query-and-indexes`** — deliberately-deferred follow-ups (collapse `listTickets`
  into one query to remove the N+1, add indexes, polish the filter bar). Kept off this PR to stay
  scoped; behaviour-identical, tests green. See DECISIONS.md.

## How to review
- **SLA rule of record:** `slaStatusSql()` in
  [api/src/tickets/tickets.repository.ts](api/src/tickets/tickets.repository.ts) — the definition,
  written once.
- **Filters:** `listTicketsQuerySchema`
  ([api/src/tickets/tickets.schema.ts](api/src/tickets/tickets.schema.ts)) and the dynamic `WHERE`
  in `listTickets` — status, assignee, and SLA all follow the same shape (`unknown` → `IS NULL`).
- **UI:** [web/src/TicketList.tsx](web/src/TicketList.tsx) — three dropdowns feeding one
  querystring, plus the SLA badge column (`—` for unknown).
- **Tests:** [api/test/tickets.test.ts](api/test/tickets.test.ts) — status/assignee filters and
  combinations; SLA on-time (`met`), resolved-late (`breached`), overdue-unresolved (`breached`),
  reopened-ignores-stale-`resolved_at`, terminal-without-`resolved_at` (`null`); the `slaStatus`
  filter including `unknown`; and rejection of invalid values.

## Verification
- `npm test` — **22/22 pass** · `npm --prefix api run typecheck` clean ·
  `npm --prefix web run build` clean.
- Exercised the running app: `slaStatus` on list + detail; filter counts subset correctly and
  combine; the two data-gap tickets return `—` and are reachable via `?slaStatus=unknown`; invalid
  filter values → 400.
