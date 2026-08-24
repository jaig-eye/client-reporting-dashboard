import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'

export default async function Home() {
  const cookieStore = await cookies()
  const clientToken = cookieStore.get('client_token')?.value
  const adminSession = cookieStore.get('admin_session')?.value

  // Verify the signed token — the old raw-password comparison never matches now.
  if (isAdminAuthed(adminSession)) redirect('/admin')
  if (clientToken) redirect('/dashboard')
  redirect('/access')
}
