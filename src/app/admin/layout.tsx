import { getAgencySettings } from '@/lib/agency-settings'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const settings = await getAgencySettings()

  return (
    <div className="min-h-screen bg-[#080c18]">
      <header className="bg-[#0f1525] border-b border-[#1e2a40]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              {settings.agency_logo_url && (
                <img src={settings.agency_logo_url} alt={settings.agency_name} className="h-5" />
              )}
              <span className="font-bold text-white">{settings.agency_name}</span>
            </div>
            <nav className="flex gap-4">
              <a href="/admin" className="text-sm text-slate-400 hover:text-white transition-colors">
                Clients
              </a>
              <a href="/admin/settings" className="text-sm text-slate-400 hover:text-white transition-colors">
                Settings
              </a>
            </nav>
          </div>
          <form action="/api/auth/admin-logout" method="POST">
            <button className="text-sm text-slate-600 hover:text-slate-400 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
