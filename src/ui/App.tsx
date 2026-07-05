import { useState, useMemo, useCallback, useEffect } from 'react'
import { Resizable } from 'react-resizable'
import { parsePatchFiles } from '@pierre/diffs'
import { Virtualizer } from '@pierre/diffs/react'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ReviewComment } from '../types'
import { useDiff } from './hooks/useDiff'
import { useComments } from './hooks/useComments'
import { useSettings } from './hooks/useSettings'
import { useViewed } from './hooks/useViewed'
import { useFullDiffs, fileKey } from './hooks/useFullDiffs'
import { Toolbar } from './components/Toolbar'
import { DiffViewer } from './components/DiffViewer'
import { FileTree } from './components/FileTree'
import { CommentTracker } from './components/CommentTracker'
import { DiffSearch } from './components/DiffSearch'
import type { DiffLineRecord } from './components/DiffSearch'
import { SidebarStorage } from './sidebarStorage'

export interface ChangedLines {
  additions: Set<number>
  deletions: Set<number>
}

// Per-file sets of +/- line numbers from the raw patch. The diff component
// only reliably hosts annotation bubbles on changed lines — comments on
// unchanged context lines are silently dropped by it, so the UI needs to know
// which comments to promote to the file-top strip instead.
function parseChangedLines(patch: string): Map<string, ChangedLines> {
  const map = new Map<string, ChangedLines>()
  let cur: ChangedLines | null = null
  let oldLn = 0
  let newLn = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ b/')) {
      cur = { additions: new Set(), deletions: new Set() }
      map.set(line.slice(6), cur)
      continue
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('\\')) continue
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (m) {
        oldLn = Number(m[1])
        newLn = Number(m[2])
      }
      continue
    }
    if (!cur) continue
    if (line.startsWith('+')) cur.additions.add(newLn++)
    else if (line.startsWith('-')) cur.deletions.add(oldLn++)
    else if (line.startsWith(' ') || line === '') {
      oldLn++
      newLn++
    }
  }
  return map
}

// Every content line of the patch with its file/side/line coordinates, for
// whole-diff search (native browser find can't see virtualized/shadow rows).
function parseDiffLines(patch: string): DiffLineRecord[] {
  const out: DiffLineRecord[] = []
  let filePath: string | null = null
  let oldLn = 0
  let newLn = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ b/')) {
      filePath = line.slice(6)
      continue
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('\\')) continue
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (m) {
        oldLn = Number(m[1])
        newLn = Number(m[2])
      }
      continue
    }
    if (!filePath) continue
    if (line.startsWith('+')) out.push({ filePath, side: 'additions', lineNumber: newLn++, text: line.slice(1) })
    else if (line.startsWith('-')) out.push({ filePath, side: 'deletions', lineNumber: oldLn++, text: line.slice(1) })
    else if (line.startsWith(' ') || line === '') {
      out.push({ filePath, side: 'additions', lineNumber: newLn, text: line.slice(1) })
      oldLn++
      newLn++
    }
  }
  return out
}

