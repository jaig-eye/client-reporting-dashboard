'use client'

// The sign-in screens' background: a mesh of drifting points joined by lines that fade with
// distance. Each point sits at a depth, so nearer points are larger, brighter and quicker, and on a
// desktop the pointer joins the mesh and parts the points around it.
//
// It answers the form (mode). While signing in, the mesh swirls around the card and waves pulse out
// from it, lighting the lines they cross. On success the points gather into a ring around the card.
// On an error they jolt outward and flash red, then settle.
//
// Colours are the theme's (--accent, the agency's brand colour, and --red), re-read when the theme
// changes. Reduced motion keeps the drift, slower, and drops the swirl, waves and jolt. The loop
// pauses while the tab is hidden.

import { useEffect, useRef } from 'react'

export type LoginCanvasMode = 'idle' | 'busy' | 'success' | 'error'

interface Node {
  x: number; y: number
  vx: number; vy: number   // its own drift
  ix: number; iy: number   // a jolt, decaying
  z: number                // depth, 0.35 (far) to 1 (near)
}
type Rgb = [number, number, number]

const SPEED        = 0.32   // drift, px per frame at 60fps, for the nearest points
const POINTER_DIST = 190
const WAVE_EVERY   = 1100   // ms between waves while signing in
const WAVE_SPEED   = 0.6    // px per ms
const WAVE_WIDTH   = 70
const BUCKETS      = 24     // lines are stroked in batches of equal opacity

/** A theme colour as rgb, or null when the token isn't a colour a canvas can read. */
function tokenRgb(ctx: CanvasRenderingContext2D, name: string): Rgb | null {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return null
  ctx.fillStyle = 'transparent'
  ctx.fillStyle = raw   // ignored when it isn't a colour, which leaves the sentinel
  const v = String(ctx.fillStyle)
  if (v.startsWith('#') && v.length === 7) {
    return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]
  }
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!m || m[4] === '0') return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
]

