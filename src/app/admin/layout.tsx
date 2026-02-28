export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#080c18]">
      <header className="bg-[#0f1525] border-b border-[#1e2a40]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="font-bold text-white">Agency Admin</span>
            <nav className="flex gap-4">
              <a href="/admin" className="text-sm text-slate-400 hover:text-white transition-colors">Clients</a>
            </nav>
          </div>
          <form action="/api/auth/admin-logout" method="POST">
            <button className="text-sm text-slate-600 hover:text-slate-400 transition-colors">Sign out</button>
          </form>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
