// /admin/content/monthly-review — legacy route.
// Monthly Review now lives on the main content page (?view=review). This stub
// redirects so existing deep links (Discord/email review links, bookmarks) keep working.

import { cookies }       from 'next/headers'
import { redirect }      from 'next/navigation'
import { isAdminAuthed } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function MonthlyReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const cookieStore = await cookies()
  if (!isAdminAuthed(cookieStore.get('admin_session')?.value)) redirect('/admin/login')

  const sp    = await searchParams
  const month = typeof sp.month === 'string' ? sp.month : null
  redirect(`/admin/content?view=review${month ? `&month=${month}` : ''}`)
}
