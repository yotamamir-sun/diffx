import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, extname, resolve } from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { getGitDiff, getCustomGitDiff, getRepoName, getBranchName, getFileContent, getBlobContent, getWorktreeFileContent, isImageFile, getTabSizeForFiles, getUntrackedFilePaths } from './git.js'
import { loadSettings, saveSettings } from './settings.js'
import { InMemoryCommentStore } from './comments.js'
import type { CommentStore } from './comments.js'
import { isSafePath } from './path.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

// Older diffx clients — and comment snapshots restored from them via the review
// skill's migrate_comments.py — stored a comment's side as 'left'/'right'
// instead of the diff library's 'deletions'/'additions'. Normalize at this
// ingestion boundary so those comments anchor to the right line rather than
// carrying a side value the renderer can't key on.
const LEGACY_SIDE: Record<string, 'additions' | 'deletions'> = {
  right: 'additions',
  left: 'deletions',
}
function normalizeSide(side: unknown): string {
  return typeof side === 'string' && side in LEGACY_SIDE ? LEGACY_SIDE[side] : (side as string)
}

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

function parseFilePaths(patch: string): string[] {
  const paths = new Set<string>()
  for (const line of patch.split('\n')) {
    const match = line.match(/^diff --git a\/.+ b\/(.+)$/)
    if (match) paths.add(match[1])
  }
  return [...paths]
}

function parseBinaryFiles(patch: string, untrackedFiles?: Set<string>): BinaryFileInfo[] {
  const binaryFiles: BinaryFileInfo[] = []
  const lines = patch.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('Binary files ') || !line.includes(' differ')) continue

    // Find the file path from the preceding diff --git line
    let filePath = ''
    for (let j = i - 1; j >= 0; j--) {
      const match = lines[j].match(/^diff --git a\/.+ b\/(.+)$/)
      if (match) {
        filePath = match[1]
        break
      }
    }
    if (!filePath) continue

    // Determine change type from surrounding lines
    let changeType: BinaryFileInfo['type'] = 'changed'
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].startsWith('diff --git')) break
      if (lines[j].startsWith('new file mode')) {
        changeType = 'added'
        break
      }
      if (lines[j].startsWith('deleted file mode')) {
        changeType = 'deleted'
        break
      }
    }

    if (changeType === 'added' && untrackedFiles?.has(filePath)) {
      changeType = 'untracked'
    }
    binaryFiles.push({ path: filePath, type: changeType })
  }
  return binaryFiles
}

function diffContainsFileVersion(patch: string, path: string, oldOid: string, newOid: string): boolean {
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    // Match the new-file path from the `+++ b/<path>` header (as the client
    // does); the `diff --git` line is ambiguous for paths containing ` b/`.
    const nameMatch = chunk.match(/^\+\+\+ [ab]\/([^\t\r\n]+)/m)
    if (!nameMatch || nameMatch[1].trim() !== path) continue
    const indexMatch = chunk.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/m)
    if (indexMatch && indexMatch[1] === oldOid && indexMatch[2] === newOid) return true
  }
  return false
}

// Opaque fingerprint of everything /api/diff serves that can change under a
// running server. The client polls it to learn the loaded diff went stale.
function computeDiffDigest(patch: string, untrackedFiles: string[], branch: string): string {
  return createHash('sha256')
    .update(patch)
    .update('\0')
    .update(untrackedFiles.join('\n'))
    .update('\0')
    .update(branch)
    .digest('hex')
}

