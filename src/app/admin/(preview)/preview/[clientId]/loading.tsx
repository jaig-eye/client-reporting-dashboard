import { Sk, SkPage } from '@/components/ui/Skeleton'

// One client's dashboard loading under the preview bar: a block where the dashboard will be.
export default function PreviewClientLoading() {
  return (
    <SkPage label="Loading the dashboard">
      <div style={{ padding: 'var(--adm-gutter)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Sk w="min(320px, 70%)" h={22} r={6} />
        <Sk h={120} r={12} />
        <Sk h={320} r={12} />
      </div>
    </SkPage>
  )
}
