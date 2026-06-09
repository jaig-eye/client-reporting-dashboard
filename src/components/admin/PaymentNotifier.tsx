'use client'

// PaymentNotifier — Supabase Realtime listener for payment_notifications INSERT.
// Plays a sound and shows a banner when any Stripe payment or ACH clearance lands.
//
// This component owns: Realtime subscription, audio playback, in-app banner.
// The arm button that enables audio lives in Sidebar → SoundToggle.
// SoundToggle stores the AudioContext on window.__paymentAudioCtx and sets
// localStorage 'payment-sound-armed' = 'true'.
//
// Multi-tab deduplication: uses localStorage 'payment-sound-last' to ensure
// only one tab plays the sound when multiple admin tabs are open.

import { useEffect, useRef, useState } from 'react'
import { createClient }                from '@/lib/supabase/client'

interface PaymentRow {
  amount:         number
  currency:       string
  description:    string | null
  customer_email: string | null
  client_name:    string | null
}

declare global {
  interface Window { __paymentAudioCtx?: AudioContext }
}

const STORAGE_ARMED = 'payment-sound-armed'
const STORAGE_LAST  = 'payment-sound-last'   // timestamp of last played sound (cross-tab dedup)
const DEDUP_MS      = 3000                    // ignore if another tab played within 3 s

export default function PaymentNotifier({ soundUrl }: { soundUrl?: string | null }) {
  const [banner,    setBanner]    = useState<PaymentRow | null>(null)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs shadow mutable values so the Realtime subscription never needs to
  // re-subscribe (avoiding the dropped-payment race on state change).
  const soundUrlRef = useRef<string | null | undefined>(soundUrl)
  useEffect(() => { soundUrlRef.current = soundUrl }, [soundUrl])

  // ── Synthesised chime (fallback if no upload or Audio fails) ────────────
  function playSynthChime() {
    const ctx = window.__paymentAudioCtx
    if (!ctx || ctx.state !== 'running') return
    const notes = [880, 1108, 1318]
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.13
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.22, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.48)
      osc.start(t); osc.stop(t + 0.48)
    })
  }

  async function playUploadedSound(url: string) {
    try {
      if (window.__paymentAudioCtx?.state === 'suspended') {
        await window.__paymentAudioCtx.resume()
      }
      const audio = new Audio(url)
      audio.volume = 0.75
      await audio.play()
    } catch {
      playSynthChime()
    }
  }

  // ── Stable fire handler — always reads from refs/window, never state ────
  const fireRef = useRef((row: PaymentRow) => {
    // Multi-tab deduplication: if another tab played within DEDUP_MS, skip audio
    const now  = Date.now()
    const last = Number(localStorage.getItem(STORAGE_LAST) ?? 0)
    const armed = localStorage.getItem(STORAGE_ARMED) === 'true'

    const fmtAmt = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: (row.currency ?? 'usd').toUpperCase(),
    }).format(Number(row.amount ?? 0))

    const title = `Payment received — ${fmtAmt}`
    const body  = [row.client_name, row.description].filter(Boolean).join(' · ') || row.customer_email || ''

    // Native browser notification (works in background / minimised)
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/favicon.ico', tag: 'stripe-payment', silent: !armed })
      } catch { /* isolated tab */ }
    }

    // In-app banner
    setBanner(row)
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(null), 7000)

    // Audio — only when armed AND this tab wins the dedup race
    if (armed && now - last > DEDUP_MS) {
      localStorage.setItem(STORAGE_LAST, String(now))
      const url = soundUrlRef.current
      if (url) {
        playUploadedSound(url)
      } else {
        playSynthChime()
      }
    }
  })

  // Keep the ref's closure fresh on every render
  useEffect(() => {
    fireRef.current = (row: PaymentRow) => {
      const now   = Date.now()
      const last  = Number(localStorage.getItem(STORAGE_LAST) ?? 0)
      const armed = localStorage.getItem(STORAGE_ARMED) === 'true'

      const fmtAmt = new Intl.NumberFormat('en-US', {
        style: 'currency', currency: (row.currency ?? 'usd').toUpperCase(),
      }).format(Number(row.amount ?? 0))
      const title = `Payment received — ${fmtAmt}`
      const body  = [row.client_name, row.description].filter(Boolean).join(' · ') || row.customer_email || ''

      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(title, { body, icon: '/favicon.ico', tag: 'stripe-payment', silent: !armed }) }
        catch { /* isolated tab */ }
      }

      setBanner(row)
      if (bannerTimer.current) clearTimeout(bannerTimer.current)
      bannerTimer.current = setTimeout(() => setBanner(null), 7000)

      if (armed && now - last > DEDUP_MS) {
        localStorage.setItem(STORAGE_LAST, String(now))
        const url = soundUrlRef.current
        if (url) { playUploadedSound(url) } else { playSynthChime() }
      }
    }
  })

  // ── Stable Realtime subscription — [] deps, never re-subscribes ─────────
  useEffect(() => {
    // Request notification permission on first mount
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const supabase = createClient()
    const channel  = supabase
      .channel('payment-notifier')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'payment_notifications' },
        (payload) => fireRef.current(payload.new as PaymentRow)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (bannerTimer.current) clearTimeout(bannerTimer.current)
    }
  }, [])

  if (!banner) return null

  return (
    <>
      <div
        role="alert"
        aria-live="polite"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--bg-surface, #fff)',
          border: '1px solid var(--border)', borderLeft: '4px solid #16a34a',
          borderRadius: 10, padding: '12px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
          minWidth: 260, maxWidth: 380,
          animation: 'slideInRight 0.25s ease-out',
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
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
