import { unstable_noStore as noStore } from 'next/cache'
import { createAdminClient }           from '@/lib/supabase/server'
import EmailsClientShell               from '@/components/admin/EmailsClientShell'

export const dynamic = 'force-dynamic'

export default async function EmailsPage() {
  noStore()
  const db = createAdminClient()

  const { data: clients } = await db
    .from('clients')
    .select('id, name')
    .order('name')

  return <EmailsClientShell clients={clients ?? []} />
}
