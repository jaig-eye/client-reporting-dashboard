interface MetricCardProps {
  label: string
  value: string
  delta?: number
  subtext?: string
}

export default function MetricCard({ label, value, delta, subtext }: MetricCardProps) {
  const isPositive = delta !== undefined && delta >= 0
  const isNeutral = delta === undefined || delta === 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {delta !== undefined && !isNeutral && (
        <div className={`flex items-center gap-1 mt-1.5 text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d={isPositive ? 'M5 10l7-7m0 0l7 7m-7-7v18' : 'M19 14l-7 7m0 0l-7-7m7 7V3'}
            />
          </svg>
          {Math.abs(delta).toFixed(1)}% vs prior period
        </div>
      )}
      {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
    </div>
  )
}
