# Decision Log

## Assumptions I made

**SLA semantics** (the brief only defines a *breach* — "not resolved within `sla_hours`" — so the rest is judgement):

- **States: `on_track`, `met`, `breached`, plus `null` (unknown).** Three computed states, with
  `null` when the SLA genuinely can't be determined (see below). I deliberately did **not** add
  an `at_risk` / "due soon" state — the brief gives no threshold for it, so it would be inventing
  a requirement.
- **Deadline = `created_at + sla_hours`.** A ticket resolved *after* that instant was not resolved
  within `sla_hours`, so it's `breached`, not `met` — the same rule the brief's own seed data
  leans on (most resolved/closed tickets were resolved days after short SLAs).
- **The clock runs by status, not by the presence of `resolved_at`.** A ticket's SLA clock runs
  while it's in the active queue and stops when it reaches a terminal state:
  - active (`open` / `in_progress`) → measured against `now()`, **ignoring any stale `resolved_at`**.
    The seed has reopened tickets carrying an old timestamp (e.g. "Audit log missing user agent
    info" is `in_progress` but has a `resolved_at` from a shipped-then-reverted fix); it must read
    `breached`, not `met`.
  - terminal (`resolved` / `closed`) → judged by `resolved_at`: `met` if it beat the deadline, else
    `breached`.
- **Terminal tickets with no `resolved_at` → `null` (unknown), rendered `—`.** A couple of seed
  rows are `closed` but never recorded a `resolved_at`. We can't know when they actually finished,
  so rather than assert a verdict from a proxy like `updated_at` (which could label a fine ticket
  "breached"), we return `null`. A red badge then always means a *verified* miss, and `—` means a
  data gap — an agent can tell them apart at a glance, and the **Unknown** filter surfaces them.

**Other assumptions:**

- **Assignee is independent of SLA.** An unassigned ticket can be any SLA state — SLA depends on
  timing, not on who (if anyone) owns it. Unassigned + breached is legitimate, and arguably the
  most urgent (overdue with no owner).
- **The SLA filter is in scope.** The brief lists "the React ticket list (filter controls + the
  SLA badge)" under task 2's stack-wiring; for task 2 to touch *filter controls* it has to add an
  SLA filter, so I did (combinable with the status/assignee filters from task 1).

## Design decisions

- **SLA computed in SQL, not TypeScript.** The brief expects the DB/repository layer to be touched,
  and computing `sla_status` in the query lets the SLA filter run server-side in the same `WHERE`
  clause as status/assignee — consistent with task 1. `listTickets` wraps the table in a CTE so
  the computed column can be filtered by name. Trade-off: the logic lives in SQL, so it's covered
  by integration tests rather than unit tests — which matches the existing integration-style suite.
- **One `slaStatusSql(alias)` helper** defines the rule once for `listTickets`, `getTicketById`
  and `createTicket`. The `alias` argument qualifies the columns for `getTicketById`, which joins
  `users` (also has a `created_at`) and would otherwise be ambiguous.
- **Applied everywhere `toTicketDto` runs**, so the DTO is uniform and the detail endpoint carries
  `slaStatus` too (cheap, avoids a partially-populated type).
- **Filtering follows one pattern.** Each filter is an optional zod enum in `listTicketsQuerySchema`,
  pushed onto a dynamic `WHERE` only when present — combinable, and a no-op when absent. The SLA
  `unknown` value maps to `sla_status is null` rather than an equality check.
- **`GET /users` mirrors the tickets routes/repository split** to populate the assignee dropdown
  with all agents (vs. deriving them from the loaded tickets, which would only show agents who
  currently have tickets).

## Where I used AI

- Used Claude Code to scaffold the repository/query/schema/UI changes and the tests, reviewing
  each diff against the codebase conventions before keeping it.
- **Corrected:** the first cut forgot the Vite dev proxy only forwarded `/tickets`, so the new
  `/users` call would have hit Vite and returned HTML — caught by exercising the running app,
  then added `/users` to the proxy.
- **Corrected:** qualified the SLA SQL columns with a table alias for `getTicketById`, where the
  `users` join makes `created_at` ambiguous.
- **Iterated on the terminal-without-`resolved_at` edge:** first tried an `updated_at` fallback,
  then dropped it in favour of `null` (unknown) — a guessed "breached" undermines trust in the
  real breaches. Recorded as an assumption above.
- **Manual review beat the tests once:** eyeballing the rendered list caught a reopened ticket
  (`in_progress` with a stale `resolved_at`) showing `met`; that drove the "clock by status" rule
  and a regression test.

## Anything I noticed in the existing code

- **N+1 in `listTickets`** ([api/src/tickets/tickets.repository.ts](api/src/tickets/tickets.repository.ts)):
  it loops per row calling `findNameById` + `countForTicket` (2N+1 queries), while `getTicketById`
  already does the same work in one join. Kept out of this PR to stay scoped, but prototyped the
  fix (one query via `LEFT JOIN` + comment-count subquery) plus indexes on the
  `perf/list-query-and-indexes` branch — behaviour identical, tests green. Flag + prototype rather
  than silently expand this PR.
- **No indexes for the list's access paths** — it sorts by `created_at` and filters by `status` /
  `assignee_id` with no supporting indexes. Added on the same branch.
- **`updateStatus` never bumps `updated_at`, and never clears `resolved_at` on reopen** — a status
  change leaves `updated_at` stale, and a ticket moved back to `open` keeps its old `resolved_at`.
  I defended the SLA calc against the latter by keying off status, but the underlying data bug is
  still there. Flagged, not touched.
- **Seed data quirks worth naming:** closed tickets with no `resolved_at`; reopened tickets with a
  stale `resolved_at`; and a *feature request* (`Feature request: dark mode`) closed to the backlog
  that reads as a breach because every ticket carries an `sla_hours`. Whether SLAs should apply to
  backlog/feature tickets is a product question, not a code one — flagged.

## What I'd do with more time

- **Pagination on `/tickets`** — the real scaling limit: it returns every row in one response,
  which hurts payload + DOM size before query count does. Keyset pagination
  (`where created_at < $cursor limit N`) pairs naturally with the `created_at` index.
- **Merge `perf/list-query-and-indexes`** — the N+1 fix and indexes, kept separate so the feature
  PR stays small and reviewable.
- **Fix the data at the source** — a `closed_at` column (or clearing `resolved_at` on reopen) would
  remove the ambiguity the SLA rule currently works around.
- Show the SLA badge on the ticket **detail** page too (the data is already there).
- A small front-end test for the badge/filter wiring (the repo has no web test setup yet, so I
  stayed with the existing API-only tests).
