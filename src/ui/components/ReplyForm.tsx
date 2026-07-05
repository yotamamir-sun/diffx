import { useState } from 'react'

interface ReplyFormProps {
  onSubmit: (body: string) => void
}

export function ReplyForm({ onSubmit }: ReplyFormProps) {
  const [body, setBody] = useState('')

  const handleSubmit = () => {
    const trimmed = body.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setBody('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="reply-form">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Reply…"
        rows={body ? 3 : 1}
      />
      {body.trim() && (
        <div className="reply-form-actions">
          <button className="btn btn-primary" onClick={handleSubmit}>
            Reply
          </button>
        </div>
      )}
    </div>
  )
}
