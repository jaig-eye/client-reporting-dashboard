export default function ContentLoading() {
  return (
    <div>
      <div className="page-header">
        <Bone className="h-7 w-32 rounded" />
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
        {[72, 60].map((w, i) => (
          <Bone key={i} className="h-8 rounded-t" style={{ width: w }} />
        ))}
      </div>

      {/* Calendar filter row */}
      <div className="flex gap-2 mb-5">
        <Bone className="h-8 w-28 rounded" />
        <Bone className="h-8 w-28 rounded" />
        <Bone className="h-8 w-24 rounded" />
        <Bone className="h-8 w-24 rounded" />
      </div>

      {/* Timeline groups */}
      {[...Array(3)].map((_, g) => (
        <div key={g} className="mb-6">
          <Bone className="h-4 w-20 rounded mb-3" />
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex items-start gap-4 py-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <Bone className="h-4 w-16 rounded flex-shrink-0" />
              <div className="flex-1">
                <Bone className="h-4 w-64 rounded mb-2" />
                <Bone className="h-3 w-40 rounded" />
              </div>
              <Bone className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Bone({ className, style }: { className: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse ${className}`}
      style={{ background: 'var(--bg-subtle)', borderRadius: 'inherit', ...style }}
    />
  )
}
