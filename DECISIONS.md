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
- **The SLA clock runs by status, not by `resolved_at`.** A ticket's clock runs while it's in
  the active queue and stops when it reaches a terminal state, so **status** decides the calc:
  - active (`open` / `in_progress`) → measured against `now()`, ignoring any stale `resolved_at`
    (the seed has reopened tickets that still carry an old one — e.g. "Audit log missing user
    agent info" is `in_progress` but has a `resolved_at` from a shipped-then-reverted fix; it
    must read `breached`, not `met`);
  - terminal (`resolved` / `closed`) → judged by `resolved_at`: `met` if it beat the deadline,
    else `breached`.
- **Terminal tickets with no `resolved_at` → `slaStatus: null` (unknown), rendered as `—`.**
  A couple of seed rows are `closed` but never recorded a `resolved_at`. We can't know when they
  actually finished, so rather than assert a verdict from a proxy like `updated_at` (which risks
  labelling a ticket "breached" when it may have been fine), we return `null` and show a blank
  badge. Honest "unknown" over a confident guess — an agent can then tell a real breach from a
  data gap at a glance. (Earlier I tried the `updated_at` fallback; dropped it for this reason.)
- **Assignee is independent of SLA.** An unassigned ticket can be `met`, `on_track`, or
  `breached` — SLA depends only on timing, not on who (if anyone) owns it. Unassigned +
  breached is legitimate (and arguably the most urgent: overdue with no owner).
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
  it loops per row calling `findNameById` + `countForTicket` (2N+1 queries), while
  `getTicketById` already does the same work in one join. I deliberately kept it out of this
  PR to stay scoped, but I did prototype the fix (one query via a `LEFT JOIN` + comment-count
  subquery) plus supporting indexes on the `perf/list-query-and-indexes` branch — behaviour
  identical, tests still green. Flagging + prototyping rather than silently expanding this PR.
- **No indexes for the list's access paths** — it sorts by `created_at` and filters by
  `status` / `assignee_id`, with no indexes on those columns. Same branch adds them; left out
  of this PR for the same scope reason.
- **`updateStatus` never bumps `updated_at`, and never clears `resolved_at` on reopen** — a
  status change leaves `updated_at` stale, and a ticket moved back to `open` keeps its old
  `resolved_at`, so it would still read as resolved for SLA. Minor, flagged not touched.

## What I'd do with more time

- **Pagination on `/tickets`** — the real scaling limit: it returns every row in one response,
  which hurts payload + DOM size well before the query count does. Keyset pagination
  (`where created_at < $cursor limit N`) pairs naturally with a `created_at` index. Not done
  here because it changes the API response shape and the front end — bigger than this task
  warrants.
- **Merge the `perf/list-query-and-indexes` branch** — the N+1 fix and indexes above, kept
  separate so this PR stays feature-only and reviewable.
- Show the SLA badge on the ticket **detail** page too (the data is already there).
- A small front-end test for the badge/filter wiring (the repo currently has no web tests, so
  I stayed with the existing API-only test setup).
