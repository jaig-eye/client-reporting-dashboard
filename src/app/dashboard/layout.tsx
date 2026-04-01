import DashboardNavigationRefresher from '@/components/DashboardNavigationRefresher'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DashboardNavigationRefresher />
      {children}
    </>
  )
}
