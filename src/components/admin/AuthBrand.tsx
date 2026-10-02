'use client'

// The agency's logo, centred at the top of the signed-out cards (sign in, forgot and reset
// password). The (auth) layout reads the branding on the server and hands it down, so the logo is
// there on the first paint; it used to be fetched after the page loaded and pop in.

import { createContext, useContext, type ReactNode } from 'react'

export interface AuthBranding { name: string; logoUrl: string | null }

const BrandingContext = createContext<AuthBranding>({ name: 'LaunchLocal', logoUrl: null })

export function AuthBrandingProvider({ value, children }: { value: AuthBranding; children: ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

/** The logo; the agency's initial and name when there's no logo. */
export default function AuthBrand() {
  const { name, logoUrl } = useContext(BrandingContext)
  return (
    <div className="au-brand">
      {logoUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={logoUrl} alt={name} className="au-logo" />
      ) : (
        <>
          <span className="au-mark" aria-hidden>{name.charAt(0).toUpperCase()}</span>
          <span className="au-agency">{name}</span>
        </>
      )}
    </div>
  )
}
