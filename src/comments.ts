import type { ReviewComment, CommentReply } from './types.js'

/** Fields accepted by CommentStore.update. resolvedBy: null clears (reopen). */
export interface CommentUpdate {
  body?: string
  status?: ReviewComment['status']
  resolvedBy?: ReviewComment['resolvedBy'] | null
}

export interface CommentStore {
  getAll(): Promise<ReviewComment[]>
  add(comment: ReviewComment): Promise<ReviewComment>
  update(id: string, fields: CommentUpdate): Promise<ReviewComment | null>
  remove(id: string): Promise<boolean>
  addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null>
}

export class InMemoryCommentStore implements CommentStore {
  private comments: ReviewComment[] = []

  async getAll(): Promise<ReviewComment[]> {
    return this.comments
  }

  async add(comment: ReviewComment): Promise<ReviewComment> {
    this.comments.push(comment)
    return comment
  }

  async update(id: string, fields: CommentUpdate): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === id)
    if (!comment) return null
    if (fields.body !== undefined) comment.body = fields.body
    if (fields.status !== undefined) comment.status = fields.status
    if (fields.resolvedBy !== undefined) {
      if (fields.resolvedBy === null) delete comment.resolvedBy
      else comment.resolvedBy = fields.resolvedBy
    }
    return comment
  }

  async remove(id: string): Promise<boolean> {
    const index = this.comments.findIndex((c) => c.id === id)
    if (index === -1) return false
    this.comments.splice(index, 1)
    return true
  }

  async addReply(commentId: string, reply: CommentReply): Promise<ReviewComment | null> {
    const comment = this.comments.find((c) => c.id === commentId)
    if (!comment) return null
    comment.replies.push(reply)
    return comment
  }
}
