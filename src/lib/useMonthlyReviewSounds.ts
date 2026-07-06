'use client'

import { useCallback, useRef } from 'react'

function createCtx(): AudioContext | null {
  try {
    return new AudioContext()
  } catch {
    return null
  }
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  gain: number,
  type: OscillatorType = 'sine',
) {
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.connect(env)
  env.connect(ctx.destination)
  osc.type      = type
  osc.frequency.setValueAtTime(freq, startTime)
  env.gain.setValueAtTime(0, startTime)
  env.gain.linearRampToValueAtTime(gain, startTime + 0.02)
  env.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.05)
}

export function useMonthlyReviewSounds(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null)

  const getCtx = useCallback((): AudioContext | null => {
    if (!enabled) return null
    if (!ctxRef.current) ctxRef.current = createCtx()
    if (ctxRef.current?.state === 'suspended') {
      ctxRef.current.resume().catch(() => {})
    }
    return ctxRef.current
  }, [enabled])

  // Two-tone ascending chime: A4 (440) → E5 (659)
  const playApprove = useCallback(() => {
    const ctx = getCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 440, t,        0.35, 0.15)
    playTone(ctx, 659, t + 0.12, 0.35, 0.15)
  }, [getCtx])

  // Three-note arpeggio: C5 → E5 → G5
  const playClientDone = useCallback(() => {
    const ctx = getCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 523, t,        0.5, 0.18)
    playTone(ctx, 659, t + 0.12, 0.5, 0.18)
    playTone(ctx, 784, t + 0.24, 0.5, 0.18)
  }, [getCtx])

  // Four-note chord swell: C5 + E5 + G5 + C6 simultaneously
  const playMonthDone = useCallback(() => {
    const ctx = getCtx()
    if (!ctx) return
    const t = ctx.currentTime
    const freqs = [523, 659, 784, 1047]
    freqs.forEach(freq => {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.connect(env)
      env.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t)
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(0.25 / freqs.length, t + 0.15)
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.9)
      osc.start(t)
      osc.stop(t + 1.0)
    })
  }, [getCtx])

  return { playApprove, playClientDone, playMonthDone }
}
