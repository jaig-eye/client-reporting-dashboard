import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/auth'
import { WarningCircle } from '@phosphor-icons/react/dist/ssr'

export default async function AccessPage() {
  const cookieStore = await cookies()
  const adminSession = cookieStore.get('admin_session')?.value

  if (isAdminAuthed(adminSession)) {
    redirect('/admin/dashboard')
  }

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
          Link expired or invalid
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Your dashboard link has expired or is no longer valid. Contact your account manager and ask them to send you a new link.
        </p>
        <a
          href="/admin"
          style={{
            display: 'inline-block',
            marginTop: '1.5rem',
            fontSize: '0.75rem',
            color: 'var(--text-faint)',
            textDecoration: 'none',
          }}
        >
          Agency login →
        </a>
      </div>
    </div>
  )
}
