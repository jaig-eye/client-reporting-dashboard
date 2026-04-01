export default function CampaignLoading() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <div className="sticky top-0 z-10 border-b" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bone className="h-7 w-28 rounded" />
            <Bone className="h-4 w-px" />
            <Bone className="h-5 w-24 rounded" />
          </div>
          <Bone className="h-8 w-48 rounded-lg" />
        </div>
      </div>
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Back button */}
        <Bone className="h-8 w-36 rounded-lg" />
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card p-4">
              <Bone className="h-3 w-14 rounded mb-3" />
              <Bone className="h-6 w-20 rounded mb-2" />
              <Bone className="h-3 w-10 rounded" />
            </div>
          ))}
        </div>
        {/* Table */}
        <div className="card p-6">
          <Bone className="h-4 w-32 rounded mb-2" />
          <Bone className="h-3 w-48 rounded mb-5" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <Bone className="h-4 flex-1 rounded" />
              <Bone className="h-4 w-16 rounded" />
              <Bone className="h-4 w-14 rounded" />
              <Bone className="h-4 w-12 rounded" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

function Bone({ className }: { className: string }) {
  return <div className={`animate-pulse ${className}`} style={{ background: 'var(--bg-subtle)' }} />
}
