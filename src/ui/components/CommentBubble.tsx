import { useState, useEffect } from 'react'
import { UserCircle, CheckCircle2, Bot, RotateCcw, Pencil } from 'lucide-react'
import type { ReviewComment } from '../../types'
import { timeAgo } from '../utils'
import { ReplyForm } from './ReplyForm'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
  onReply?: (id: string, body: string) => void
  onSetStatus?: (id: string, status: ReviewComment['status']) => void
  onEdit?: (id: string, body: string) => void
}

export function CommentBubble({ comment, onDelete, onReply, onSetStatus, onEdit }: CommentBubbleProps) {
  const [, setTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const isResolved = comment.status === 'resolved'

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div
      // Agent-resolved bubbles keep full prominence — the reviewer still
      // needs to check what was done; only self-resolved ones fade.
      className={`comment-bubble ${isResolved && comment.resolvedBy !== 'agent' ? 'comment-resolved' : ''}`}
      id={`comment-${comment.id}`}
    >
      <div className="comment-bubble-header">
        <UserCircle size={18} className="comment-bubble-avatar" />
        <span className="comment-bubble-time">{timeAgo(comment.createdAt)}</span>
        {isResolved && (
          <span
            className={`comment-bubble-resolved ${comment.resolvedBy === 'agent' ? 'comment-resolved-by-agent' : ''}`}
          >
            {comment.resolvedBy === 'agent' ? <Bot size={14} /> : <CheckCircle2 size={14} />}
            {comment.resolvedBy === 'agent'
              ? 'Resolved by agent'
              : comment.resolvedBy === 'user'
                ? 'Resolved by you'
                : 'Resolved'}
          </span>
        )}
        {isResolved && onSetStatus && (
          <button
            className="comment-bubble-action"
            onClick={() => onSetStatus(comment.id, 'open')}
            title="Reopen comment"
          >
            <RotateCcw size={13} />
          </button>
        )}
        {!isResolved && onSetStatus && (
          <button
            className="comment-bubble-action comment-bubble-resolve"
            onClick={() => onSetStatus(comment.id, 'resolved')}
            title="Mark as resolved"
          >
            <CheckCircle2 size={14} />
            Resolve
          </button>
        )}
        {!isResolved && onEdit && !editing && (
          <button
            className="comment-bubble-action"
            onClick={() => {
              setDraft(comment.body)
              setEditing(true)
            }}
            title="Edit comment"
          >
            <Pencil size={13} />
          </button>
        )}
        {!isResolved && (
          <button
            className="comment-bubble-delete"
            onClick={() => onDelete(comment.id)}
            title="Delete comment"
          >
            &times;
          </button>
        )}
      </div>
      {editing ? (
        <div className="comment-form comment-edit-form">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus />
          <div className="comment-form-actions">
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={!draft.trim()}
              onClick={() => {
                onEdit?.(comment.id, draft.trim())
                setEditing(false)
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="comment-bubble-body">{comment.body}</div>
      )}
      {comment.replies?.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="comment-reply">
              <div className="comment-reply-header">
                {reply.author === 'user' ? (
                  <UserCircle size={16} className="comment-bubble-avatar" />
                ) : (
                  <Bot size={16} className="comment-reply-avatar" />
                )}
                <span className="comment-bubble-time">{timeAgo(reply.createdAt)}</span>
              </div>
              <div className="comment-reply-body">{reply.body}</div>
            </div>
          ))}
        </div>
      )}
      {onReply && <ReplyForm onSubmit={(body) => onReply(comment.id, body)} />}
    </div>
  )
}
