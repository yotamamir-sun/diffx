# diffx shut-down + send-to-agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a UI "Shut down server" control and a "Send to agent" button to diffx so the reviewer can stop the server and hand a review round back to the agent without typing to it.

**Architecture:** Two new server concepts in `src/server.ts` — an injected `onShutdown` callback behind `POST /api/shutdown`, and an in-memory monotonic "submit" counter exposed by `POST /api/submit` + a long-poll `GET /api/wait-for-submit`. The React toolbar gains a "Send to agent" button and a destructive "Shut down server" item in the settings menu. The `/local-review` skill arms a backgrounded shell waiter against the long-poll endpoint; the waiter exiting is what re-invokes the agent (Claude Code re-invokes on background-command completion), replacing the user typing "posted".

**Tech Stack:** TypeScript, Hono + `@hono/node-server`, React 19, Vite + tsdown build, pnpm. Skill scripts are POSIX `bash`/`curl`.

## Global Constraints

- **diffx repo lives at `~/code/diffx`** (git remote = SSH fork `yotamamir-sun/diffx`). The global `diffx` is npm-linked to it, so `pnpm run build` in that dir is all that's needed to ship — no tarball repack, no `npm i -g`.
- **Skill repo is separate.** `~/.claude/skills/local-review` is a symlink into the platform worktree at `/Users/yotam/code/worktrees/platform-local-review-skill/.claude/skills/local-review` (branch `yotamamir/plt-1899-add-local-review-skill-pre-pr-diffx-review-round-trip`). Edit through the symlink; commit in the resolved worktree. Resolve it with `SKILL_DIR="$(readlink -f ~/.claude/skills/local-review)"`.
- **Committing in this sandbox:** inline `-m`/heredoc `git commit` **hangs**. Always write the message to a file and use `git -C <repo> commit -F <msgfile>` (and `git -C`, never `cd` — a zsh `cd`→eza alias also hangs). All commit steps below already do this.
- **Commit trailer:** every git commit message must end with the line
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **No new dependencies, no test framework.** The repo has zero test infrastructure; verify server logic with throwaway `tsx` scripts using Hono's `app.request()`, and UI with `pnpm run build` + a browser check. Do not add vitest/jest.
- **New endpoints are unauthenticated**, consistent with the existing localhost-only API.
- **Pre-existing tsc error:** `pnpm exec tsc --noEmit` already reports exactly one error at `src/server.ts:245` (legacy `side` normalization typed as `string`). It is out of scope — leave it. Your gate is "no *new* tsc errors + `pnpm run build` succeeds", not "tsc is clean".
- **Scratchpad for temp files:** `/private/tmp/claude-501/-Users-yotam-code-platform/89193c33-2fc5-4d95-8a39-372bc8b2cdd5/scratchpad` — put commit-message files and throwaway check scripts here; referenced below as `$SCRATCH`.

---

## File Structure

- `src/server.ts` (modify) — add `onShutdown` param + `POST /api/shutdown`; add submit counter, `POST /api/submit`, `GET /api/wait-for-submit`; module-level `WAIT_TIMEOUT_MS`.
- `src/cli.ts` (modify) — nothing (startServer wires the callback; cli is unchanged). *No edit needed.*
- `src/ui/components/Toolbar.tsx` (modify) — "Send to agent" button; "Shut down server" settings-menu item with click-to-confirm.
- `src/ui/App.tsx` (modify) — `handleSendToAgent`, `handleShutdown`, `serverStopped` state + stopped overlay; pass the two handlers to `Toolbar`.
- `src/ui/styles/global.css` (modify) — `.settings-item-danger`, `.server-stopped` styles.
- `scripts/wait_for_submit.sh` (create, in the skill dir) — backgrounded long-poll waiter.
- `SKILL.md` (modify, in the skill dir) — arm/re-arm the waiter; server-gone handling.

---

## Task 1: Server — shutdown endpoint

