// Bare layout for the signed-out admin pages (login, forgot and reset password). No sidebar.
//
// Nobody is signed in here, so there is no user theme to apply. These pages are always light (the
// agency's logo is made for a white background) and use the agency's brand colour as the accent,
// set before the first paint the same way the admin does (ThemeScript). admin.css is loaded for
// its tokens.

import '@/styles/admin.css'
import '@/styles/admin/auth.css'
import ThemeScript from '@/components/admin/ThemeScript'
import { createAdminClient } from '@/lib/supabase/server'

async function brandAccent(): Promise<string> {
  try {
    const { data } = await createAdminClient()
      .from('agency_settings')
      .select('brand_primary')
      .limit(1)
      .maybeSingle()
    const value = (data as { brand_primary?: string | null } | null)?.brand_primary
    return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : ''
  } catch {
    return '' // ThemeScript keeps the default accent when this isn't a colour.
  }
}

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeScript mode="light" accent={await brandAccent()} />
      {children}
    </>
  )
}
