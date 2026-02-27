export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="font-bold text-gray-900">Agency Admin</span>
            <nav className="flex gap-4">
              <a href="/admin" className="text-sm text-gray-600 hover:text-gray-900">Clients</a>
            </nav>
          </div>
          <form action="/api/auth/admin-logout" method="POST">
            <button className="text-sm text-gray-400 hover:text-gray-700">Sign out</button>
          </form>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
