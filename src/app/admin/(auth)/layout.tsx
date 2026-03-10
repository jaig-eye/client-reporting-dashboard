// Bare layout for unauthenticated admin pages (login screen).
// No sidebar — intentionally minimal.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
