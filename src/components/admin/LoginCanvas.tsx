'use client'

import { useEffect, useRef } from 'react'

const NODE_COUNT = 70
const MAX_DIST   = 160
const SPEED      = 0.4

interface Node { x: number; y: number; vx: number; vy: number }

export default function LoginCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr   = window.devicePixelRatio || 1
    let nodes:  Node[] = []
    let rafId:  number

    function resize() {
      const w = window.innerWidth
      const h = window.innerHeight
      canvas!.width  = w * dpr
      canvas!.height = h * dpr
      canvas!.style.width  = `${w}px`
      canvas!.style.height = `${h}px`
    }

    function init() {
      resize()
      const w = canvas!.width / dpr
      const h = canvas!.height / dpr
      nodes = Array.from({ length: NODE_COUNT }, () => ({
        x:  Math.random() * w,
        y:  Math.random() * h,
        vx: (Math.random() - 0.5) * SPEED * 2,
        vy: (Math.random() - 0.5) * SPEED * 2,
      }))
    }

    function draw() {
      const ctx = canvas!.getContext('2d')
      if (!ctx) return

      const w = canvas!.width / dpr
      const h = canvas!.height / dpr

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      for (const n of nodes) {
        n.x += n.vx
        n.y += n.vy
        if (n.x < 0 || n.x > w) n.vx *= -1
        if (n.y < 0 || n.y > h) n.vy *= -1
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx   = nodes[i].x - nodes[j].x
          const dy   = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MAX_DIST) {
            const alpha = (1 - dist / MAX_DIST) * 0.12
            ctx.beginPath()
            ctx.strokeStyle = `rgba(37,99,235,${alpha})`
            ctx.lineWidth   = 1
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(nodes[j].x, nodes[j].y)
            ctx.stroke()
          }
        }
      }

      for (const n of nodes) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(37,99,235,0.3)'
        ctx.fill()
      }

      rafId = requestAnimationFrame(draw)
    }

    const ro = new ResizeObserver(() => {
      resize()
      const w = canvas!.width / dpr
      const h = canvas!.height / dpr
      for (const n of nodes) {
        n.x = Math.min(n.x, w)
        n.y = Math.min(n.y, h)
      }
    })
    ro.observe(document.body)

    init()
    rafId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', inset: 0,
        width: '100%', height: '100%',
        zIndex: 0, pointerEvents: 'none',
      }}
    />
  )
}