**Files:**
- Modify: `~/code/diffx/src/server.ts` (signature of `createApp` ~line 119; new route near the other `/api` routes; `startServer` ~line 320)
- Check (throwaway): `$SCRATCH/check-shutdown.mts`

**Interfaces:**
- Produces: `createApp(clientDir: string, customDiffArgs?: string[], commentStore?: CommentStore, onShutdown?: () => void)` — new optional 4th param. `POST /api/shutdown` → `200 {ok:true}` when `onShutdown` is set (invokes it ~50ms later), `404 {error}` when not. `startServer` passes `onShutdown: () => process.exit(0)`.

- [ ] **Step 1: Add the `onShutdown` param to `createApp`**

In `src/server.ts`, change the signature (currently `export function createApp(clientDir: string, customDiffArgs?: string[], commentStore?: CommentStore) {`):

```ts
export function createApp(
  clientDir: string,
  customDiffArgs?: string[],
  commentStore?: CommentStore,
  onShutdown?: () => void,
) {
```

- [ ] **Step 2: Add the shutdown route**

In `src/server.ts`, immediately after the `app.delete('/api/comments/:id', ...)` block (ends ~line 285) and before `app.get('/*', ...)`, add:

```ts
  // Lets the reviewer stop the server from the UI. Injected (not a hard
  // process.exit here) so tests mounting createApp don't kill the runner; the
  // real CLI passes () => process.exit(0). Respond first, then exit on the next
  // tick so the 200 flushes before the process dies.
  app.post('/api/shutdown', (c) => {
    if (!onShutdown) return c.json({ error: 'Shutdown not supported' }, 404)
    setTimeout(onShutdown, 50)
    return c.json({ ok: true })
  })
```

- [ ] **Step 3: Wire the callback in `startServer`**

In `src/server.ts`, change the `startServer` body line (currently `const app = createApp(options.clientDir, options.customDiffArgs)`) to:

```ts
  const app = createApp(options.clientDir, options.customDiffArgs, undefined, () => process.exit(0))
```

- [ ] **Step 4: Write the throwaway check script**

Create `$SCRATCH/check-shutdown.mts`:

```ts
import { createApp } from '/Users/yotam/code/diffx/src/server.js'

// No callback → 404
const noCb = createApp('dist/client')
const r404 = await noCb.request('/api/shutdown', { method: 'POST' })
console.log('no-callback status:', r404.status) // expect 404

// With callback → 200 and callback fires
let fired = false
const withCb = createApp('dist/client', undefined, undefined, () => { fired = true })
const r200 = await withCb.request('/api/shutdown', { method: 'POST' })
console.log('with-callback status:', r200.status) // expect 200
await new Promise((res) => setTimeout(res, 120))
console.log('callback fired:', fired) // expect true
```

- [ ] **Step 5: Run the check**

Run: `pnpm --dir ~/code/diffx exec tsx "$SCRATCH/check-shutdown.mts"`
Expected output:
```
no-callback status: 404
with-callback status: 200
callback fired: true
```

- [ ] **Step 6: Commit**

```bash
printf '%s\n' \
  'feat(server): add POST /api/shutdown to stop the server from the UI' \
  '' \
  'Injected onShutdown callback so createApp stays test-safe; the CLI' \
  'passes () => process.exit(0).' \
  '' \
  'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>' \
  > "$SCRATCH/msg-task1.txt"
git -C ~/code/diffx add src/server.ts
git -C ~/code/diffx commit -F "$SCRATCH/msg-task1.txt" -q
git -C ~/code/diffx log --oneline -1
```

---

## Task 2: Server — submit + wait-for-submit endpoints

**Files:**
- Modify: `~/code/diffx/src/server.ts` (module-level constant near the top; state + routes inside `createApp`)
- Check (throwaway): `$SCRATCH/check-submit.mts`

