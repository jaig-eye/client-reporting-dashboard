'use client'

// The ⋯ button at the end of a client row on the Clients page: where to go for this client, named,
// with a copy button beside each link that can be shared.

import { PresentationChart, BookOpen } from '@phosphor-icons/react'
import ActionMenu, { type ActionMenuItem } from '@/components/ui/ActionMenu'

export default function ClientLinksMenu({ clientId, clientName, dashboardToken }: {
  clientId: string
  clientName: string
  dashboardToken: string | null | undefined
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const items: ActionMenuItem[] = [
    {
      key: 'dashboard', label: 'Client dashboard', sub: 'What the client sees',
      icon: <PresentationChart size={16} />,
      href: `/api/admin/preview/${clientId}`,
      copy: dashboardToken ? `${origin}/api/auth/access?token=${dashboardToken}` : null,
    },
    ...(dashboardToken ? [{
      key: 'ads', label: 'Ad library', sub: 'Every ad, shareable', newTab: true,
      icon: <BookOpen size={16} />,
      href: `/share/ads?token=${dashboardToken}`,
      copy: `${origin}/share/ads?token=${dashboardToken}`,
    }] : []),
  ]
  return <ActionMenu items={items} label={`Links for ${clientName}`} width={248} />
}
