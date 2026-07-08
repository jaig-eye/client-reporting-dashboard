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
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  env.gain.setValueAtTime(0, startTime)
  env.gain.linearRampToValueAtTime(gain, startTime + 0.02)
  env.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.05)
}

export function useSiloSounds(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null)

  const getCtx = useCallback((): AudioContext | null => {
    if (!enabled) return null
    if (!ctxRef.current) ctxRef.current = createCtx()
    if (ctxRef.current?.state === 'suspended') {
      ctxRef.current.resume().catch(() => {})
    }
    return ctxRef.current
  }, [enabled])

  // Ascending D4→F#4→A4 triangle arpeggio
  const playSiloCreated = useCallback(() => {
    const ctx = getCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 293.66, t,        0.4, 0.12, 'triangle') // D4
    playTone(ctx, 369.99, t + 0.10, 0.4, 0.12, 'triangle') // F#4
    playTone(ctx, 440.00, t + 0.20, 0.4, 0.12, 'triangle') // A4
  }, [getCtx])

  // Frequency-sweep E4→E5 sine (rising sweep effect)
  const playClusterAdded = useCallback(() => {
    const ctx = getCtx()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.connect(env)
    env.connect(ctx.destination)
    osc.type = 'sine'
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(329.63, t)       // E4
    osc.frequency.linearRampToValueAtTime(659.25, t + 0.12) // E5
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(0.12, t + 0.02)
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    osc.start(t)
    osc.stop(t + 0.30)
  }, [getCtx])

  // Two-note C5→G5 fanfare
  const playTopicGenerated = useCallback(() => {
    const ctx = getCtx()
    if (!ctx) return
    const t = ctx.currentTime
    playTone(ctx, 523.25, t,        0.3, 0.15) // C5
    playTone(ctx, 783.99, t + 0.18, 0.5, 0.15) // G5
  }, [getCtx])

  return { playSiloCreated, playClusterAdded, playTopicGenerated }
}