**Interfaces:**
- Produces:
  - `POST /api/submit` → `200 { count: number }` (increments a monotonic counter, resolves all parked waiters).
  - `GET /api/wait-for-submit?since=<n>` → `200 { count: number }`. Returns immediately if `count > since`; otherwise parks until a `POST /api/submit` or `WAIT_TIMEOUT_MS` elapses, then returns the current count.
  - `WAIT_TIMEOUT_MS` = `process.env.DIFFX_WAIT_TIMEOUT_MS` (ms) or 30000. The env override exists for tests only.

- [ ] **Step 1: Add the module-level timeout constant and Waiter type**

In `src/server.ts`, after the imports and before `const MIME_TYPES` (~line 11), add:

```ts
// How long GET /api/wait-for-submit parks before returning the unchanged count.
// Bounded so no connection hangs indefinitely and the client can re-poll.
// The env override is for tests only.
const WAIT_TIMEOUT_MS = Number(process.env.DIFFX_WAIT_TIMEOUT_MS) || 30_000

interface SubmitWaiter {
  resolve: (count: number) => void
  timer: ReturnType<typeof setTimeout>
}
```

- [ ] **Step 2: Add the submit state inside `createApp`**

In `src/server.ts`, inside `createApp`, next to the other in-memory state (`const viewedFiles = new Map(...)`, ~line 123), add:

```ts
  // Monotonic "the reviewer handed a round to the agent" signal. The agent
  // long-polls /api/wait-for-submit; the "Send to agent" button POSTs here.
  // In-memory, same lifetime as comments — a restart resets it, which is fine
  // because the agent re-arms its waiter with since=0 on a fresh review.
  let submitCount = 0
  const submitWaiters = new Set<SubmitWaiter>()
```

- [ ] **Step 3: Add the two routes**

In `src/server.ts`, immediately after the `app.post('/api/shutdown', ...)` block from Task 1, add:

```ts
  app.post('/api/submit', (c) => {
    submitCount++
    for (const w of submitWaiters) {
      clearTimeout(w.timer)
      w.resolve(submitCount)
    }
    submitWaiters.clear()
    return c.json({ count: submitCount })
  })

  app.get('/api/wait-for-submit', async (c) => {
    const since = Number(c.req.query('since')) || 0
    if (submitCount > since) return c.json({ count: submitCount })
    const count = await new Promise<number>((resolve) => {
      const waiter: SubmitWaiter = {
        resolve,
        timer: setTimeout(() => {
          submitWaiters.delete(waiter)
          resolve(submitCount)
        }, WAIT_TIMEOUT_MS),
      }
      submitWaiters.add(waiter)
    })
    return c.json({ count })
  })
```

- [ ] **Step 4: Write the throwaway check script**

Create `$SCRATCH/check-submit.mts`:

```ts
import { createApp } from '/Users/yotam/code/diffx/src/server.js'

const app = createApp('dist/client')

// Immediate return when count > since
await app.request('/api/submit', { method: 'POST' }) // count -> 1
const now = await (await app.request('/api/wait-for-submit?since=0')).json()
console.log('immediate:', now.count) // expect 1

// Resolves when a submit arrives while parked
const parked = app.request('/api/wait-for-submit?since=1').then((r) => r.json())
setTimeout(() => { void app.request('/api/submit', { method: 'POST' }) }, 100) // count -> 2
const woke = await parked
console.log('woke-on-submit:', woke.count) // expect 2

// Resolves on timeout with unchanged count (env override set below)
const start = Date.now()
const timedOut = await (await app.request('/api/wait-for-submit?since=2')).json()
console.log('timeout-count:', timedOut.count, 'elapsed-ok:', Date.now() - start < 2000) // expect 2 true
```

- [ ] **Step 5: Run the check with a short timeout override**

Run: `DIFFX_WAIT_TIMEOUT_MS=200 pnpm --dir ~/code/diffx exec tsx "$SCRATCH/check-submit.mts"`
Expected output:
```
immediate: 1
woke-on-submit: 2
timeout-count: 2 elapsed-ok: true
```

- [ ] **Step 6: Commit**

