interface MetricCardProps {
  label: string
  value: string
  delta?: number
  sub?: string
  invertDelta?: boolean
}

export default function MetricCard({ label, value, delta, sub, invertDelta }: MetricCardProps) {
  const isGood = delta !== undefined
    ? (invertDelta ? delta <= 0 : delta >= 0)
    : null

  return (
    <div className="bg-[#0f1525] rounded-xl border border-[#1e2a40] p-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-2xl font-bold text-white leading-none mb-1">{value}</p>
      {sub && <p className="text-xs text-slate-500 mb-1.5">{sub}</p>}
      {delta !== undefined && delta !== 0 && (
        <div className={`flex items-center gap-0.5 text-xs font-medium ${
          isGood ? 'text-emerald-400' : 'text-red-400'
        }`}>
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d={delta > 0 ? 'M5 10l7-7m0 0l7 7m-7-7v18' : 'M19 14l-7 7m0 0l-7-7m7 7V3'}
            />
          </svg>
          {Math.abs(delta).toFixed(1)}% vs prior
        </div>
      )}
    </div>
  )
}
