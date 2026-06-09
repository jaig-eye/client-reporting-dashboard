'use client'

// PaymentNotifier — plays a sound and shows a native browser notification
// whenever a Stripe payment lands, regardless of invoice type.
//
// Data path: Stripe webhook → payment_notifications (INSERT) → Supabase Realtime
//   → this component → audio + native Notification + in-app banner.
//
// Background tabs (Chrome):
//   The native Notification API fires even when the browser window is in the
//   background or minimised, provided the user has granted permission and the
//   AudioContext was primed by clicking the "🔊 Arm sounds" button at least once.
//
// Design note — stable Realtime subscription:
//   `fireNotification` must NOT depend on frequently-changing state (soundState,
//   notifPerm), or every state change would trigger a subscription teardown/
//   re-subscribe cycle that could drop an in-flight Realtime event.
//   Solution: shadow mutable state in refs; the subscription effect depends only
//   on `soundUrl` (changes rarely), keeping the channel alive across state changes.

import { useEffect, useRef, useState } from 'react'
import { createClient }                from '@/lib/supabase/client'

interface PaymentRow {
  amount:         number
  currency:       string
  description:    string | null
  customer_email: string | null
  client_name:    string | null
}

type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported'
type SoundState      = 'unarmed' | 'armed' | 'playing'

