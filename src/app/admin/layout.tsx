import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Check admin email allowlist
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim())
  if (!adminEmails.includes(user.email || '')) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="font-bold text-gray-900">Agency Admin</h1>
            <nav className="flex gap-4">
              <a href="/admin" className="text-sm text-gray-600 hover:text-gray-900">Clients</a>
              <a href="/admin/sync" className="text-sm text-gray-600 hover:text-gray-900">Sync Logs</a>
            </nav>
          </div>
          <span className="text-xs text-gray-400">{user.email}</span>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
