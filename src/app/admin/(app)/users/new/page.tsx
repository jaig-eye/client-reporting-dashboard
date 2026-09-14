// New User — /admin/users/new
// Admins and the super admin. Viewers are sent back to the list.

import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth'
import NewUserForm from './NewUserForm'

export const dynamic = 'force-dynamic'

export default async function NewUserPage() {
  // A server check in front of the form, matching the API's gate. This page used to be a bare
  // client component with nothing in front of it, so anyone who reached the URL got a form
  // that only failed once they submitted it.
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')
  if (!session.isSuperAdmin && session.role !== 'admin') redirect('/admin/users')

  return <NewUserForm />
}
