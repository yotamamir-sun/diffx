# diffx: shut-down button + send-to-agent button

Date: 2026-07-21

## Problem

The `/local-review` diffx workflow is a round-trip: the user writes inline
comments in the browser, then must **type** a message ("posted", "take a look")
to wake the agent, which polls `/api/comments` and replies. Two friction points:

1. **No way to stop the server from the UI.** Only the agent kills the diffx
   process; the user has to ask it to.
2. **The user must type to hand a round back to the agent.** They want a button
   that "acts the same as telling the agent: posted some comments, please take a
   look."

## Constraints (unchanged, drive the design)

- diffx is a passive localhost HTTP server. The agent only acts when the user
  types **or** when a background command the agent started exits — Claude Code
  re-invokes the agent on background-command completion. That exit is the only
  push channel to the agent.
- Comments live only in server memory. Shutting the server down discards the
  whole review; that is the intended meaning of "shut down".
- The existing HTTP API is localhost-only and unauthenticated. New endpoints
  follow suit — no auth.

## Design

Three parts: server endpoints, toolbar UI, and skill wiring.

### 1. Server (`src/server.ts`, `src/cli.ts`)

**Shutdown endpoint.** `createApp` gains an optional `onShutdown?: () => void`.

- `POST /api/shutdown` → if `onShutdown` is set, respond `200 { ok: true }` and
  then invoke `onShutdown` on the next tick (so the response flushes before the
  process dies); if unset, `404`.
- `startServer` passes `onShutdown: () => process.exit(0)`.
- Rationale for injection: tests mount `createApp` directly. A hard
  `process.exit` in the route would kill the test runner. Absent callback →
  route is inert.

**Send-to-agent signal.** In-memory, same lifetime as comments:

- `submitCount: number`, starts at 0.
- `pendingWaiters`: set of `{ resolve, timer }` for parked long-poll requests.
- `POST /api/submit` → `submitCount++`, resolve every pending waiter with the
  new count (clearing their timers), return `{ count: submitCount }`.
- `GET /api/wait-for-submit?since=<n>`:
  - If `submitCount > n`: return `{ count: submitCount }` immediately.
  - Else: park the request. Resolve with `{ count: submitCount }` when a submit
    arrives, **or** after a ~30s internal timeout resolves with the current
    (unchanged) count. The bounded timeout means no connection hangs
    indefinitely and no proxy/idle killer can silently drop a forever-open
    request without the client noticing.
  - `since` missing/non-numeric → treat as `0`.

`submitCount` is monotonic and the client passes back the exact count it last
saw as `since`, so a click that lands while the agent is mid-round (no waiter
armed) still increments the count and is caught by the next arm. No missed
signal, no lost click.

### 2. Client (`src/ui/components/Toolbar.tsx`)

**"Send to agent"** — new primary button beside the existing "Copy comments"
button. Always enabled (doubles as a "please re-check / I replied in a thread"
ping). Click → `POST /api/submit`, then transient "Sent ✓" feedback for ~2s
(mirrors the existing `copied` state machine). Agent replies stream in live as
today.

**"Shut down server"** — a destructive item inside the existing gear/settings
menu (not the main bar; rare + destructive). Inline **click-to-confirm**: label
reads "Shut down server", first click arms it to "Click again to confirm"
(auto-disarms after a few seconds / on menu close), second click →
`POST /api/shutdown`. After a successful shutdown the UI shows a "Server stopped
— this tab is disconnected" state. The existing stale-diff poll already handles
the ensuing fetch failures gracefully (it simply stops seeing a digest), so no
new error plumbing is required beyond the explicit stopped-state message.

### 3. Skill wiring (`~/.claude/skills/local-review`)

**New bundled script `scripts/wait_for_submit.sh <port> [since]`:**

- Loops `curl -sS -m 35 "localhost:<port>/api/wait-for-submit?since=<n>"`.
- On a response whose `count > since`: print the new count on stdout and
  **exit 0** (a real submission → wake the agent).
- On a response whose `count == since` (server-side timeout): **re-poll** (do
  not exit — the agent stays asleep).
- On curl connection failure (server unreachable, e.g. the user hit "Shut down"):
  **exit non-zero** — the agent treats the review as ended, not as a signal to
  relaunch.

**`SKILL.md` changes:**

- "Starting a review": after opening the review, arm the waiter with
  `run_in_background`, `since=0`. Tell the user they can either click
  "Send to agent" in the UI or say "posted" — both wake the agent.
- On waiter exit 0: fetch `scripts/review.py list --needs-attention`, handle the
  round as today, reply, then **re-arm** the waiter with
  `since=<count the waiter printed>`.
- On waiter non-zero exit (server gone): report the review as ended; do not
  relaunch the server.
- Note the mid-round edge: if the user clicks "Send to agent" and then "Shut
  down" while the agent is still editing, the agent's subsequent API writes will
  fail with connection-refused — report what was changed locally and note the
  server is gone rather than erroring out.

## Non-goals

- No comment persistence changes; shutdown still discards the review.
- No auth on the new endpoints.
- No new tarball repack: ships via `pnpm run build` in `~/code/diffx` (the global
  `diffx` is npm-linked to it), same as recent changes.

## Testing

- Server unit tests (mounting `createApp`): `POST /api/shutdown` with no
  `onShutdown` → 404; with a stub callback → 200 and callback fired.
- `POST /api/submit` increments and returns the new count.
- `GET /api/wait-for-submit?since=N` returns immediately when `count > N`; parks
  and resolves on a subsequent `POST /api/submit`; resolves on timeout with an
  unchanged count. (Use a short injectable timeout for the timeout-path test.)
- Manual: click "Send to agent" wakes a backgrounded waiter; click-to-confirm
  shutdown stops the server and the tab shows the disconnected state.

**Note (implementation):** the repo has no test runner and is headed for an
upstream PR, so no test framework was added. The server behaviors above were
verified during development with throwaway `tsx` scripts driving Hono's
`app.request()` in-process (no running server) — shutdown 404-vs-callback,
submit increment, and wait-for-submit immediate/park/timeout (via the
`DIFFX_WAIT_TIMEOUT_MS` override). Client and end-to-end behavior is verified
in the integrated smoke.
