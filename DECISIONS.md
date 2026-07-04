# Decision Log

## Assumptions I made

- **SLA states.** The brief only defines a *breach* ("not resolved within `sla_hours`").
  I surfaced three states so the badge is useful at a glance:
  - `on_track` — unresolved, deadline still ahead
  - `met` — resolved on or before the deadline
  - `breached` — unresolved past the deadline, **or** resolved after it
  I deliberately did **not** add an `at_risk` / "due soon" state — the brief gives no
  threshold for it, so it would be inventing a requirement.
- **Deadline = `created_at + sla_hours`.** A ticket resolved *after* that instant was not
  resolved within `sla_hours`, so it counts as `breached` (not `met`).
- **`resolved_at` is the sole "resolved" signal.** Status is not used for the SLA calc.
  Edge case: a `closed` ticket that never got a `resolved_at` and is past its deadline reads
  as `breached`. That follows the literal rule; flagging rather than special-casing it.
- **SLA filter is in scope.** The brief lists "the React ticket list (filter controls + the
  SLA badge)" under task 2's stack-wiring. For task 2 to touch *filter controls*, it has to
  add an SLA filter, so I added one (combinable with the status/assignee filters from task 1).

## Design decisions

- **Computed in SQL, not in TypeScript.** The brief expects the DB/repository layer to be
  touched, and computing `sla_status` in the query lets the SLA filter run server-side in the
  same `WHERE` clause as the existing status/assignee filters — consistent with task 1.
  `listTickets` wraps the table in a CTE so the computed column can be filtered by name.
  Trade-off: the logic lives in SQL, so it's covered by integration tests (below) rather than
  unit tests. Given the suite is already integration-style against real Postgres, that matches
  the existing convention.
- **One `slaStatusSql(alias)` helper** builds the expression for all three queries
  (`listTickets`, `getTicketById`, `createTicket`) so the rule is defined once. The `alias`
  argument qualifies the columns for `getTicketById`, which joins `users` (also has a
  `created_at`) and would otherwise be ambiguous.
- **Applied everywhere `toTicketDto` runs**, not just the list, so the DTO is uniform and the
  detail endpoint carries `slaStatus` too (cheap, avoids a partially-populated type).
- **Filtering follows the task-1 pattern** exactly: optional zod enum in
  `listTicketsQuerySchema`, pushed onto the dynamic `WHERE` only when present, combinable,
  and a no-op when absent.

## Where I used AI

- Used Claude Code to scaffold the repository/query/schema/UI changes and the tests, then
  reviewed each diff against the codebase conventions.
- **Corrected:** the initial approach forgot that the Vite dev proxy only forwarded
  `/tickets`; the new `/users` call (task 1) would have hit Vite and returned HTML. Caught it
  by exercising the running app and added `/users` to the proxy.
- **Corrected:** qualified the SLA SQL columns with a table alias for `getTicketById`, where
  the `users` join makes `created_at` ambiguous.
- **Accepted:** the 3-state SLA model and the CTE-based filtering after checking they matched
  the existing style.

## Anything I noticed in the existing code

- **N+1 in `listTickets`** ([api/src/tickets/tickets.repository.ts](api/src/tickets/tickets.repository.ts)):
  it loops per row calling `findNameById` + `countForTicket`, while `getTicketById` does the
  same work in a single join. I left it as-is to keep this PR scoped, but it's the first thing
  I'd fold into one query (see below). Flagging rather than silently rewriting.
- **`updateStatus` never bumps `updated_at`** — a status change leaves `updated_at` stale.
  Minor, not touched.

## What I'd do with more time

- Collapse `listTickets` into a single query (join + comment-count subquery + `sla_status`),
  removing the N+1 and unifying it with `getTicketById`.
- Show the SLA badge on the ticket **detail** page too (the data is already there).
- A small front-end test for the badge/filter wiring (the repo currently has no web tests, so
  I stayed with the existing API-only test setup).