```bash
printf '%s\n' \
  'feat(server): add submit + long-poll wait endpoints for send-to-agent' \
  '' \
  'POST /api/submit bumps a monotonic counter and wakes parked waiters;' \
  'GET /api/wait-for-submit long-polls until a submit or WAIT_TIMEOUT_MS.' \
  'The review skill background-polls this to wake the agent on a click.' \
  '' \
  'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>' \
  > "$SCRATCH/msg-task2.txt"
git -C ~/code/diffx add src/server.ts
git -C ~/code/diffx commit -F "$SCRATCH/msg-task2.txt" -q
git -C ~/code/diffx log --oneline -1
```

---

## Task 3: Client — "Send to agent" button

**Files:**
- Modify: `~/code/diffx/src/ui/components/Toolbar.tsx`
- Modify: `~/code/diffx/src/ui/App.tsx`

**Interfaces:**
- Consumes: `POST /api/submit` (Task 2).
- Produces: `Toolbar` gains a required prop `onSendToAgent: () => Promise<void>`. `App` passes `handleSendToAgent`.

- [ ] **Step 1: Add the prop to `ToolbarProps`**

In `src/ui/components/Toolbar.tsx`, in the `ToolbarProps` interface, add after `onCopyComments: () => Promise<void>`:

```ts
  onSendToAgent: () => Promise<void>
```

- [ ] **Step 2: Destructure the new prop**

In `src/ui/components/Toolbar.tsx`, in the `Toolbar({ ... })` destructuring, add `onSendToAgent,` after `onCopyComments,`.

- [ ] **Step 3: Add the "sent" state and handler**

In `src/ui/components/Toolbar.tsx`, next to `const [copied, setCopied] = useState(false)`, add:

```ts
  const [sent, setSent] = useState(false)

  const handleSend = async () => {
    await onSendToAgent()
    setSent(true)
    setTimeout(() => setSent(false), 2000)
  }
```

- [ ] **Step 4: Render the button**

In `src/ui/components/Toolbar.tsx`, immediately after the existing "Copy comments" `<button>` (the one ending `` `Copy comments (${commentCount})` `` ), add:

```tsx
        <button className="btn btn-primary btn-sm" onClick={handleSend}>
          {sent ? 'Sent ✓' : 'Send to agent'}
        </button>
```

- [ ] **Step 5: Add the handler in `App.tsx` and pass it down**

In `src/ui/App.tsx`, add a handler near the other `useCallback` handlers (e.g. after `handleViewedChange`, ~line 273):

```ts
  const handleSendToAgent = useCallback(async () => {
    await fetch('/api/submit', { method: 'POST' })
  }, [])
```

Then in the `<Toolbar ... />` JSX, add after `onCopyComments={copyAllComments}`:

```tsx
        onSendToAgent={handleSendToAgent}
```

- [ ] **Step 6: Build to verify it compiles**

Run: `pnpm --dir ~/code/diffx run build`
Expected: completes with no error (a Vite "built in …" line and a tsdown success line). Ignore any `tsc` warnings — build uses esbuild.

- [ ] **Step 7: Browser check**

Run the built server against the diffx repo itself so there is a diff to show:
```bash
diffx --port 4977 --no-open -- HEAD~1 &
sleep 1
open http://localhost:4977
```
Confirm: a "Send to agent" button sits beside "Copy comments"; clicking it flips to "Sent ✓" for ~2s. In another terminal verify the counter moved: `curl -s localhost:4977/api/wait-for-submit?since=0` returns `{"count":1}` (or higher). Then stop it: `lsof -ti :4977 | xargs kill`.

- [ ] **Step 8: Commit**

```bash
printf '%s\n' \
  'feat(ui): add a Send to agent button to the toolbar' \
  '' \
  'POSTs /api/submit and shows transient Sent feedback, so the reviewer' \
  'can hand a round to the agent without typing to it.' \
  '' \
  'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>' \
  > "$SCRATCH/msg-task3.txt"
git -C ~/code/diffx add src/ui/components/Toolbar.tsx src/ui/App.tsx
git -C ~/code/diffx commit -F "$SCRATCH/msg-task3.txt" -q
git -C ~/code/diffx log --oneline -1
```

