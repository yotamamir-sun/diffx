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
  /**
   * 'suggested' = the agent believes it addressed the comment; only the
   * reviewer can turn that into 'resolved' (or reopen it).
   */
  status: 'open' | 'suggested' | 'resolved'
  /** Legacy field from older servers; 'agent' is read as status 'suggested'. */
  resolvedBy?: 'user' | 'agent'
  createdAt: number
  replies: CommentReply[]
}
