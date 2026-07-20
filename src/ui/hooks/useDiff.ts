import { useState, useEffect, useCallback } from 'react'

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

interface DiffData {
  patch: string
  repoName: string
  branch: string
  customMode: boolean
  binaryFiles: BinaryFileInfo[]
  tabSizeMap: Record<string, number>
  untrackedFiles: string[]
  digest?: string
}

export interface DiffOptions {
  staged: boolean
  untracked: boolean
}

const DIGEST_POLL_MS = 3000

export function useDiff(options: DiffOptions) {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [liveDigest, setLiveDigest] = useState<string | null>(null)

  const query = `staged=${options.staged}&untracked=${options.untracked}`

  const fetchDiff = useCallback(
    ({ initial }: { initial: boolean }) => {
      if (initial) {
        setLoading(true)
        setError(null)
      }
      return fetch(`/api/diff?${query}`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        })
        .then((json) => setData(json))
        .catch((err) => {
          // A failed background refresh keeps the loaded diff (and the stale
          // pill, so the user can retry); only the initial load surfaces it.
          if (initial) setError(err.message)
        })
        .finally(() => {
          if (initial) setLoading(false)
        })
    },
    [query],
  )

  useEffect(() => {
    void fetchDiff({ initial: true })
  }, [fetchDiff])

  // Poll a fingerprint of the diff so edits to the working tree surface
  // without the user having to know to reload the tab.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return
      fetch(`/api/diff-digest?${query}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json?.digest) setLiveDigest(json.digest)
        })
        .catch(() => {
          // Server briefly unreachable (restart) — keep the last known state.
        })
    }, DIGEST_POLL_MS)
    return () => window.clearInterval(id)
  }, [query])

  // Derived, so a completed refresh (data.digest catches up) clears it with
  // no flag juggling. Undefined data.digest = pre-digest server; never stale.
  const stale = data?.digest != null && liveDigest != null && liveDigest !== data.digest

  const refresh = useCallback(() => fetchDiff({ initial: false }), [fetchDiff])

  return {
    patch: data?.patch ?? null,
    repoName: data?.repoName ?? '',
    branch: data?.branch ?? '',
    customMode: data?.customMode ?? false,
    binaryFiles: data?.binaryFiles ?? [],
    tabSizeMap: data?.tabSizeMap ?? {},
    untrackedFiles: data?.untrackedFiles ?? [],
    loading,
    error,
    stale,
    refresh,
  }
}
