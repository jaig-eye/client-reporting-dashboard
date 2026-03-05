import { scoreColor } from '@/lib/agency-settings'

interface ComponentScore {
  label: string
  pct: number          // 0–100, percent of benchmark
  actual: string       // formatted actual value
  benchmark: string    // formatted benchmark value
}

interface Props {
  score: number        // 0–100
  components: ComponentScore[]
}

export default function EfficiencyScore({ score, components }: Props) {
  const color = scoreColor(score)
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - score / 100)

  const label =
    score >= 71 ? 'Strong' :
    score >= 41 ? 'Needs Work' :
    'Underperforming'

  return (
    <div className="rounded-2xl border p-5" style={{
      background: 'rgba(255,255,255,0.025)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderColor: 'rgba(255,255,255,0.07)',
    }}>
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-4">
        Marketing Efficiency Score
      </p>

      <div className="flex items-center gap-6">
        {/* Ring gauge */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1">
          <svg viewBox="0 0 120 120" className="w-28 h-28">
            {/* Track */}
            <circle
              cx="60" cy="60" r={radius}
              fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10"
            />
            {/* Progress */}
            <circle
              cx="60" cy="60" r={radius}
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={offset}
              transform="rotate(-90 60 60)"
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
            {/* Score */}
            <text
              x="60" y="54"
              textAnchor="middle" dominantBaseline="middle"
              fill="white" fontSize="26" fontWeight="700"
            >
              {score}
            </text>
            <text
              x="60" y="73"
              textAnchor="middle"
              fill="#475569" fontSize="11"
            >
              / 100
            </text>
          </svg>
          <span className="text-xs font-medium" style={{ color }}>{label}</span>
        </div>

        {/* Component breakdown */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
          {components.map(c => (
            <div key={c.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-400">{c.label}</span>
                <span className="text-xs font-medium" style={{ color: scoreColor(c.pct) }}>
                  {c.pct}%
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${c.pct}%`, backgroundColor: scoreColor(c.pct) }}
                />
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-[10px] text-slate-600">{c.actual}</span>
                <span className="text-[10px] text-slate-600">target {c.benchmark}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
