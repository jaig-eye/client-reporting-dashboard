'use client'

// The greeting and date in the Today header, in the VIEWER's time zone.
//
// This page renders on the server, and on Vercel the server clock is UTC — so a server-side
// "Good morning" told someone in California "Good evening" at 4pm. The server sends a neutral
// placeholder; the browser fills in the real greeting after it mounts, so hydration never mismatches.

import { useEffect, useState } from 'react'

type Part = 'greeting' | 'date'

function compute(now: Date): { greeting: string; date: string } {
  const hour = now.getHours()
  return {
    greeting: hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening',
    date:     now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  }
}

export default function Greeting({ part }: { part: Part }) {
  const [value, setValue] = useState<{ greeting: string; date: string } | null>(null)

  useEffect(() => {
    setValue(compute(new Date()))
    // Keep it right if the tab stays open across a boundary (e.g. morning → afternoon).
    const id = setInterval(() => setValue(compute(new Date())), 5 * 60_000)
    return () => clearInterval(id)
  }, [])

  if (part === 'greeting') return <>{value?.greeting ?? 'Today'}</>
  return <>{value?.date ?? ' '}</>
}
