import { useState, useEffect } from 'react'
import { UserCircle, CheckCircle2, Bot, RotateCcw } from 'lucide-react'
import type { ReviewComment } from '../../types'
import { timeAgo } from '../utils'
import { ReplyForm } from './ReplyForm'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
  onReply?: (id: string, body: string) => void
  onSetStatus?: (id: string, status: ReviewComment['status']) => void
}

export function CommentBubble({ comment, onDelete, onReply, onSetStatus }: CommentBubbleProps) {
  const [, setTick] = useState(0)
  const isResolved = comment.status === 'resolved'

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className={`comment-bubble ${isResolved ? 'comment-resolved' : ''}`} id={`comment-${comment.id}`}>
      <div className="comment-bubble-header">
        <UserCircle size={18} className="comment-bubble-avatar" />
        <span className="comment-bubble-time">{timeAgo(comment.createdAt)}</span>
        {isResolved && (
          <span className="comment-bubble-resolved">
            <CheckCircle2 size={14} />
            Resolved
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
      <div className="comment-bubble-body">{comment.body}</div>
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
