'use client'

// PaymentNotifier — subscribes to Supabase Realtime INSERT events on ad_fuel_ledger.
// When a Stripe payment is processed (row inserted), plays the agency's uploaded
// payment sound and shows a brief banner notification in the admin browser.
//
// Browser autoplay policy: audio requires prior user interaction to play.
// On first blocked attempt the banner appears anyway; audio will play on subsequent
// payments after the user has interacted with the page.

import { useEffect, useRef, useState } from 'react'
import { createClient }                from '@/lib/supabase/client'

interface NewPayment {
  client_id:       string
  amount_af:       number
  note:            string | null
  type:            string | null
  date_of_payment: string | null
}

export default function PaymentNotifier({ soundUrl }: { soundUrl?: string | null }) {
  const [notification, setNotification] = useState<{ amount: number; note: string | null } | null>(null)
  const audioCtxRef    = useRef<AudioContext | null>(null)
  const timeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Synthesised fallback chime ─────────────────────────────────────────
  function playSynthChime() {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') ctx.resume()

      const notes = [880, 1108, 1318] // A5 · C#6 · E6
      notes.forEach((freq, i) => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.value = freq
        const t = ctx.currentTime + i * 0.12
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.22, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
        osc.start(t); osc.stop(t + 0.45)
      })
    } catch { /* blocked — banner still shows */ }
  }

  // ── Uploaded MP3 playback ──────────────────────────────────────────────
  async function playUploadedSound(url: string) {
    try {
      const audio = new Audio(url)
      audio.volume = 0.8
      await audio.play()
    } catch {
      playSynthChime() // fall back to synth if autoplay blocked
    }
  }

  function showBanner(amount: number, note: string | null) {
    setNotification({ amount, note })
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setNotification(null), 6000)
  }

  // ── Supabase Realtime subscription ────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('payment-notifier')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ad_fuel_ledger' },
        (payload) => {
          const row = payload.new as NewPayment
          const amount = Number(row.amount_af ?? 0)
          if (amount <= 0) return

          if (soundUrl) {
            playUploadedSound(soundUrl)
          } else {
            playSynthChime()
          }
          showBanner(amount, row.note ?? null)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundUrl])

  if (!notification) return null

  const fmtAmt = `$${notification.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const label  = notification.note
    ? notification.note.replace(/^(Stripe|stripe)\s*[-–—]?\s*/i, '').slice(0, 60)
    : null

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position:     'fixed',
        bottom:       24,
        right:        24,
        zIndex:       9999,
        display:      'flex',
        alignItems:   'center',
        gap:          12,
        background:   'var(--bg-surface, #fff)',
        border:       '1px solid var(--border)',
        borderLeft:   '4px solid #16a34a',
        borderRadius: 10,
        padding:      '12px 16px',
        boxShadow:    '0 8px 32px rgba(0,0,0,0.14)',
        minWidth:     260,
        maxWidth:     360,
        animation:    'slideInRight 0.25s ease-out',
      }}
    >
      <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>💰</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9375rem', color: '#16a34a' }}>
          Payment received — {fmtAmt}
        </p>
        {label && (
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </p>
        )}
      </div>
      <button
        onClick={() => setNotification(null)}
        aria-label="Dismiss"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '1rem', flexShrink: 0, padding: 0, lineHeight: 1 }}
      >
        ✕
      </button>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