---

## Task 4: Client — "Shut down server" menu item + stopped state

**Files:**
- Modify: `~/code/diffx/src/ui/components/Toolbar.tsx`
- Modify: `~/code/diffx/src/ui/App.tsx`
- Modify: `~/code/diffx/src/ui/styles/global.css`

**Interfaces:**
- Consumes: `POST /api/shutdown` (Task 1).
- Produces: `Toolbar` gains required prop `onShutdown: () => void`. `App` owns a `serverStopped` boolean; when true it renders a full-screen "Server stopped" notice instead of the app body.

- [ ] **Step 1: Add the prop to `ToolbarProps`**

In `src/ui/components/Toolbar.tsx`, add to `ToolbarProps` after `onSendToAgent`:

```ts
  onShutdown: () => void
```

- [ ] **Step 2: Destructure it**

Add `onShutdown,` to the `Toolbar({ ... })` destructuring (after `onSendToAgent,`).

- [ ] **Step 3: Add click-to-confirm state**

In `src/ui/components/Toolbar.tsx`, next to the other `useState` hooks, add:

```ts
  const [confirmShutdown, setConfirmShutdown] = useState(false)
```

Reset it when the settings menu closes: change the existing `onClick={() => setSettingsOpen(!settingsOpen)}` on the gear button to:

```tsx
            onClick={() => {
              setSettingsOpen(!settingsOpen)
              setConfirmShutdown(false)
            }}
```

- [ ] **Step 4: Render the destructive item at the bottom of the settings menu**

In `src/ui/components/Toolbar.tsx`, inside `{settingsOpen && (<div className="settings-menu"> ... </div>)}`, after the Browser `<div className="settings-item settings-item-spaced">…</div>` block (the last item), add:

```tsx
              <button
                className="settings-item settings-item-danger"
                onClick={() => {
                  if (confirmShutdown) {
                    setSettingsOpen(false)
                    setConfirmShutdown(false)
                    onShutdown()
                  } else {
                    setConfirmShutdown(true)
                  }
                }}
              >
                {confirmShutdown ? 'Click again to confirm' : 'Shut down server'}
              </button>
```

- [ ] **Step 5: Add CSS for the danger item and the stopped screen**

In `src/ui/styles/global.css`, after the `.settings-item:hover` rule (~line 205), add:

```css
.settings-item-danger {
    width: 100%;
    justify-content: flex-start;
    background: none;
    border: none;
    font: inherit;
    color: var(--danger);
    border-top: 1px solid var(--border);
    margin-top: 4px;
    padding-top: 8px;
}

.settings-item-danger:hover {
    background: var(--bg-secondary);
}
```

Then after the `.error { ... }` rules (~line 750) add:

```css
.server-stopped {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 8px;
    color: var(--text-secondary);
    text-align: center;
}

.server-stopped h2 {
    color: var(--text);
    font-size: 18px;
    font-weight: 600;
}
```

- [ ] **Step 6: Add `serverStopped` state + handler + stopped screen in `App.tsx`**

In `src/ui/App.tsx`, add state near the top of `App` (after `const [activeFile, ...]`, ~line 146):

```ts
  const [serverStopped, setServerStopped] = useState(false)
```

Add the handler near `handleSendToAgent`:

```ts
  const handleShutdown = useCallback(() => {
    void fetch('/api/shutdown', { method: 'POST' }).catch(() => {})
    setServerStopped(true)
  }, [])
```

Add an early return before the existing `if (!loaded || loading)` block (~line 425):

```tsx
  if (serverStopped) {
    return (
      <div className="server-stopped">
        <h2>Server stopped</h2>
        <p>The diffx server was shut down. This tab is now disconnected — you can close it.</p>
      </div>
    )
  }
```

