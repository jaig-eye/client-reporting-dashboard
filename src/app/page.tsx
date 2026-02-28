import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export default async function Home() {
  const cookieStore = await cookies()
  const clientToken = cookieStore.get('client_token')?.value
  const adminSession = cookieStore.get('admin_session')?.value

  if (adminSession === process.env.ADMIN_PASSWORD) redirect('/admin')
  if (clientToken) redirect('/dashboard')
  redirect('/access')
}
