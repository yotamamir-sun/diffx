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
import { SidebarStorage } from './sidebarStorage'

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
    void (async () => {
      const scroller = document.querySelector('.main-scroll')
      let card: HTMLElement | null = null
      // The card itself may take a few frames to appear if the file was just
      // un-viewed above.
      for (let i = 0; i < 20 && !card; i++) {
        card = document.getElementById(`file-${comment.filePath}`)
        if (!card) await pause(30)
      }
      if (!card || !scroller) return
      card.scrollIntoView({ block: 'start' })
      await pause(80)
      let el = laidOutBubble()
      let guard = 0
      while (!el && card.getBoundingClientRect().bottom > scroller.clientHeight && guard++ < 40) {
        scroller.scrollBy({ top: scroller.clientHeight * 0.9 })
        await pause(80)
        el = laidOutBubble()
      }
      if (!el) {
        // The comment's line is not rendered — typically it drifted into
        // collapsed context because the diff changed after the comment was
        // made (an "outdated" comment). Land on the file instead of doing
        // nothing.
        card.scrollIntoView({ block: 'start' })
        card.classList.add('comment-bubble-flash')
        window.setTimeout(() => card!.classList.remove('comment-bubble-flash'), 1500)
        return
      }
      el.scrollIntoView({ block: 'center' })
      el.classList.add('comment-bubble-flash')
      window.setTimeout(() => el.classList.remove('comment-bubble-flash'), 1500)
    })()
  }, [viewedFiles, setViewed])

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
