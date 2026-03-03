'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

type Platform = 'all' | 'google' | 'meta'

const TABS: { label: string; value: Platform; dot?: string }[] = [
  { label: 'All Platforms', value: 'all' },
  { label: 'Google Ads',    value: 'google', dot: '#3b82f6' },
  { label: 'Meta Ads',      value: 'meta',   dot: '#818cf8' },
]

export default function PlatformTabs({ current }: { current: Platform }) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  function handleTab(platform: Platform) {
    const params = new URLSearchParams(searchParams.toString())
    if (platform === 'all') params.delete('platform')
    else params.set('platform', platform)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex gap-1 bg-[#080c18] border border-[#1e2a40] rounded-lg p-1">
      {TABS.map(tab => (
        <button
          key={tab.value}
          onClick={() => handleTab(tab.value)}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md transition-colors ${
            current === tab.value
              ? 'bg-[#1e2a40] text-white font-medium'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          {tab.dot && (
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: tab.dot }} />
          )}
          {tab.label}
        </button>
      ))}
    </div>
  )
}
