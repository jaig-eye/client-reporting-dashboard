import { SkHeader, SkCard, SkText, SkPage } from '@/components/ui/Skeleton'

export default function ConnectionLoading() {
  return (
    <SkPage label="Loading connection">
      <div style={{ maxWidth: 820 }}>
        <SkHeader actions={1} tile />
        <div className="ui-stack"><SkCard><SkText lines={4} /></SkCard><SkCard /></div>
      </div>
    </SkPage>
  )
}
