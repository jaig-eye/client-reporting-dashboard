// Skeleton shown by Next.js while the server component streams in
export default function DashboardLoading() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Header skeleton */}
      <div
        className="sticky top-0 z-10 border-b"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
      >
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bone className="h-7 w-28 rounded" />
            <Bone className="h-4 w-px" />
            <Bone className="h-5 w-24 rounded" />
          </div>
          <Bone className="h-8 w-48 rounded-lg" />
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">
        {/* Metric cards row 1 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-4">
              <Bone className="h-3 w-20 rounded mb-3" />
              <Bone className="h-7 w-28 rounded mb-2" />
              <Bone className="h-3 w-16 rounded" />
            </div>
          ))}
        </div>

        {/* Metric cards row 2 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-4">
              <Bone className="h-3 w-16 rounded mb-3" />
              <Bone className="h-7 w-24 rounded mb-2" />
              <Bone className="h-3 w-12 rounded" />
            </div>
          ))}
        </div>

        {/* Chart card */}
        <div className="card p-6">
          <Bone className="h-4 w-40 rounded mb-2" />
          <Bone className="h-3 w-56 rounded mb-6" />
          <Bone className="h-64 w-full rounded-lg" />
        </div>

        {/* Campaign table card */}
        <div className="card p-6">
          <Bone className="h-4 w-32 rounded mb-2" />
          <Bone className="h-3 w-24 rounded mb-5" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <Bone className="h-4 flex-1 rounded" />
              <Bone className="h-4 w-16 rounded" />
              <Bone className="h-4 w-14 rounded" />
              <Bone className="h-4 w-12 rounded" />
              <Bone className="h-4 w-12 rounded" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

function Bone({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse ${className}`}
      style={{ background: 'var(--bg-subtle)', borderRadius: 'inherit' }}
    />
  )
}
