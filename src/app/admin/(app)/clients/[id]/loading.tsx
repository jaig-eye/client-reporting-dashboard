import Bone from '@/components/admin/Bone'

export default function ClientDetailLoading() {
  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Bone className="h-7 w-48 rounded" />
        <Bone className="h-8 w-28 rounded" />
      </div>
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
        {[80, 100, 72, 90].map((w, i) => (
          <Bone key={i} className="h-8 rounded-t" style={{ width: w }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card" style={{ padding: 20 }}>
            <Bone className="h-5 w-32 rounded mb-4" />
            <Bone className="h-4 w-full rounded mb-2" />
            <Bone className="h-4 w-3/4 rounded mb-2" />
            <Bone className="h-4 w-1/2 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
