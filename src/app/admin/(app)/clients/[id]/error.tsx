'use client'

export default function ClientPageError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card p-8 text-center mt-6" style={{ maxWidth: 480, margin: '2rem auto' }}>
      <p className="section-title mb-2">Something went wrong</p>
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>{error.message}</p>
      <button className="btn btn-primary" onClick={reset}>Try again</button>
    </div>
  )
}
