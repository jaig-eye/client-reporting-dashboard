'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One save pattern for admin settings screens.
 *
 * - Instant controls (toggles, segmented controls, selects, blur-saved inputs)
 *   route every write through `useSaveStatus().run(...)` and render
 *   <SaveStatus> in the card header.
 * - Form cards keep an explicit "Save changes" button, disabled until dirty,
 *   with <SaveStatus dirty={dirty}> beside it.
 *
 * The function passed to `run` should own the whole attempt: apply the
 * optimistic value, perform the request, and restore the previous value before
 * re-throwing if it fails. That keeps the UI honest on failure and makes
 * "try again" a faithful replay of the attempt.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SAVED_VISIBLE_MS = 2000

export function useSaveStatus() {
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastAttempt, setLastAttempt] = useState<(() => Promise<unknown>) | null>(null)

  // Rapid instant edits overlap; only the most recent attempt drives the status.
  const seq     = useRef(0)
  const timer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const run = useCallback(async (attempt: () => Promise<unknown>): Promise<boolean> => {
    const id = ++seq.current
    if (timer.current) clearTimeout(timer.current)
    setState('saving')
    setError(null)
    setLastAttempt(null)
    try {
      await attempt()
      if (!mounted.current || id !== seq.current) return true
      setState('saved')
      timer.current = setTimeout(() => {
        if (mounted.current && id === seq.current) setState('idle')
      }, SAVED_VISIBLE_MS)
      return true
    } catch (err) {
      if (!mounted.current || id !== seq.current) return false
      setState('error')
      setError(err instanceof Error ? err.message : String(err))
      setLastAttempt(() => attempt)
      return false
    }
  }, [])

  const retry = lastAttempt ? () => { void run(lastAttempt) } : undefined

  const reset = useCallback(() => {
    seq.current++
    if (timer.current) clearTimeout(timer.current)
    setState('idle')
    setError(null)
    setLastAttempt(null)
  }, [])

  return { state, error, saving: state === 'saving', run, retry, reset }
}

/** fetch() that throws on a non-2xx response, using the API's `error` message when present. */
export async function requestJson<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
    body:    json !== undefined ? JSON.stringify(json) : rest.body,
  })
  let data: unknown = null
  try { data = await res.json() } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const msg = data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
      ? (data as { error: string }).error
      : `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data as T
}

export default function SaveStatus({
  state,
  error,
  retry,
  dirty = false,
  className,
}: {
  state:      SaveState
  error?:     string | null
  retry?:     () => void
  /** Form cards: show "Unsaved changes" while edits are pending. */
  dirty?:     boolean
  className?: string
}) {
  // Precedence: an in-flight save, then a failure (it needs action), then
  // pending edits, then the transient confirmation.
  const view = state === 'saving' ? 'saving'
    : state === 'error' ? 'error'
    : dirty ? 'dirty'
    : state === 'saved' ? 'saved'
    : 'idle'

  return (
    // Always mounted so screen readers pick up each change politely.
    <span
      role="status"
      aria-live="polite"
      className={`save-status save-status--${view}${className ? ` ${className}` : ''}`}
    >
      {view === 'saving' && (
        <>
          <span className="save-status__spinner" aria-hidden="true" />
          Saving…
        </>
      )}
      {view === 'saved' && (
        // Mounts fresh each time a save completes (it replaces "Saving…"), so
        // the fade restarts for every save.
        <span className="save-status__saved">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Saved
        </span>
      )}
      {view === 'dirty' && (
        <>
          <span className="save-status__dot" aria-hidden="true" />
          Unsaved changes
        </>
      )}
      {view === 'error' && (
        <span title={error ?? undefined}>
          Couldn&apos;t save —{' '}
          {retry ? (
            <button type="button" className="save-status__retry" onClick={retry}>try again</button>
          ) : 'try again'}
        </span>
      )}
    </span>
  )
}
