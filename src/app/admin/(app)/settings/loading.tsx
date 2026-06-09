import Bone from '@/components/admin/Bone'

export default function SettingsLoading() {
  return (
    <div>
      <div className="page-header">
        <Bone className="h-7 w-20 rounded" />
      </div>
      {[...Array(4)].map((_, i) => (
        <div key={i} className="card p-6 mb-4">
          <Bone className="h-5 w-40 rounded mb-4" />
          <div className="grid grid-cols-2 gap-4">
            <div><Bone className="h-3 w-24 rounded mb-2" /><Bone className="h-9 w-full rounded" /></div>
            <div><Bone className="h-3 w-24 rounded mb-2" /><Bone className="h-9 w-full rounded" /></div>
          </div>
        </div>
      ))}
    </div>
  )
}
