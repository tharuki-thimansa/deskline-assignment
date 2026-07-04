# Ticket list: filtering + SLA indicator

## Overview

Support agents asked for two things on the main ticket list: **the ability to filter it**, and
**an at-a-glance SLA status** so they can see which tickets need attention. This PR delivers both,
wired through the whole stack (PostgreSQL → Fastify API → React), matching the existing DeskLine
conventions (thin routes, SQL in `*.repository.ts`, zod schemas, `snake_case` DB → `camelCase` DTO
via `mappers.ts`).

At a glance:

- **Filter** the list by **status**, **assignee**, and **SLA** — individually or in any
  combination; no filters returns the full list unchanged.
- **SLA badge** on every row: `On track`, `Met`, `Breached`, or `—` when it can't be determined.
- **New `GET /users`** endpoint to populate the assignee dropdown.
- **8 new tests** (22 total) covering the filter combinations and every SLA branch.
- Performance work (N+1, indexes) and UI polish were deliberately **kept off this PR** and parked
  on a separate branch — see [Branch layout](#branch-layout).

---

## What changed

### 1. Filtering (status + assignee + SLA)
- `GET /tickets` accepts optional `status`, `assigneeId`, and `slaStatus` query params, validated
  by a zod schema and applied as a **combinable, parameterized `WHERE`** clause. Absent params are
  a no-op, so the unfiltered list is unchanged.
- New **`GET /users`** endpoint (mirrors the tickets routes/repository split) so the assignee
  dropdown can list all agents — not just ones who happen to have tickets.
- The UI gains **Status**, **Assignee**, and **SLA** dropdowns, each feeding a single querystring;
  the Vite dev proxy now forwards `/users` alongside `/tickets`.

### 2. SLA indicator
- `sla_status` is computed **in SQL** via a single `slaStatusSql()` helper shared by `listTickets`,
  `getTicketById`, and `createTicket`, and surfaced as `slaStatus` on the ticket DTO.
- Rendered as a coloured **badge** in the list; `—` when unknown.
- The rule keys off **status**, not merely whether `resolved_at` is set:

  | Ticket state | Measured against | Result |
  | --- | --- | --- |
  | `open` / `in_progress` | `now()` (ignores any stale `resolved_at`) | `on_track` before deadline, `breached` after |
  | `resolved` / `closed`, has `resolved_at` | `resolved_at` vs deadline | `met` if in time, else `breached` |
  | `resolved` / `closed`, **no** `resolved_at` | — (can't be known) | `null` → shown as `—` |

  Deadline = `created_at + sla_hours`. "Breached" therefore includes tickets **resolved late**, not
  just overdue-and-open ones — which is what the brief's own seed data is built to test.
- `GET /tickets` accepts an optional `slaStatus` filter — `on_track` | `met` | `breached` |
  `unknown` — combinable with the others. `unknown` maps to `sla_status IS NULL` so the data-gap
  tickets can actually be found.

See **[DECISIONS.md](DECISIONS.md)** for the reasoning behind each judgement call (SLA state model,
why SQL, "unknown over a guess", assignee independence) and the existing-code issues I flagged.

---

## API surface

| Method | Path | Change |
| --- | --- | --- |
| GET | `/tickets` | **+ `status`, `assigneeId`, `slaStatus` filters**; each row now carries `slaStatus` |
| GET | `/tickets/:id` | now carries `slaStatus` |
| GET | `/users` | **new** — `[{ id, name }]`, ordered by name |
| POST | `/tickets` | unchanged (response gains `slaStatus`) |
| PATCH | `/tickets/:id/status` | unchanged (response gains `slaStatus`) |

Example: `GET /tickets?status=open&assigneeId=4&slaStatus=breached` → open, overdue tickets
assigned to agent 4.

---

## Files changed

**API**
- `tickets/tickets.schema.ts` — `listTicketsQuerySchema` (status / assignee / slaStatus, all optional).
- `tickets/tickets.repository.ts` — `slaStatusSql()` helper; filters in `listTickets`; `sla_status`
  added to `getTicketById` and `createTicket`.
- `tickets/tickets.routes.ts` — parse the query schema on `GET /tickets`.
- `users/users.repository.ts`, `users/users.routes.ts` — `listUsers()` + `GET /users`.
- `server.ts` — register `userRoutes`.
- `mappers.ts` — `slaStatus` on `TicketRow` / `TicketDto` (`string | null`).

**Web**
- `TicketList.tsx` — three filter dropdowns feeding one querystring; SLA badge column (`—` for null).
- `types.ts` — `User`; `slaStatus` on `Ticket`.
- `styles.css` — filter row + SLA badge styles (existing palette).
- `vite.config.ts` — proxy `/users`.

**Tests / docs**
- `test/tickets.test.ts` — 8 new cases (see below).
- `DECISIONS.md`, `PR.md`.

---

## Branch layout

- **`main`** — this PR: the two features + the SLA correctness decisions. Small and reviewable
  (~feature code only).
- **`perf/list-query-and-indexes`** — deliberately-deferred follow-ups: collapse `listTickets` into
  one query (removes the N+1), add indexes on the list's filter/sort/join columns, and polish the
  filter bar. Kept off this PR to stay scoped; behaviour-identical, tests green. Rationale in
  DECISIONS.md.

---

## How to review

1. **SLA rule of record** — `slaStatusSql()` in
   [api/src/tickets/tickets.repository.ts](api/src/tickets/tickets.repository.ts). The whole SLA
   definition lives here, written once and reused by all three queries.
2. **Filters** — `listTicketsQuerySchema`
   ([api/src/tickets/tickets.schema.ts](api/src/tickets/tickets.schema.ts)) and the dynamic `WHERE`
   in `listTickets`: status, assignee, and SLA all follow the same shape (`unknown` → `IS NULL`).
3. **UI** — [web/src/TicketList.tsx](web/src/TicketList.tsx): the three dropdowns and the badge column.
4. **Tests** — [api/test/tickets.test.ts](api/test/tickets.test.ts).

---

## Testing

New cases in `test/tickets.test.ts`:
- Filter by **status**, by **assignee**, **combined**, empty-match, and invalid → 400.
- `GET /users` returns agents ordered by name.
- SLA: resolved **on time** → `met`; resolved **late** → `breached`; **overdue & unresolved** →
  `breached`; **reopened** ticket ignores a stale `resolved_at`; **terminal without `resolved_at`**
  → `null`.
- SLA filter, a **combined** SLA filter, `slaStatus=unknown`, and invalid → 400.

### Verification
- `npm test` — **22/22 pass**
- `npm --prefix api run typecheck` — clean
- `npm --prefix web run build` — clean (tsc + vite)
- Exercised the running app: `slaStatus` on list + detail; filters subset and combine correctly;
  the two data-gap tickets render `—` and are reachable via `?slaStatus=unknown`; invalid filter
  values → 400.

### How to run
```sh
docker compose up -d      # PostgreSQL + Adminer
npm run seed              # schema + seed data
npm run dev:api           # API  → http://localhost:3000
npm run dev:web           # web  → http://localhost:5173
```
