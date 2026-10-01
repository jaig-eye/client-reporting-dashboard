'use client'

// SoundToggle — sidebar item that arms/disarms payment sound notifications.
// Placed above the user account row in Sidebar.tsx.
//
// AudioContext creation MUST happen synchronously in the click handler to satisfy
// Chrome's transient user-activation requirement. The created context is stored on
// window.__paymentAudioCtx so PaymentNotifier (a sibling component) can play
// sounds through it without needing its own user gesture.

import { useState, useEffect } from 'react'
import { SpeakerHigh, SpeakerX } from '@phosphor-icons/react'

const STORAGE_KEY = 'payment-sound-armed'

declare global {
  interface Window { __paymentAudioCtx?: AudioContext }
}

export default function SoundToggle() {
  const [armed, setArmed] = useState(false)

  // Restore armed state on mount and recreate AudioContext on first interaction.
  // AudioContext is destroyed when the browser closes, but localStorage persists.
  // Rather than making the user click the toggle again, we register a one-time
  // listener so the context is silently recreated on their first click/keypress
  // after reopening the app — which happens within seconds of normal use.
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) !== 'true') return
    setArmed(true)

    function rearm() {
      try {
        if (!window.__paymentAudioCtx || window.__paymentAudioCtx.state === 'closed') {
          window.__paymentAudioCtx = new AudioContext()
        } else if (window.__paymentAudioCtx.state === 'suspended') {
          window.__paymentAudioCtx.resume()
        }
      } catch { /* unavailable */ }
    }

    // Try immediately — succeeds if browser has stored site autoplay permission
    rearm()

    // Fallback: recreate on the first user interaction after a cold start
    window.addEventListener('click',   rearm, { once: true, capture: true })
    window.addEventListener('keydown', rearm, { once: true, capture: true })
    return () => {
      window.removeEventListener('click',   rearm, { capture: true })
      window.removeEventListener('keydown', rearm, { capture: true })
    }
  }, [])

  function toggle() {
    if (armed) {
      // Disarm — suspend the shared AudioContext
      window.__paymentAudioCtx?.suspend()
      localStorage.setItem(STORAGE_KEY, 'false')
      setArmed(false)
    } else {
      // Arm — AudioContext must be created synchronously in this click handler
      try {
        if (!window.__paymentAudioCtx || window.__paymentAudioCtx.state === 'closed') {
          window.__paymentAudioCtx = new AudioContext()
        } else if (window.__paymentAudioCtx.state === 'suspended') {
          window.__paymentAudioCtx.resume()
        }
      } catch {
        // AudioContext not available in this environment
      }
      localStorage.setItem(STORAGE_KEY, 'true')
      setArmed(true)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={armed}
      title={armed ? 'Payment sounds are on. Click to turn them off.' : 'Play a sound when a payment arrives'}
      className={`adm-um-item${armed ? ' adm-um-item--on' : ''}`}
    >
      <span className="flex items-center" style={{ width: '1rem', justifyContent: 'center' }}>
        {armed
          ? <SpeakerHigh size={15} aria-hidden />
          : <SpeakerX    size={15} aria-hidden />
        }
      </span>
      {armed ? 'Payment sounds on' : 'Payment sounds off'}
    </button>
  )
}