export default function PaymentNotifier({ soundUrl }: { soundUrl?: string | null }) {
  const [banner,     setBanner]     = useState<PaymentRow | null>(null)
  const [soundState, setSoundState] = useState<SoundState>('unarmed')
  const [notifPerm,  setNotifPerm]  = useState<NotifPermission>('default')

  // ── Refs that shadow state — used inside stable callbacks ─────────────
  // Reading state inside a useCallback/useEffect with stable deps would give
  // stale values; refs are always current without triggering re-subscriptions.
  const soundStateRef = useRef<SoundState>('unarmed')
  const notifPermRef  = useRef<NotifPermission>('default')
  const soundUrlRef   = useRef<string | null | undefined>(soundUrl)

  useEffect(() => { soundStateRef.current = soundState }, [soundState])
  useEffect(() => { notifPermRef.current  = notifPerm  }, [notifPerm])
  useEffect(() => { soundUrlRef.current   = soundUrl   }, [soundUrl])

  const audioCtxRef = useRef<AudioContext | null>(null)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Check Notification permission on mount ────────────────────────────
  useEffect(() => {
    if (!('Notification' in window)) {
      setNotifPerm('unsupported')
      notifPermRef.current = 'unsupported'
    } else {
      const perm = Notification.permission as NotifPermission
      setNotifPerm(perm)
      notifPermRef.current = perm
    }
  }, [])

  // ── Request Notification permission ──────────────────────────────────
  async function requestNotifPermission() {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    setNotifPerm(result as NotifPermission)
    notifPermRef.current = result as NotifPermission
  }

  // ── Arm AudioContext (requires user gesture) ──────────────────────────
  function armAudio() {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext()
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume()
      }
      setSoundState('armed')
      soundStateRef.current = 'armed'
    } catch {
      // AudioContext not available
    }
    if (notifPermRef.current === 'default') requestNotifPermission()
  }

  // ── Synthesised fallback chime ────────────────────────────────────────
  function playSynthChime() {
    const ctx = audioCtxRef.current
    if (!ctx || ctx.state === 'suspended') return

    const notes = [880, 1108, 1318]
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.13
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.22, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.48)
      osc.start(t); osc.stop(t + 0.48)
    })
  }

  // ── Play uploaded sound ───────────────────────────────────────────────
  async function playUploadedSound(url: string) {
    try {
      if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume()
      }
      const audio = new Audio(url)
      audio.volume = 0.75
      await audio.play()
    } catch {
      playSynthChime()
    }
  }

  // ── Stable fire-notification handler — reads from refs, not state ─────
  // This function is intentionally NOT wrapped in useCallback with state deps.
  // It reads soundStateRef / notifPermRef / soundUrlRef instead of their
  // corresponding state values, which means:
  //   (a) it is always current without triggering re-renders, and
  //   (b) the Realtime subscription useEffect never needs to re-subscribe
  //       just because the user armed sounds or a notification fired.
  // See: https://react.dev/learn/separating-events-from-effects#extracting-non-reactive-logic-out-of-effects
  const fireNotification = useRef((row: PaymentRow) => {
    const currentSound  = soundStateRef.current
    const currentPerm   = notifPermRef.current
    const currentUrl    = soundUrlRef.current

    const fmtAmt = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: (row.currency ?? 'usd').toUpperCase(),
    }).format(Number(row.amount ?? 0))

    const title = `Payment received — ${fmtAmt}`
    const body  = [row.client_name, row.description].filter(Boolean).join(' · ') || row.customer_email || ''

    // 1. Native Notification — works in background / minimised window
    if (currentPerm === 'granted' && 'Notification' in window) {
      try {
        new Notification(title, {
          body,
          icon:   '/favicon.ico',
          tag:    'stripe-payment',
          silent: currentSound === 'armed',
        })
      } catch { /* blocked or isolated tab */ }
    }

    // 2. In-app banner
    setBanner(row)
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(null), 7000)

    // 3. Audio
    if (currentSound === 'armed') {
      setSoundState('playing')
      soundStateRef.current = 'playing'
      const done = () => { setSoundState('armed'); soundStateRef.current = 'armed' }
      if (currentUrl) {
        playUploadedSound(currentUrl).finally(done)
      } else {
        playSynthChime()
        setTimeout(done, 600)
      }
    }
  })

  // Keep the ref's inner function up-to-date each render so it captures
  // the latest `playUploadedSound` and `playSynthChime` closures.
  useEffect(() => {
    fireNotification.current = (row: PaymentRow) => {
      const currentSound = soundStateRef.current
      const currentPerm  = notifPermRef.current
      const currentUrl   = soundUrlRef.current

      const fmtAmt = new Intl.NumberFormat('en-US', {
        style: 'currency', currency: (row.currency ?? 'usd').toUpperCase(),
      }).format(Number(row.amount ?? 0))

      const title = `Payment received — ${fmtAmt}`
      const body  = [row.client_name, row.description].filter(Boolean).join(' · ') || row.customer_email || ''

      if (currentPerm === 'granted' && 'Notification' in window) {
        try {
          new Notification(title, { body, icon: '/favicon.ico', tag: 'stripe-payment', silent: currentSound === 'armed' })
        } catch { /* blocked */ }
      }

      setBanner(row)
      if (bannerTimer.current) clearTimeout(bannerTimer.current)
      bannerTimer.current = setTimeout(() => setBanner(null), 7000)

      if (currentSound === 'armed') {
        setSoundState('playing')
        soundStateRef.current = 'playing'
        const done = () => { setSoundState('armed'); soundStateRef.current = 'armed' }
        if (currentUrl) {
          playUploadedSound(currentUrl).finally(done)
        } else {
          playSynthChime()
          setTimeout(done, 600)
        }
      }
    }
  })  // runs every render — deliberately no dep array so the closure is always fresh

  // ── Supabase Realtime subscription ────────────────────────────────────
  // Depends ONLY on the channel identity, not on soundState/notifPerm.
  // This means the subscription is never torn down when the user arms audio
  // or when a notification fires — avoiding the dropped-payment race.
  useEffect(() => {
    const supabase = createClient()
    const channel  = supabase
      .channel('payment-notifier')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'payment_notifications' },
        (payload) => fireNotification.current(payload.new as PaymentRow)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (bannerTimer.current) clearTimeout(bannerTimer.current)
    }
  }, [])  // stable — never re-subscribes

  // ── Arm-button UI ──────────────────────────────────────────────────────
  const armLabel =
    soundState === 'playing' ? '🔊 Playing…'
    : soundState === 'armed' ? '🔊 Sounds on'
    : '🔔 Arm sounds'

  const armColor = soundState === 'armed' || soundState === 'playing' ? '#16a34a' : '#d97706'

  return (
    <>
      {/* Persistent arm button */}
      <button
        onClick={armAudio}
        title={
          soundState === 'armed'
            ? 'Sounds armed — payments will play audio'
            : 'Click to enable payment sounds (required for background audio)'
        }
        style={{
          position: 'fixed', bottom: 24, left: 24, zIndex: 9000,
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--bg-surface, #fff)', border: `1px solid ${armColor}`,
          borderRadius: 20, padding: '5px 12px',
          fontSize: '0.72rem', fontWeight: 600, color: armColor,
          cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
          transition: 'opacity 0.2s', opacity: soundState === 'armed' ? 0.7 : 1,
          userSelect: 'none', whiteSpace: 'nowrap',
        }}
      >
        {armLabel}
      </button>

      {/* In-app banner */}
      {banner && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'var(--bg-surface, #fff)', border: '1px solid var(--border)',
            borderLeft: '4px solid #16a34a', borderRadius: 10,
            padding: '12px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
            minWidth: 260, maxWidth: 380, animation: 'slideInRight 0.25s ease-out',
          }}
        >
          <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>💰</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9375rem', color: '#16a34a' }}>
              Payment received —{' '}
              {new Intl.NumberFormat('en-US', {
                style: 'currency', currency: (banner.currency ?? 'usd').toUpperCase(),
              }).format(Number(banner.amount ?? 0))}
            </p>
            {(banner.client_name || banner.description || banner.customer_email) && (
              <p style={{
                margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {[banner.client_name, banner.description ?? banner.customer_email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button
            onClick={() => setBanner(null)}
            aria-label="Dismiss"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '1rem', flexShrink: 0, padding: 0, lineHeight: 1 }}
          >✕</button>
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
