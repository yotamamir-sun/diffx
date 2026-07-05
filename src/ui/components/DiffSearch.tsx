import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { fileName } from '../utils'

export interface DiffLineRecord {
  filePath: string
  side: 'additions' | 'deletions'
  lineNumber: number
  text: string
}

interface DiffSearchProps {
  lines: DiffLineRecord[]
  onNavigate: (record: DiffLineRecord) => void
}

const MAX_RESULTS = 200

// Content search over the whole diff. The browser's native find can't do
// this: rows far from the viewport are virtualized (no layout) and the code
// lives in shadow DOM, so Ctrl+F only ever sees a sliver of the diff.
export function DiffSearch({ lines, onNavigate }: DiffSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setOpen(true)
        window.setTimeout(() => inputRef.current?.select(), 0)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const out: DiffLineRecord[] = []
    for (const record of lines) {
      if (record.text.toLowerCase().includes(q)) {
        out.push(record)
        if (out.length >= MAX_RESULTS) break
      }
    }
    return out
  }, [query, lines])

  if (!open) {
    return (
      <button
        type="button"
        className="diff-search-toggle"
        title="Search in diff (⌘F)"
        onClick={() => {
          setOpen(true)
          window.setTimeout(() => inputRef.current?.focus(), 0)
        }}
      >
        <Search size={14} />
      </button>
    )
  }

  const q = query.trim().toLowerCase()

  const renderSnippet = (text: string) => {
    const idx = text.toLowerCase().indexOf(q)
    if (idx < 0) return <span>{text.slice(0, 90)}</span>
    const start = Math.max(0, idx - 30)
    return (
      <span>
        {(start > 0 ? '…' : '') + text.slice(start, idx)}
        <mark>{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length, idx + q.length + 60)}
      </span>
    )
  }

  return (
    <div className="diff-search-panel">
      <div className="diff-search-bar">
        <Search size={14} className="diff-search-icon" />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length > 0) onNavigate(results[0])
          }}
          placeholder="Search all file diffs…"
        />
        <button type="button" className="diff-search-close" onClick={() => setOpen(false)} title="Close (Esc)">
          <X size={14} />
        </button>
      </div>
      {q.length >= 2 && (
        <div className="diff-search-results">
          {results.length === 0 && <div className="diff-search-empty">No matches</div>}
          {results.map((r, i) => (
            <button
              type="button"
              key={`${r.filePath}-${r.side}-${r.lineNumber}-${i}`}
              className="diff-search-result"
              onClick={() => onNavigate(r)}
            >
              <span className={`diff-search-line ${r.side === 'deletions' ? 'diff-search-del' : ''}`}>
                {fileName(r.filePath)}:{r.lineNumber}
                {r.side === 'deletions' ? ' (removed)' : ''}
              </span>
              <span className="diff-search-snippet">{renderSnippet(r.text)}</span>
            </button>
          ))}
          {results.length >= MAX_RESULTS && (
            <div className="diff-search-empty">Showing first {MAX_RESULTS} matches — refine the query</div>
          )}
        </div>
      )}
    </div>
  )
}
