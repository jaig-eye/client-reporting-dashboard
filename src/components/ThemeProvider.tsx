'use client'

import { createContext, useContext, useState, useEffect, useRef } from 'react'

export type ThemeMode = 'light' | 'dark' | 'auto'

interface ThemeContextValue {
  mode:        ThemeMode
  accentColor: string
  setMode:     (m: ThemeMode) => void
  setAccent:   (c: string)    => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  return useContext(ThemeContext)
}

interface Props {
  initialMode:   ThemeMode
  initialAccent: string
  children:      React.ReactNode
}

export default function ThemeProvider({ initialMode, initialAccent, children }: Props) {
  const [mode,   setModeState]   = useState<ThemeMode>(initialMode)
  const [accent, setAccentState] = useState(initialAccent || '#2563eb')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Apply theme mode to <html data-theme="...">
  useEffect(() => {
    const root = document.documentElement
    if (mode === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const apply = () => root.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
      apply()
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    } else {
      root.setAttribute('data-theme', mode)
    }
  }, [mode])

  // Apply accent color as CSS custom properties on <html>
  useEffect(() => {
    const hex = accent || '#2563eb'
    const root = document.documentElement
    root.style.setProperty('--accent',        hex)
    root.style.setProperty('--accent-hover',  darkenHex(hex, 12))
    root.style.setProperty('--accent-subtle', lightenHex(hex))
  }, [accent])

  function savePrefs(data: { theme?: ThemeMode; accent_color?: string }) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch('/api/admin/users/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      }).catch(() => {})
    }, 800)
  }

  function setMode(m: ThemeMode) {
    setModeState(m)
    savePrefs({ theme: m })
  }

  function setAccent(c: string) {
    setAccentState(c)
    savePrefs({ accent_color: c })
  }

  return (
    <ThemeContext.Provider value={{ mode, accentColor: accent, setMode, setAccent }}>
      {children}
    </ThemeContext.Provider>
  )
}

// ─── Hex color helpers ────────────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const r = parseInt(m[1].slice(0, 2), 16) / 255
  const g = parseInt(m[1].slice(2, 4), 16) / 255
  const b = parseInt(m[1].slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)]
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
  return `#${f(0).toString(16).padStart(2, '0')}${f(8).toString(16).padStart(2, '0')}${f(4).toString(16).padStart(2, '0')}`
}

function darkenHex(hex: string, amount: number): string {
  const hsl = hexToHsl(hex)
  if (!hsl) return hex
  return hslToHex(hsl[0], hsl[1], Math.max(0, hsl[2] - amount))
}

function lightenHex(hex: string): string {
  const hsl = hexToHsl(hex)
  if (!hsl) return '#eff6ff'
  return hslToHex(hsl[0], Math.max(0, hsl[1] - 30), Math.min(97, Math.max(93, 100 - hsl[2] + 88)))
}
