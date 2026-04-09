import { WarningCircle } from '@phosphor-icons/react/dist/ssr'

// Clients land here when their token cookie is missing
export default function AccessPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        padding: '2rem',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 400,
          width: '100%',
          padding: '2.5rem 2rem',
          textAlign: 'center',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.25rem',
        }}>
          <WarningCircle
            size={48}
            weight="duotone"
            aria-hidden
            style={{ color: 'var(--red)' }}
          />
        </div>
        <h1 className="page-title mb-2" style={{ textAlign: 'center' }}>
          Invalid access link
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Please use the dashboard link provided by your agency. If you believe this is an error, contact your account manager.
        </p>
      </div>
    </div>
  )
}