Pass the handler to `Toolbar`: after `onSendToAgent={handleSendToAgent}` add:

```tsx
        onShutdown={handleShutdown}
```

- [ ] **Step 7: Build to verify it compiles**

Run: `pnpm --dir ~/code/diffx run build`
Expected: completes with no error.

- [ ] **Step 8: Browser check**

```bash
diffx --port 4977 --no-open -- HEAD~1 &
sleep 1
open http://localhost:4977
```
Confirm: open the gear menu → a red "Shut down server" item at the bottom; first click → "Click again to confirm"; second click → the page shows the "Server stopped" screen and `curl -s localhost:4977/api/diff` now fails (connection refused). No leftover process: `lsof -ti :4977` prints nothing.

- [ ] **Step 9: Commit**

```bash
printf '%s\n' \
  'feat(ui): add a Shut down server item with click-to-confirm' \
  '' \
  'Destructive item in the settings menu; POSTs /api/shutdown and shows a' \
  'Server stopped screen. Comments are server-memory, so this ends the' \
  'review by design.' \
  '' \
  'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>' \
  > "$SCRATCH/msg-task4.txt"
git -C ~/code/diffx add src/ui/components/Toolbar.tsx src/ui/App.tsx src/ui/styles/global.css
git -C ~/code/diffx commit -F "$SCRATCH/msg-task4.txt" -q
git -C ~/code/diffx log --oneline -1
```

---

## Task 5: Skill — `wait_for_submit.sh` waiter script

**Files:**
- Create: `~/.claude/skills/local-review/scripts/wait_for_submit.sh` (edit through the symlink)

**Interfaces:**
- Produces: `wait_for_submit.sh <port> [since]` — loops `GET /api/wait-for-submit?since=<n>` with a 35s curl cap; **prints the new count and exits 0** when `count > since`; **re-polls** on a server-side timeout (`count == since`); **exits 3** if the server is unreachable. Designed to be launched with `run_in_background`; its exit re-invokes the agent.

- [ ] **Step 1: Create the script**

Create `~/.claude/skills/local-review/scripts/wait_for_submit.sh`:

```bash
#!/usr/bin/env bash
# Block until the reviewer clicks "Send to agent" in the diffx UI (or the
# server goes away), then exit so Claude Code re-invokes the agent.
#
# Usage: wait_for_submit.sh <port> [since]
#   Prints the new submit count and exits 0 on a real submission.
#   Exits 3 if the diffx server is unreachable (e.g. the user shut it down).
#   Launch with run_in_background; do NOT foreground it (it blocks).
set -u

port="${1:?usage: wait_for_submit.sh <port> [since]}"
since="${2:-0}"
url="http://localhost:${port}/api/wait-for-submit"

while true; do
  # -m 35 slightly exceeds the server's 30s park so a normal timeout comes
  # back as a body (rc 0), not a curl timeout.
  body="$(curl -sS --max-time 35 "${url}?since=${since}" 2>/dev/null)"
  rc=$?
  if [ "$rc" -eq 7 ]; then
    # Connection refused — the server is gone (e.g. the user shut it down).
    echo "diffx server unreachable on port ${port}" >&2
    exit 3
  fi
  if [ "$rc" -eq 28 ] && [ -z "$body" ]; then
    # Curl timed out with no response at all: the server hung/vanished
    # mid-request (a healthy park returns a body well within 35s).
    echo "diffx server unreachable on port ${port}" >&2
    exit 3
  fi
  if [ "$rc" -ne 0 ]; then
    # Any other transient curl error: wait a beat and retry rather than waking
    # the agent for nothing.
    sleep 2
    continue
  fi
  count="$(printf '%s' "$body" | sed -n 's/.*"count":[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
  if [ -z "$count" ]; then
    sleep 2
    continue
  fi
  if [ "$count" -gt "$since" ]; then
    echo "$count"
    exit 0
  fi
  # Server-side timeout with no new submit — re-poll, agent stays asleep.
done
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x "$(readlink -f ~/.claude/skills/local-review/scripts/wait_for_submit.sh)"`

