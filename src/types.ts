export interface CommentReply {
  id: string
  body: string
  createdAt: number
  /** Who wrote the reply. Absent on replies from older clients — treat as 'agent'. */
  author?: 'user' | 'agent'
}

export interface ReviewComment {
  id: string
  filePath: string
  side: 'deletions' | 'additions'
  lineNumber: number
  lineContent: string
  body: string
  status: 'open' | 'resolved'
  /** Who resolved it. Absent on open comments and on data from older servers. */
  resolvedBy?: 'user' | 'agent'
  createdAt: number
  replies: CommentReply[]
}
