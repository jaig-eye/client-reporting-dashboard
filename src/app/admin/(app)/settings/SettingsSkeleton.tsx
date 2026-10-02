import { Sk, SkCard, SkHeader, SkPage, SkTabs } from '@/components/ui/Skeleton'

// Agency settings while they load: header, the seven tabs, then two sections of fields in the
// page's column. Used by loading.tsx and by the page itself while it fetches the settings.
export function SettingsSkeleton({ header = true }: { header?: boolean }) {
  const field = (w: string) => (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Sk w={w} h={11} /><Sk h={38} r={8} /></span>
  )
  return (
    <SkPage label="Loading settings">
      <div className="se-page">
        {header && <SkHeader actions={0} />}
        <div className="se-tabs"><SkTabs count={7} /></div>
        <div className="ui-stack">
          <SkCard>
            <span className="ui-fields" style={{ marginTop: 16 }}>{field('22%')}{field('14%')}{field('18%')}</span>
          </SkCard>
          <SkCard>
            <span className="ui-grid-2" style={{ marginTop: 16 }}>{field('40%')}{field('32%')}{field('36%')}{field('44%')}</span>
          </SkCard>
        </div>
      </div>
    </SkPage>
  )
}
