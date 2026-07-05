import { useState, memo } from 'react'
import { FileDiff } from '@pierre/diffs/react'
import type { DiffLineAnnotation, FileDiffMetadata, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import type { ChangedLines } from '../App'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'

interface PendingComment {
  side: AnnotationSide
  lineNumber: number
}

interface FileDiffCardProps {
  id?: string
  fileDiff: FileDiffMetadata
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
  changedLines?: ChangedLines
  diffStyle: 'split' | 'unified'
  tabSize: number
  softWrap: boolean
  viewed: boolean
  onViewedChange: (filePath: string, viewed: boolean) => void
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string) => void
  onDeleteComment: (id: string) => void
  onReplyComment: (id: string, body: string) => void
  onSetCommentStatus: (id: string, status: ReviewComment['status']) => void
}

export const FileDiffCard = memo(function FileDiffCard({
  id,
  fileDiff,
  filePath,
  annotations,
  changedLines,
  diffStyle,
  tabSize,
  softWrap,
  viewed,
  onViewedChange,
  onAddComment,
  onDeleteComment,
  onReplyComment,
  onSetCommentStatus,
}: FileDiffCardProps) {
  const [pending, setPending] = useState<PendingComment | null>(null)

  const getLineContent = (side: AnnotationSide, lineNumber: number): string => {
    const lines = side === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines
    // Full (non-partial) diffs carry the entire file, so any line — including
    // expanded context outside hunks — can be addressed directly.
    if (!fileDiff.isPartial) {
      return lines[lineNumber - 1] ?? ''
    }
    const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
    const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
    const indexKey = side === 'additions' ? 'additionLineIndex' : 'deletionLineIndex'
    for (const hunk of fileDiff.hunks) {
      const start = hunk[startKey]
      const count = hunk[countKey]
      if (lineNumber >= start && lineNumber < start + count) {
        const index = hunk[indexKey] + (lineNumber - start)
        return lines[index] ?? ''
      }
    }
    return ''
  }

  // Two kinds of comments can't be shown at their line, so they render pinned
  // at the top of the file card (GitHub-style) instead of being handed to the
  // diff component, which silently drops them:
  //  - outdated: the stored lineContent no longer matches — the code changed
  //    after the comment was written;
  //  - unchanged-line: the comment sits on a context line this diff doesn't
  //    modify, and the diff component only hosts bubbles on +/- lines.
  const detachReason = (a: DiffLineAnnotation<ReviewComment>): string | null => {
    const current = getLineContent(a.side, a.lineNumber)
    if (current.trimEnd() !== a.metadata.lineContent.trimEnd()) {
      return 'the code here changed after this comment was written'
    }
    if (changedLines && !changedLines[a.side].has(a.lineNumber)) {
      return 'this diff does not modify this line'
    }
    return null
  }
  const detached = annotations
    .map((a) => ({ annotation: a, reason: detachReason(a) }))
    .filter((d): d is { annotation: DiffLineAnnotation<ReviewComment>; reason: string } => d.reason !== null)
  const anchored = annotations.filter((a) => !detached.some((d) => d.annotation === a))

  const allAnnotations: DiffLineAnnotation<ReviewComment | { _pending: true }>[] = [
    ...anchored,
    ...(pending
      ? [
          {
            side: pending.side,
            lineNumber: pending.lineNumber,
            metadata: { _pending: true as const },
          },
        ]
      : []),
  ]

  return (
    <div className={`file-diff-card ${viewed ? 'file-diff-viewed' : ''}`} id={id}>
      {viewed ? (
        <div className="file-diff-viewed-header">
          <span className="file-diff-viewed-name">{filePath}</span>
          <label className="viewed-label viewed-checked" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={viewed}
              onChange={(e) => onViewedChange(filePath, e.target.checked)}
            />
            Viewed
          </label>
        </div>
      ) : (
        <>
          {detached.length > 0 && (
            <div className="outdated-comments">
              {detached.map(({ annotation, reason }) => (
                <div key={annotation.metadata.id}>
                  <div className="outdated-comments-header">
                    Line {annotation.lineNumber} — {reason}:
                  </div>
                  <CommentBubble
                    comment={annotation.metadata}
                    onDelete={onDeleteComment}
                    onReply={onReplyComment}
                    onSetStatus={onSetCommentStatus}
                  />
                </div>
              ))}
            </div>
          )}
          <FileDiff<ReviewComment | { _pending: true }>
            fileDiff={fileDiff}
            options={{
              diffStyle,
              stickyHeader: true,
              expansionLineCount: 20,
              enableGutterUtility: true,
              theme: { dark: 'github-dark', light: 'github-light' },
              themeType: 'system',
              overflow: softWrap ? 'wrap' : 'scroll',
              unsafeCSS: `:host { --diffs-tab-size: ${tabSize}; }`,
            }}
            lineAnnotations={allAnnotations}
            renderHeaderMetadata={() => (
              <label className="viewed-label" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={viewed}
                  onChange={(e) => onViewedChange(filePath, e.target.checked)}
                />
                Viewed
              </label>
            )}
            renderAnnotation={(annotation) => {
              if ('_pending' in annotation.metadata) {
                return (
                  <CommentForm
                    onSubmit={(body) => {
                      const lineContent = getLineContent(pending!.side, pending!.lineNumber)
                      onAddComment(filePath, pending!.side, pending!.lineNumber, lineContent, body)
                      setPending(null)
                    }}
                    onCancel={() => setPending(null)}
                  />
                )
              }
              return (
                <CommentBubble
                  comment={annotation.metadata as ReviewComment}
                  onDelete={onDeleteComment}
                  onReply={onReplyComment}
                  onSetStatus={onSetCommentStatus}
                />
              )
            }}
            renderGutterUtility={(getHoveredLine) => (
              <button
                className="gutter-add-btn"
                onClick={() => {
                  const line = getHoveredLine()
                  if (line) {
                    setPending({ side: line.side, lineNumber: line.lineNumber })
                  }
                }}
              >
                +
              </button>
            )}
          />
        </>
      )}
    </div>
  )
})