- [ ] **Step 3: End-to-end check against a real server**

```bash
# Start a server with the new endpoints (built in Task 4)
diffx --port 4977 --no-open -- HEAD~1 &
sleep 1
# Arm the waiter in the background
~/.claude/skills/local-review/scripts/wait_for_submit.sh 4977 0 > "$SCRATCH/waiter.out" 2>&1 &
waiter_pid=$!
sleep 1
# It should still be running (no submit yet)
kill -0 "$waiter_pid" && echo "waiter parked: OK"
# Simulate the button
curl -s -X POST localhost:4977/api/submit >/dev/null
# Give it a moment to notice and exit
sleep 1
if kill -0 "$waiter_pid" 2>/dev/null; then echo "FAIL: waiter still running"; else echo "waiter exited: OK"; fi
cat "$SCRATCH/waiter.out"   # expect: 1
# Server-gone path
~/.claude/skills/local-review/scripts/wait_for_submit.sh 4977 1 > "$SCRATCH/waiter2.out" 2>&1 &
wpid2=$!
sleep 1
lsof -ti :4977 | xargs kill      # shut the server
sleep 2
wait "$wpid2"; echo "server-gone exit code: $?"  # expect 3
cat "$SCRATCH/waiter2.out"       # expect: diffx server unreachable...
```
Expected: `waiter parked: OK`, `waiter exited: OK`, waiter.out = `1`, `server-gone exit code: 3`.

- [ ] **Step 4: Commit (in the skill worktree)**

```bash
SKILL_DIR="$(readlink -f ~/.claude/skills/local-review)"
WT_ROOT="$(git -C "$SKILL_DIR" rev-parse --show-toplevel)"
REL="$(git -C "$WT_ROOT" ls-files --others --exclude-standard | grep wait_for_submit.sh)"
printf '%s\n' \
  'PLT-1899: add wait_for_submit.sh waiter for the send-to-agent button' \
  '' \
  'Backgrounded long-poll against diffx GET /api/wait-for-submit; exiting on' \
  'a submit re-invokes the agent, replacing the user typing "posted".' \
  '' \
  'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>' \
  > "$SCRATCH/msg-task5.txt"
git -C "$WT_ROOT" add "$REL"
git -C "$WT_ROOT" commit -F "$SCRATCH/msg-task5.txt" -q
git -C "$WT_ROOT" log --oneline -1
```

---

## Task 6: Skill — wire the waiter into `SKILL.md`

**Files:**
- Modify: `~/.claude/skills/local-review/SKILL.md` (edit through the symlink)

**Interfaces:**
- Consumes: `scripts/wait_for_submit.sh` (Task 5), diffx submit endpoints (Task 2).
- Produces: documented agent loop — arm the waiter after opening a review; on exit-0 handle the round then re-arm with `since=<printed count>`; on non-zero exit treat the review as ended.

- [ ] **Step 1: Update "Starting a review" step 5**

In `SKILL.md`, replace the current step 5 under "## Starting a review" (the line beginning "Tell the user what range is being shown…") with:

```markdown
5. Tell the user the range being shown and that they comment with the `+`
   button on lines, then either click **"Send to agent"** in the UI or say
   "posted" when ready — both wake you.
6. **Arm the waiter** so the button can wake you without the user typing. Launch
   in the background (it blocks until a click), starting from a zero baseline:
   ```bash
   scripts/wait_for_submit.sh <port> 0
   ```
   Run it with `run_in_background`. When it exits 0 it prints the new submit
   count on stdout — you are re-invoked automatically; go handle the round
   (below). If it exits non-zero, the server is gone (the user hit "Shut down
   server") — treat the review as ended; do not relaunch.
```

- [ ] **Step 2: Add a re-arm note to "Handling comments"**

