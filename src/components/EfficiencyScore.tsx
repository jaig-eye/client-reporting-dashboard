import { scoreColor } from '@/lib/agency-settings'

interface ComponentScore {
  label: string
  pct: number       // 0–100, percent of benchmark achieved
  actual: string    // formatted actual value
  benchmark: string // formatted benchmark target
}

interface Props {
  score: number     // 0–100
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
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide mb-5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
        Marketing Efficiency Score
      </p>

      <div className="flex items-start gap-8 flex-wrap">
        {/* Ring gauge */}
        <div className="flex flex-col items-center gap-2 flex-shrink-0">
          <svg viewBox="0 0 120 120" style={{ width: '6.5rem', height: '6.5rem' }}>
            {/* Track */}
            <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--bg-subtle)" strokeWidth="10" />
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
            {/* Score number */}
            <text x="60" y="52" textAnchor="middle" dominantBaseline="middle"
              fontSize="26" fontWeight="700" fill="var(--text-primary)">
              {score}
            </text>
            <text x="60" y="72" textAnchor="middle" fontSize="11" fill="var(--text-muted)">
              OUT OF 100
            </text>
          </svg>
          <span className="text-xs font-semibold" style={{ color }}>{label}</span>
        </div>

        {/* Component breakdown */}
        <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4" style={{ minWidth: 0 }}>
          {components.map(c => (
            <div key={c.label}>
              <div className="flex items-start justify-between gap-1 mb-1">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                  {c.label}
                </p>
                <p className="text-xs flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                  {c.benchmark} benchmark
                </p>
              </div>
              <p className="text-xl font-bold mb-1.5" style={{ color: scoreColor(c.pct) }}>
                {c.actual}
              </p>
              <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: 'var(--bg-subtle)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(c.pct, 100)}%`,
                    backgroundColor: scoreColor(c.pct),
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {c.pct}% of benchmark
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
