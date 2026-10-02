// Bare layout for the signed-out admin pages (login, forgot and reset password). No sidebar.
//
// Nobody is signed in here, so there is no user theme to apply. These pages are always light (the
// agency's logo is made for a white background) and use the agency's brand colour as the accent,
// set before the first paint the same way the admin does (ThemeScript). The agency's name and logo
// are read here too, so the cards show the logo on the first paint (AuthBrand). admin.css is
// loaded for its tokens.

import '@/styles/admin.css'
import '@/styles/admin/auth.css'
import ThemeScript from '@/components/admin/ThemeScript'
import { AuthBrandingProvider, type AuthBranding } from '@/components/admin/AuthBrand'
import { createAdminClient } from '@/lib/supabase/server'

async function branding(): Promise<AuthBranding & { accent: string }> {
  try {
    const { data } = await createAdminClient()
      .from('agency_settings')
      .select('agency_name, agency_logo_url, brand_primary')
      .limit(1)
      .maybeSingle()
    const row = data as { agency_name?: string | null; agency_logo_url?: string | null; brand_primary?: string | null } | null
    const accent = row?.brand_primary
    return {
      name:    row?.agency_name || 'LaunchLocal',
      logoUrl: row?.agency_logo_url || null,
      // ThemeScript keeps the default accent when this isn't a colour.
      accent:  accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '',
    }
  } catch {
    return { name: 'LaunchLocal', logoUrl: null, accent: '' }
  }
}

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { accent, ...brand } = await branding()
  return (
    <>
      <ThemeScript mode="light" accent={accent} />
      <AuthBrandingProvider value={brand}>{children}</AuthBrandingProvider>
    </>
  )
}