export default function LoginCanvas({ mode = 'idle' }: { mode?: LoginCanvasMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modeRef   = useRef<LoginCanvasMode>(mode)
  // Set by the mode effect, read by the loop: a fresh error, a fresh sign-in.
  const kickRef   = useRef<{ error: boolean; busy: boolean }>({ error: false, busy: false })

  useEffect(() => {
    const was = modeRef.current
    modeRef.current = mode
    if (mode === 'error' && was !== 'error') kickRef.current.error = true
    if (mode === 'busy' && was !== 'busy') kickRef.current.busy = true
  }, [mode])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finePointer = window.matchMedia('(pointer: fine)').matches

    let w = 0, h = 0, dpr = 1, maxDist = 150
    const nodes: Node[] = []
    let accent: Rgb | null = null
    let red: Rgb | null = null
    let raf = 0
    let last = performance.now()
    let pointer: { x: number; y: number } | null = null

    // Eased levels the loop moves toward, so a change of mode never snaps.
    let energy = 0     // signing in: swirl and brighter lines
    let gather = 0     // success: the ring around the card
    let alarm  = 0     // error: the red flash, fading
    let nextWave = 0
    const waves: number[] = []   // birth times

    function readColours() {
      accent = tokenRgb(ctx!, '--accent')
      red = tokenRgb(ctx!, '--red') ?? accent
    }

    function spawn(x = Math.random() * w, y = Math.random() * h): Node {
      const z = 0.35 + Math.random() * 0.65
      const a = Math.random() * Math.PI * 2
      const s = SPEED * (0.45 + z * 0.75)
      return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, ix: 0, iy: 0, z }
    }

    function fit() {
      w = window.innerWidth
      h = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas!.width = Math.round(w * dpr)
      canvas!.height = Math.round(h * dpr)
      maxDist = Math.max(115, Math.min(170, w * 0.115))
      const want = Math.max(38, Math.min(120, Math.round((w * h) / 12500)))
      while (nodes.length < want) nodes.push(spawn())
      if (nodes.length > want) nodes.length = want
      for (const n of nodes) { n.x = Math.min(n.x, w); n.y = Math.min(n.y, h) }
    }

    /** The card's centre and the radius of a circle around it. */
    function cardCircle() {
      const card = document.querySelector('.au-card')
      if (!card) return { cx: w / 2, cy: h / 2, r: Math.min(w, h) * 0.3 }
      const b = card.getBoundingClientRect()
      return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: Math.hypot(b.width, b.height) / 2 }
    }

    function frame(now: number) {
      const dt = Math.min((now - last) / 16.667, 3)
      last = now
      const reduced = motion.matches
      const m = modeRef.current
      const kick = kickRef.current
      const { cx, cy, r: cardR } = cardCircle()

      const ease = (v: number, to: number, k: number) => v + (to - v) * Math.min(1, k * dt)
      energy = ease(energy, m === 'busy' || m === 'success' ? 1 : 0, 0.06)
      gather = ease(gather, m === 'success' ? 1 : 0, 0.05)
      alarm  = kick.error ? 1 : Math.max(0, alarm - 0.018 * dt)

      if (kick.busy) { kick.busy = false; nextWave = now }
      if (m === 'busy' && !reduced && now >= nextWave) { waves.push(now); nextWave = now + WAVE_EVERY }
      const reach = Math.hypot(w, h)
      while (waves.length && (now - waves[0]) * WAVE_SPEED > reach) waves.shift()

      // ── Move ────────────────────────────────────────────────────────────
      const pace = reduced ? 0.35 : 1
      for (const n of nodes) {
        if (kick.error && !reduced) {
          const dx = n.x - cx, dy = n.y - cy
          const d = Math.hypot(dx, dy) || 1
          const push = 7 * n.z * Math.max(0.25, 1 - d / reach)
          n.ix += (dx / d) * push
          n.iy += (dy / d) * push
        }

        let mx = n.vx * pace, my = n.vy * pace
        if (!reduced && (energy > 0.01 || gather > 0.01)) {
          const dx = n.x - cx, dy = n.y - cy
          const d = Math.hypot(dx, dy) || 1
          // Round the card, quicker near it.
          const swirl = energy * (0.6 + 2.4 * n.z) * (cardR / (cardR + d * 0.6))
          mx += (-dy / d) * swirl
          my += (dx / d) * swirl
          // Into a ring just outside the card.
          const ring = cardR + 30 + (1 - n.z) * 150
          const pull = (ring - d) * 0.045 * gather
          mx += (dx / d) * pull
          my += (dy / d) * pull
        }
        if (pointer && !reduced) {
          const dx = n.x - pointer.x, dy = n.y - pointer.y
          const d = Math.hypot(dx, dy)
          if (d < 110 && d > 0.1) {
            const push = (1 - d / 110) * 1.4
            mx += (dx / d) * push
            my += (dy / d) * push
          }
        }

        n.x += (mx + n.ix) * dt
        n.y += (my + n.iy) * dt
        n.ix *= Math.pow(0.9, dt)
        n.iy *= Math.pow(0.9, dt)

        if (n.x < 0) { n.x = 0; n.vx = Math.abs(n.vx) }
        else if (n.x > w) { n.x = w; n.vx = -Math.abs(n.vx) }
        if (n.y < 0) { n.y = 0; n.vy = Math.abs(n.vy) }
        else if (n.y > h) { n.y = h; n.vy = -Math.abs(n.vy) }
      }
      kick.error = false

      // ── Draw ────────────────────────────────────────────────────────────
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx!.clearRect(0, 0, w, h)
      if (!accent) { raf = requestAnimationFrame(frame); return }
      const [r, g, b] = alarm > 0.01 && red ? mix(accent, red, alarm) : accent

      // How lit each point is by the waves passing through.
      const glow = new Float32Array(nodes.length)
      if (waves.length) {
        for (let i = 0; i < nodes.length; i++) {
          const d = Math.hypot(nodes[i].x - cx, nodes[i].y - cy)
          let v = 0
          for (const born of waves) {
            const front = cardR * 0.6 + (now - born) * WAVE_SPEED
            const off = (d - front) / WAVE_WIDTH
            v += Math.exp(-off * off) * Math.max(0, 1 - front / reach)
          }
          glow[i] = Math.min(1, v)
        }
      }

      const lift = 1 + energy * 0.8 + gather * 0.6 + alarm * 0.6
      const base = 0.2 * lift
      const batches: number[][] = Array.from({ length: BUCKETS + 1 }, () => [])
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < nodes.length; j++) {
          const c = nodes[j]
          const dx = a.x - c.x, dy = a.y - c.y
          const dist2 = dx * dx + dy * dy
          if (dist2 > maxDist * maxDist) continue
          const near = 1 - Math.sqrt(dist2) / maxDist
          const depth = (a.z + c.z) / 2
          const alpha = Math.min(1, near * depth * base + near * (glow[i] + glow[j]) * 0.42)
          const k = Math.round(alpha * BUCKETS)
          if (k > 0) batches[k].push(a.x, a.y, c.x, c.y)
        }
        if (pointer) {
          const d = Math.hypot(a.x - pointer.x, a.y - pointer.y)
          if (d < POINTER_DIST) {
            const k = Math.round(Math.min(1, (1 - d / POINTER_DIST) * 0.45 * a.z) * BUCKETS)
            if (k > 0) batches[k].push(a.x, a.y, pointer.x, pointer.y)
          }
        }
      }
      ctx!.lineWidth = 1
      for (let k = 1; k <= BUCKETS; k++) {
        const seg = batches[k]
        if (!seg.length) continue
        ctx!.strokeStyle = `rgba(${r},${g},${b},${k / BUCKETS})`
        ctx!.beginPath()
        for (let s = 0; s < seg.length; s += 4) { ctx!.moveTo(seg[s], seg[s + 1]); ctx!.lineTo(seg[s + 2], seg[s + 3]) }
        ctx!.stroke()
      }

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        const lit = glow[i]
        ctx!.fillStyle = `rgba(${r},${g},${b},${Math.min(1, (0.22 + n.z * 0.4) * (1 + energy * 0.35) + lit * 0.5)})`
        ctx!.beginPath()
        ctx!.arc(n.x, n.y, 1.1 + n.z * 2 + lit * 2.2, 0, Math.PI * 2)
        ctx!.fill()
      }

      if (!canvas!.hasAttribute('data-ready')) canvas!.setAttribute('data-ready', '')
      raf = requestAnimationFrame(frame)
    }

    function start() { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(frame) }
    function onVisibility() { if (document.hidden) cancelAnimationFrame(raf); else start() }
    function onMove(e: PointerEvent) { pointer = { x: e.clientX, y: e.clientY } }
    function onLeave() { pointer = null }

    readColours()
    fit()
    start()

    window.addEventListener('resize', fit)
    document.addEventListener('visibilitychange', onVisibility)
    if (finePointer) {
      window.addEventListener('pointermove', onMove, { passive: true })
      document.documentElement.addEventListener('pointerleave', onLeave)
    }
    // The accent and theme are attributes on <html>; follow them if they change.
    const themeWatch = new MutationObserver(readColours)
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      themeWatch.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="au-canvas" aria-hidden />
}