function useWindowSize({ factor }: { factor: number }) {
  const compute = () => Math.round(window.innerWidth * factor)

  const [size, setSize] = useState(compute)

  useEffect(() => {
    const handleResize = () => setSize(compute())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [factor])

  return size
}

export function App() {
  const { settings, loaded, updateSettings } = useSettings()
  const { patch, repoName, branch, customMode, binaryFiles, tabSizeMap, untrackedFiles, loading, error } = useDiff({
    staged: settings.staged,
    untracked: settings.untracked,
  })
  const { comments, addComment, removeComment, replyToComment, copyAllComments } =
    useComments()
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [sidebar, setSidebar] = useState(() => SidebarStorage.load())
  const maxSidebarWidth = Math.max(SidebarStorage.minSize, useWindowSize({ factor: 0.5 }))

  const handleResize = useCallback((_e: React.SyntheticEvent, data: { size: { width: number } }) => {
    setSidebar((prev) => prev.withSize(data.size.width))
  }, [])

  const handleResizeStop = useCallback((_e: React.SyntheticEvent, data: { size: { width: number } }) => {
    setSidebar((prev) => prev.withSize(data.size.width).save())
  }, [])

  const handleToggleCollapse = useCallback(() => {
    setSidebar((prev) => prev.withCollapsed(!prev.collapsed).save())
  }, [])

  const untrackedSet = useMemo(() => new Set(untrackedFiles), [untrackedFiles])

  const files = useMemo(() => {
    if (!patch) return []
    try {
      const parsed = parsePatchFiles(patch)
      const parsedFiles = parsed.flatMap((p) => p.files)

      const existingNames = new Set(parsedFiles.map((f) => f.name))
      for (const bf of binaryFiles) {
        if (!existingNames.has(bf.path)) {
          const syntheticFile: FileDiffMetadata = {
            name: bf.path,
            type: bf.type === 'added' || bf.type === 'untracked' ? 'new' : bf.type === 'deleted' ? 'deleted' : 'change',
            hunks: [],
            splitLineCount: 0,
            unifiedLineCount: 0,
            isPartial: true,
            deletionLines: [],
            additionLines: [],
          }
          parsedFiles.push(syntheticFile)
        }
      }

      return parsedFiles
    } catch {
      return []
    }
  }, [patch, binaryFiles])

  const fullFiles = useFullDiffs(patch, files, { staged: settings.staged, untracked: settings.untracked })
  const displayFiles = useMemo(() => {
    if (fullFiles.size === 0) return files
    return files.map((f) => fullFiles.get(fileKey(f)) ?? f)
  }, [files, fullFiles])

  const { viewedFiles, setViewed } = useViewed(files)

  const diffStats = useMemo(() => {
    if (!patch) return { additions: 0, deletions: 0 }
    let additions = 0
    let deletions = 0
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
    return { additions, deletions }
  }, [patch])

  const changedLinesMap = useMemo(() => (patch ? parseChangedLines(patch) : new Map<string, ChangedLines>()), [patch])

  const diffLines = useMemo(() => (patch ? parseDiffLines(patch) : []), [patch])

  const binaryFileMap = useMemo(() => {
    const map = new Map<string, (typeof binaryFiles)[number]>()
    for (const bf of binaryFiles) {
      map.set(bf.path, bf)
    }
    return map
  }, [binaryFiles])

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of comments) {
      counts[c.filePath] = (counts[c.filePath] ?? 0) + 1
    }
    return counts
  }, [comments])

  const fileAnnotationsMap = useMemo(() => {
    const map = new Map<string, { side: ReviewComment['side']; lineNumber: number; metadata: ReviewComment }[]>()
    for (const c of comments) {
      let list = map.get(c.filePath)
      if (!list) {
        list = []
        map.set(c.filePath, list)
      }
      list.push({
        side: c.side,
        lineNumber: c.lineNumber,
        metadata: c,
      })
    }
    return map
  }, [comments])

  const handleFileClick = useCallback((filePath: string) => {
    setActiveFile(filePath)
    const el = document.getElementById(`file-${filePath}`)
    if (el) {
      el.scrollIntoView({ block: 'start' })
    }
  }, [])

  const handleViewedChange = useCallback((filePath: string, viewed: boolean) => {
    setViewed(filePath, viewed)
  }, [setViewed])

  const handleCommentClick = useCallback((comment: ReviewComment) => {
    // A file marked Viewed collapses to a header stub, unmounting its comment
    // bubbles — un-view it so the target can render.
    if (viewedFiles.has(comment.filePath)) {
      setViewed(comment.filePath, false)
    }
    setActiveFile(comment.filePath)

    // The bubble stays in the DOM but the diff component only lays out
    // content near the visible region, so a bubble deep inside a long file
    // reports a zero rect — scrollIntoView on it jumps to garbage. Instead:
    // jump to the file card (which always has real layout), then sweep the
    // card viewport-by-viewport until the bubble acquires layout, then
    // center and flash it.
    const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
    const laidOutBubble = () => {
      const el = document.getElementById(`comment-${comment.id}`)
      return el && el.getBoundingClientRect().height > 0 ? el : null
    }
    // Resolves to true when the bubble was shown inline, false when the
    // comment could not be anchored (outdated) — the tracker uses this to
    // auto-expand the thread in the sidebar so the comment is always visible
    // somewhere.
    return (async () => {
      const scroller = document.querySelector('.main-scroll')
      // Look the card up fresh on every use: cards remount while full diffs
      // stream in (their React key changes), so a held reference can go stale
      // mid-sweep and leave the loop measuring a detached node.
      const cardEl = () => document.getElementById(`file-${comment.filePath}`)
      // The card may take a few frames to appear if the file was just
      // un-viewed above.
      for (let i = 0; i < 20 && !cardEl(); i++) {
        await pause(30)
      }
      if (!cardEl() || !scroller) return false
      cardEl()!.scrollIntoView({ block: 'start' })
      await pause(80)
      let el = laidOutBubble()
      let guard = 0
      while (
        !el &&
        (cardEl()?.getBoundingClientRect().bottom ?? 0) > scroller.clientHeight &&
        guard++ < 40
      ) {
        scroller.scrollBy({ top: scroller.clientHeight * 0.9 })
        await pause(80)
        el = laidOutBubble()
      }
      if (!el) {
        // The comment's line is not rendered (outdated, or a line the diff
        // component won't host an annotation on). Land on the file instead of
        // doing nothing; the tracker opens the thread in the sidebar.
        const card = cardEl()
        if (card) {
          card.scrollIntoView({ block: 'start' })
          card.classList.add('comment-bubble-flash')
          window.setTimeout(() => card.classList.remove('comment-bubble-flash'), 1500)
        }
        return false
      }
      el.scrollIntoView({ block: 'center' })
      el.classList.add('comment-bubble-flash')
      window.setTimeout(() => el.classList.remove('comment-bubble-flash'), 1500)
      return true
    })()
  }, [viewedFiles, setViewed])

  const handleSearchNavigate = useCallback((record: DiffLineRecord) => {
    setActiveFile(record.filePath)
    const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
    void (async () => {
      const scroller = document.querySelector('.main-scroll')
      const cardEl = () => document.getElementById(`file-${record.filePath}`)
      for (let i = 0; i < 20 && !cardEl(); i++) await pause(30)
      const card = cardEl()
      if (!card || !scroller) return
      // Proportional jump: land near the line, letting the virtualizer render
      // the region. Precise row targeting isn't possible from outside the
      // diff component's shadow DOM, but nearby + rendered beats not found.
      const file = displayFiles.find((f) => f.name === record.filePath)
      const lines = record.side === 'additions' ? file?.additionLines : file?.deletionLines
      const total = Math.max(lines?.length ?? 0, 1)
      const fraction = Math.min(1, record.lineNumber / total)
      const cardTop = card.getBoundingClientRect().top + scroller.scrollTop
      const cardHeight = card.getBoundingClientRect().height
      scroller.scrollTop = cardTop + fraction * cardHeight - scroller.clientHeight / 3
    })()
  }, [displayFiles])

  const sidebarContent = (
    <div className="sidebar-content">
      <FileTree
        files={files}
        activeFile={activeFile}
        commentCounts={commentCounts}
        viewedFiles={viewedFiles}
        untrackedFiles={untrackedSet}
        onFileClick={handleFileClick}
        collapsed={sidebar.collapsed}
        onToggleCollapse={handleToggleCollapse}
      />
      {!sidebar.collapsed && (
        <CommentTracker comments={comments} onCommentClick={handleCommentClick} onReply={replyToComment} />
      )}
    </div>
  )

  if (!loaded || loading) {
    return (
      <div className="loading">
        <p>Loading diff...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error">
        <p>Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <Toolbar
        repoName={repoName}
        branch={branch}
        fileCount={files.length}
        additions={diffStats.additions}
        deletions={diffStats.deletions}
        commentCount={comments.length}
        diffStyle={settings.diffStyle}
        diffOptions={{ staged: settings.staged, untracked: settings.untracked }}
        defaultTabSize={settings.defaultTabSize}
        softWrap={settings.softWrap}
        browser={settings.browser}
        customMode={customMode}
        onDiffStyleChange={(style) => updateSettings({ diffStyle: style })}
        onDiffOptionsChange={(options) => updateSettings(options)}
        onDefaultTabSizeChange={(size) => updateSettings({ defaultTabSize: size })}
        onSoftWrapChange={(softWrap) => updateSettings({ softWrap })}
        onBrowserChange={(browser) => updateSettings({ browser })}
        onCopyComments={copyAllComments}
      />
      <div className="app-body">
        {sidebar.collapsed ? (
          <aside className="sidebar sidebar-collapsed" style={{ width: sidebar.visibleSize() }}>
            {sidebarContent}
          </aside>
        ) : (
          <Resizable
            width={sidebar.visibleSize(maxSidebarWidth)}
            height={0}
            axis="x"
            resizeHandles={['e']}
            minConstraints={[SidebarStorage.minSize, 0]}
            maxConstraints={[maxSidebarWidth, 0]}
            onResize={handleResize}
            onResizeStop={handleResizeStop}
            handle={<div className="sidebar-resize-handle" />}
          >
            <aside className="sidebar" style={{ width: sidebar.visibleSize(maxSidebarWidth) }}>
              {sidebarContent}
            </aside>
          </Resizable>
        )}
        <main className="main">
          <DiffSearch lines={diffLines} onNavigate={handleSearchNavigate} />
          <Virtualizer className="main-scroll" contentClassName="main-content">
            <DiffViewer
              files={displayFiles}
              diffStyle={settings.diffStyle}
              tabSizeMap={tabSizeMap}
              defaultTabSize={settings.defaultTabSize}
              softWrap={settings.softWrap}
              viewedFiles={viewedFiles}
              binaryFiles={binaryFileMap}
              onViewedChange={handleViewedChange}
              fileAnnotationsMap={fileAnnotationsMap}
              changedLinesMap={changedLinesMap}
              onAddComment={addComment}
              onDeleteComment={removeComment}
              onReplyComment={replyToComment}
            />
          </Virtualizer>
        </main>
      </div>
    </div>
  )
}
