// The shape a rebuilt dashboard page holds while its data arrives.
//
// Every page here is a server component doing its own queries, so without this Next.js holds the
// old page on screen until the new one is ready and a tab switch feels like nothing happened for a
// second. A skeleton hands the click back immediately: the sidebar and the date picker are already
// there from the layout, and this fills the space below in the shape that is coming.
//
// It has to be the *right* shape. A skeleton that resolves into a different layout reads worse
// than no skeleton at all, so each page passes the counts it actually renders.

export default function PageSkeleton({
  kpis = 4,
  /** Cards below the headline row, as fractions of a row: [1] is full width, [1,1] is a pair. */
  blocks = [1, 1],
  /** Pages that lead with a sentence rather than the stat row. */
  lede = false,
}: {
  kpis?: number
  blocks?: number[]
  lede?: boolean
}) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }} aria-busy="true">
      {/* Matches PageHeader: title on the left, date picker on the right. */}
      <div className="dash-page-header">
        <div className="dash-page-header__title">
          <Bone className="h-2 w-2 rounded-full" />
          <Bone className="h-6 w-40 rounded" />
        </div>
        <div className="dash-page-header__controls">
          <Bone className="h-9 w-56 rounded-lg" />
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {lede && <Bone className="h-4 w-80 max-w-full rounded" />}

        {kpis > 0 && (
          <div className="stat-grid stat-grid--wide">
            {Array.from({ length: kpis }, (_, i) => (
              <div key={i} className="card p-4 flex flex-col gap-3">
                <Bone className="h-3 w-24 rounded" />
                <Bone className="h-8 w-28 rounded" />
                <Bone className="h-3 w-20 rounded" />
              </div>
            ))}
          </div>
        )}

        {blocks.map((span, i) => (
          <div
            key={i}
            className="grid gap-4"
            style={{ gridTemplateColumns: span === 1 ? '1fr' : `repeat(${span}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: span }, (_, j) => (
              <div key={j} className="card p-4 sm:p-6 flex flex-col gap-3">
                <Bone className="h-4 w-44 rounded" />
                <Bone className="h-3 w-64 max-w-full rounded" />
                <div className="flex flex-col gap-2 pt-2">
                  {Array.from({ length: 5 }, (_, k) => (
                    <Bone key={k} className="h-9 w-full rounded" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </main>
    </div>
  )
}

/**
 * One grey block. `animate-pulse` is the only motion, and it stops for anyone who asked their
 * system to reduce motion — a pulsing page is exactly what that setting is for.
 */
function Bone({ className }: { className: string }) {
  return (
    <div
      className={`dash-bone ${className}`}
      style={{ background: 'var(--bg-subtle)', borderRadius: 'inherit' }}
      aria-hidden
    />
  )
}
