// My Profile — /admin/users/me
// Regular admins update their name, email, avatar, password and theme here.
// Super admin sees why there's nothing else to edit — their account is environment-based — and
// can still switch the theme for this visit.

import '@/styles/admin/users.css'
import { getAdminSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import Section from '@/components/ui/Section'
import ProfileForm  from './ProfileForm'
import McpTokens   from './McpTokens'
import ThemeSection from './ThemeSection'

export const dynamic = 'force-dynamic'

export default async function MyProfilePage() {
  const session = await getAdminSession()

  // Super admin account is not stored in the DB — nothing to edit here
  if (!session) redirect('/admin/login')
  if (session.isSuperAdmin) {
    return (
      <div className="us-page">
        <PageHeader title="Your profile" />
        <div className="ui-stack">
          <Section
            title="Super admin account"
            description={<>This account is set by the <code>ADMIN_PASSWORD</code> environment variable on the server, so there’s nothing to change here.</>}
          />
          <ThemeSection saved={false} />
        </div>
      </div>
    )
  }

  // Load current user data to pre-fill form
  const db = createAdminClient()
  const { data: user } = await db
    .from('users')
    .select('id, name, email, avatar_url')
    .eq('id', session.userId!)
    .maybeSingle()

  return (
    <div className="us-page">
      <PageHeader title="Your profile" description="Your name, photo, password and theme, and your Claude Code access." />
      <div className="ui-stack">
        <ProfileForm
          userId={session.userId!}
          initialName={user?.name ?? ''}
          initialEmail={user?.email ?? ''}
          initialAvatarUrl={user?.avatar_url ?? ''}
        />
        <ThemeSection />
        <McpTokens appUrl={process.env.NEXT_PUBLIC_APP_URL ?? 'https://dash.golaunchlocal.com'} />
        <Section
          title="Sign out"
          description="Ends your session in this browser."
          actions={
            <form action="/api/auth/admin-logout" method="POST">
              <button type="submit" className="btn btn-secondary btn-sm">Sign out</button>
            </form>
          }
        />
      </div>
    </div>
  )
}