export function createApp(clientDir: string, customDiffArgs?: string[], commentStore?: CommentStore) {
  const app = new Hono()
  const isCustomMode = !!customDiffArgs
  const store = commentStore ?? new InMemoryCommentStore()
  const viewedFiles = new Map<string, string>()

  const currentDiff = (staged: boolean, untracked: boolean) => {
    const patch = isCustomMode ? getCustomGitDiff(customDiffArgs) : getGitDiff({ staged, untracked })
    const branch = getBranchName()
    const untrackedFiles = untracked ? getUntrackedFilePaths() : []
    return { patch, branch, untrackedFiles, digest: computeDiffDigest(patch, untrackedFiles, branch) }
  }

  app.get('/api/diff', (c) => {
    const staged = c.req.query('staged') === 'true'
    const untracked = c.req.query('untracked') === 'true'
    const { patch, branch, untrackedFiles, digest } = currentDiff(staged, untracked)
    const repoName = getRepoName()
    const untrackedSet = new Set(untrackedFiles)
    const binaryFiles = parseBinaryFiles(patch, untrackedSet)
    const filePaths = parseFilePaths(patch)
    const tabSizeMap = getTabSizeForFiles(filePaths)
    return c.json({ patch, repoName, branch, customMode: isCustomMode, binaryFiles, tabSizeMap, untrackedFiles, digest })
  })

  // Cheap staleness probe: same inputs as /api/diff, none of the parsing.
  app.get('/api/diff-digest', (c) => {
    const staged = c.req.query('staged') === 'true'
    const untracked = c.req.query('untracked') === 'true'
    return c.json({ digest: currentDiff(staged, untracked).digest })
  })

  app.get('/api/file-content', (c) => {
    const path = c.req.query('path')
    const version = c.req.query('version') as 'old' | 'new'
    if (!path || !version) {
      return c.json({ error: 'Missing path or version' }, 400)
    }
    const content = getFileContent(path, version)
    if (!content) {
      return c.json({ error: 'File not found' }, 404)
    }
    const ext = extname(path)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    return new Response(new Uint8Array(content), {
      headers: { 'Content-Type': contentType },
    })
  })

  // Full old/new file contents for a diffed file, so the client can build a
  // non-partial diff that supports expanding context around hunks.
  // `oldOid`/`newOid` are blob ids from the patch's `index` line. The diff is
  // regenerated and the requested oids must match its `index` line for the
  // requested path: this keeps arbitrary repository blobs unreachable, and
  // rejects requests whose patch no longer matches the worktree (git recomputes
  // the worktree blob hash on every diff, so any edit changes the new oid).
  app.get('/api/file-versions', (c) => {
    const path = c.req.query('path')
    const oldOid = c.req.query('oldOid')
    const newOid = c.req.query('newOid')
    if (!path || !oldOid || !newOid) {
      return c.json({ error: 'Missing path or oids' }, 400)
    }
    const staged = c.req.query('staged') === 'true'
    const untracked = c.req.query('untracked') === 'true'
    const patch = isCustomMode ? getCustomGitDiff(customDiffArgs) : getGitDiff({ staged, untracked })
    if (!diffContainsFileVersion(patch, path, oldOid, newOid)) {
      return c.json({ error: 'File version not in current diff' }, 404)
    }
    // A zero oid is git's `/dev/null` — an absent side (creation/deletion), so
    // its content is empty. A non-zero oid that is missing from the object
    // database is the worktree blob of an unstaged change (git computes its
    // hash without storing it), so fall back to reading the worktree.
    const oldContent = /^0+$/.test(oldOid) ? '' : getBlobContent(oldOid)
    const newContent = /^0+$/.test(newOid) ? '' : getBlobContent(newOid) ?? getWorktreeFileContent(path)
    if (oldContent == null || newContent == null) {
      return c.json({ error: 'Content unavailable' }, 404)
    }
    return c.json({ old: oldContent, new: newContent })
  })

  app.get('/api/settings', (c) => {
    return c.json(loadSettings())
  })

  app.put('/api/settings', async (c) => {
    const body = await c.req.json()
    const settings = saveSettings(body)
    return c.json(settings)
  })

  app.get('/api/viewed', (c) => {
    return c.json(Object.fromEntries(viewedFiles))
  })

  app.put('/api/viewed', async (c) => {
    const { filePath, viewed, contentHash } = await c.req.json<{ filePath: string; viewed: boolean; contentHash?: string }>()
    if (viewed) {
      if (typeof contentHash !== 'string' || contentHash.length === 0) {
        return c.json({ error: 'non-empty contentHash required when marking viewed' }, 400)
      }
      viewedFiles.set(filePath, contentHash)
    } else {
      viewedFiles.delete(filePath)
    }
    return c.json({ ok: true })
  })

  app.get('/api/comments', async (c) => {
    const comments = await store.getAll()
    return c.json(comments)
  })

  app.post('/api/comments', async (c) => {
    const body = await c.req.json()
    const comment = {
      id: crypto.randomUUID(),
      filePath: body.filePath,
      side: normalizeSide(body.side),
      lineNumber: body.lineNumber,
      lineContent: body.lineContent,
      body: body.body,
      status: 'open' as const,
      createdAt: Date.now(),
      replies: [],
    }
    const created = await store.add(comment)
    return c.json(created, 201)
  })

  app.put('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const { body, status, resolvedBy } = await c.req.json()
    // Only the reviewer resolves. An agent asking for 'resolved' (anything
    // without the web UI's resolvedBy:'user' marker) is recorded as
    // 'suggested' — it thinks it's done, and the reviewer confirms or
    // reopens. This also keeps older agent skills (which PUT
    // status:'resolved' with no marker) landing in the right state.
    const nextStatus =
      status === 'resolved' && resolvedBy !== 'user' ? ('suggested' as const) : status
    const updated = await store.update(id, { body, status: nextStatus })
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.post('/api/comments/:id/replies', async (c) => {
    const commentId = c.req.param('id')
    const { body, author } = await c.req.json()
    const reply = {
      id: crypto.randomUUID(),
      body,
      createdAt: Date.now(),
      // Replies default to 'agent' so existing agent skills that send only
      // { body } keep rendering with the bot avatar; the web UI sends 'user'.
      author: author === 'user' ? ('user' as const) : ('agent' as const),
    }
    const updated = await store.addReply(commentId, reply)
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.delete('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await store.remove(id)
    if (!removed) return c.json({ error: 'Comment not found' }, 404)
    return c.json({ ok: true })
  })

  app.get('/*', async (c) => {
    let filePath = c.req.path
    if (filePath === '/') filePath = '/index.html'

    const relativePath = filePath.slice(1)
    if (!isSafePath(relativePath, clientDir)) {
      return c.text('Forbidden', 403)
    }
    const fullPath = resolve(clientDir, relativePath)
    try {
      const content = await readFile(fullPath)
      const ext = extname(fullPath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      })
    } catch {
      const indexContent = await readFile(join(clientDir, 'index.html'))
      return new Response(indexContent, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  })

  return app
}

export function startServer(options: {
  port: number
  host: string
  clientDir: string
  customDiffArgs?: string[]
}): Promise<{ port: number }> {
  const app = createApp(options.clientDir, options.customDiffArgs)

  return new Promise((resolve) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port,
      hostname: options.host,
    }, (info) => {
      resolve({ port: info.port })
    })
  })
}
