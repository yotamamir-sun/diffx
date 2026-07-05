import { useState } from 'react'
import {
  MessageSquare,
  CheckCircle2,
  Reply,
  Circle,
  ChevronRight,
  ChevronDown,
  UserCircle,
  Bot,
  RotateCcw,
} from 'lucide-react'
import type { ReviewComment } from '../../types'
import { timeAgo, truncate, fileName, commentStatus } from '../utils'
import { ReplyForm } from './ReplyForm'

interface CommentTrackerProps {
  comments: ReviewComment[]
  /** Resolves false when the comment couldn't be shown inline (outdated). */
  onCommentClick: (comment: ReviewComment) => Promise<boolean> | void
  onReply: (id: string, body: string) => void
  onSetStatus: (id: string, status: ReviewComment['status']) => void
}

type CommentStatus = 'open' | 'replied' | 'suggested' | 'resolved'

function getCommentStatus(comment: ReviewComment): CommentStatus {
  const status = commentStatus(comment)
  if (status === 'open' && comment.replies?.length > 0) return 'replied'
  return status
}

function StatusBadge({ status }: { status: CommentStatus }) {
  switch (status) {
    case 'open':
      return (
        <span className="ct-status ct-status-open" title="Open">
          <Circle size={12} />
        </span>
      )
    case 'replied':
      return (
        <span className="ct-status ct-status-replied" title="Replied">
          <Reply size={12} />
        </span>
      )
    case 'suggested':
      // The agent believes it addressed this; the reviewer confirms or
      // reopens, so it stays visually loud until then.
      return (
        <span className="ct-status ct-status-suggested" title="Suggested resolved — confirm or reopen">
          <Bot size={12} />
        </span>
      )
    case 'resolved':
      return (
        <span className="ct-status ct-status-resolved" title="Resolved">
          <CheckCircle2 size={12} />
        </span>
      )
  }
}

export function CommentTracker({ comments, onCommentClick, onReply, onSetStatus }: CommentTrackerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (comments.length === 0) return null

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sorted = [...comments].sort((a, b) => b.createdAt - a.createdAt)

  const openCount = sorted.filter((c) => getCommentStatus(c) === 'open').length
  const repliedCount = sorted.filter((c) => getCommentStatus(c) === 'replied').length
  const suggestedCount = sorted.filter((c) => getCommentStatus(c) === 'suggested').length
  const resolvedCount = sorted.filter((c) => getCommentStatus(c) === 'resolved').length

  return (
    <div className="ct">
      <div className="ct-header">
        <MessageSquare size={14} />
        <span className="ct-title">Comments</span>
        <span className="ct-counts">
          {openCount > 0 && <span className="ct-count ct-count-open">{openCount} open</span>}
          {repliedCount > 0 && <span className="ct-count ct-count-replied">{repliedCount} replied</span>}
          {suggestedCount > 0 && (
            <span className="ct-count ct-count-suggested">{suggestedCount} suggested</span>
          )}
          {resolvedCount > 0 && <span className="ct-count ct-count-resolved">{resolvedCount} resolved</span>}
        </span>
      </div>
      <ul className="ct-list">
        {sorted.map((comment) => {
          const status = getCommentStatus(comment)
          const isExpanded = expanded.has(comment.id)
          return (
            <li
              key={comment.id}
              // Only reviewer-confirmed resolutions dim; suggestions await review.
              className={`ct-item ${status === 'resolved' ? 'ct-item-resolved' : ''}`}
            >
              <div className="ct-item-row">
                {/* The thread is fully readable here even when the comment
                    can no longer anchor to a diff line (outdated comment). */}
                <button
                  type="button"
                  className="ct-item-expand"
                  onClick={() => toggleExpanded(comment.id)}
                  title={isExpanded ? 'Collapse thread' : 'Expand thread'}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {/* A plain #comment-<id> anchor can't be trusted here: the
                    bubble may be unmounted (virtualized out, or its file is
                    marked Viewed), and re-clicking the same hash is a no-op.
                    Navigation is handled imperatively in App instead. */}
                <button
                  type="button"
                  onClick={() => {
                    // If the comment can't be shown inline (outdated — its
                    // line no longer exists in the diff), open the thread
                    // right here so the click always shows the comment.
                    Promise.resolve(onCommentClick(comment)).then((anchored) => {
                      if (anchored === false) {
                        setExpanded((prev) => new Set(prev).add(comment.id))
                      }
                    })
                  }}
                  className="ct-item-link"
                >
                  <div className="ct-item-header">
                    <StatusBadge status={status} />
                    <span className="ct-item-file" title={comment.filePath}>
                      {fileName(comment.filePath)}:{comment.lineNumber}
                    </span>
                    <span className="ct-item-time">{timeAgo(comment.createdAt)}</span>
                  </div>
                  {!isExpanded && <div className="ct-item-body">{truncate(comment.body, 80)}</div>}
                </button>
              </div>
              {isExpanded && (
                <div className="ct-thread">
                  <div className="ct-thread-entry">
                    <div className="ct-thread-entry-header">
                      <UserCircle size={14} className="comment-bubble-avatar" />
                      <span className="ct-item-time">{timeAgo(comment.createdAt)}</span>
                    </div>
                    <div className="ct-thread-body">{comment.body}</div>
                  </div>
                  {comment.replies?.map((reply) => (
                    <div key={reply.id} className="ct-thread-entry">
                      <div className="ct-thread-entry-header">
                        {reply.author === 'user' ? (
                          <UserCircle size={14} className="comment-bubble-avatar" />
                        ) : (
                          <Bot size={14} className="comment-reply-avatar" />
                        )}
                        <span className="ct-item-time">{timeAgo(reply.createdAt)}</span>
                      </div>
                      <div className="ct-thread-body">{reply.body}</div>
                    </div>
                  ))}
                  <div className="ct-thread-actions">
                    {status !== 'open' && status !== 'replied' && (
                      <button
                        type="button"
                        className="ct-thread-status-btn"
                        onClick={() => onSetStatus(comment.id, 'open')}
                      >
                        <RotateCcw size={12} /> Reopen
                      </button>
                    )}
                    {status !== 'resolved' && (
                      <button
                        type="button"
                        className="ct-thread-status-btn ct-thread-resolve"
                        onClick={() => onSetStatus(comment.id, 'resolved')}
                      >
                        <CheckCircle2 size={12} /> {status === 'suggested' ? 'Confirm resolve' : 'Resolve'}
                      </button>
                    )}
                  </div>
                  <ReplyForm onSubmit={(body) => onReply(comment.id, body)} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