In `SKILL.md`, at the end of the "## Handling comments" section (just before "## Finishing"), add:

```markdown
### The wake loop

You are woken either by the user's message or by `wait_for_submit.sh` exiting.
After you finish a round (replies posted, edits made), **re-arm** the waiter,
passing the count it last printed as the new baseline so a click that landed
while you were mid-round is not missed:

```bash
scripts/wait_for_submit.sh <port> <last-printed-count>
```

Launch it with `run_in_background` again and go idle. Repeat until the user ends
the review or the waiter reports the server is gone.

If the user clicks "Send to agent" and then "Shut down server" while you are
still editing, your next API write (reply/status) fails with connection
refused — report what you changed locally and note the server is gone rather
than erroring out.
```

- [ ] **Step 3: Sanity-check the doc**

Run: `grep -n 'wait_for_submit.sh' "$(readlink -f ~/.claude/skills/local-review/SKILL.md)"`
Expected: matches in both "Starting a review" and "The wake loop".

- [ ] **Step 4: Commit (in the skill worktree)**

```bash
SKILL_DIR="$(readlink -f ~/.claude/skills/local-review)"
WT_ROOT="$(git -C "$SKILL_DIR" rev-parse --show-toplevel)"
REL="$(git -C "$WT_ROOT" ls-files --modified | grep 'local-review/SKILL.md')"
printf '%s\n' \
  'PLT-1899: wire send-to-agent waiter into the local-review loop' \
  '' \
  'Arm wait_for_submit.sh after opening a review and re-arm each round;' \
  'a non-zero exit (server shut down from the UI) ends the review.' \
  '' \
  'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>' \
  > "$SCRATCH/msg-task6.txt"
git -C "$WT_ROOT" add "$REL"
git -C "$WT_ROOT" commit -F "$SCRATCH/msg-task6.txt" -q
git -C "$WT_ROOT" log --oneline -1
```

---

## Task 7: Integrated smoke + ship

**Files:** none (build + manual verification)

- [ ] **Step 1: Rebuild the linked binary**

Run: `pnpm --dir ~/code/diffx run build`
Expected: succeeds. Confirm the global `diffx` reflects it: `grep -c 'api/submit' "$(npm root -g)/diffx-cli/dist/cli.mjs"` returns a non-zero count (the linked build now contains the new endpoint).

- [ ] **Step 2: Full round-trip smoke**

```bash
diffx --port 4977 --no-open -- HEAD~1 &
sleep 1
open http://localhost:4977
~/.claude/skills/local-review/scripts/wait_for_submit.sh 4977 0 > "$SCRATCH/smoke.out" 2>&1 &
```
In the browser: add a comment on a line, then click "Send to agent". Confirm `$SCRATCH/smoke.out` prints `1` and the waiter process exited. Then open the gear menu → "Shut down server" → confirm → the "Server stopped" screen shows and `lsof -ti :4977` is empty.

- [ ] **Step 3: Clean up scratch files**

Run: `rm -f "$SCRATCH"/check-*.mts "$SCRATCH"/msg-task*.txt "$SCRATCH"/waiter*.out "$SCRATCH"/smoke.out`

- [ ] **Step 4: Push (only when the user asks)**

Do not push automatically. When the user confirms:
- diffx: `git -C ~/code/diffx push origin main` (fork `main` gets everything, per the workflow).
- skill: push the platform worktree branch and let PLT-1899 / PR #2993 carry it — **confirm with the user first** whether these skill commits belong on the existing PR or a follow-up ticket.

---

## Notes for the executor

- Tasks 1–4 and 7 commit in `~/code/diffx`; Tasks 5–6 commit in the platform worktree. Never mix.
- If a browser check is impractical in your environment, substitute the `curl` assertions given in each step — they cover the endpoint behavior; only the visual placement needs eyes.
- The `since`/count hand-off in Tasks 5–6 is the crux: the waiter prints the exact count it observed, and the next arm uses it as the baseline. That is what prevents a click during a round from being lost.
