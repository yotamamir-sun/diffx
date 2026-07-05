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
  createdAt: number
  replies: CommentReply[]
}
