export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function truncate(text: string, maxLen: number): string {
  const firstLine = text.split('\n')[0]
  if (firstLine.length <= maxLen) return firstLine
  return firstLine.slice(0, maxLen) + '…'
}

export function fileName(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1]
}

/**
 * Effective comment status with legacy tolerance: older servers stored agent
 * resolutions as status 'resolved' + resolvedBy 'agent' — under the current
 * model those are suggestions awaiting the reviewer's confirmation.
 */
export function commentStatus(comment: {
  status: 'open' | 'suggested' | 'resolved'
  resolvedBy?: 'user' | 'agent'
}): 'open' | 'suggested' | 'resolved' {
  if (comment.status === 'resolved' && comment.resolvedBy === 'agent') return 'suggested'
  return comment.status
}
