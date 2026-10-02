// The people around a client, shared by the Profile tab (where they're edited) and the Overview's
// People card (where they're read).

import type { StatusTone } from '@/components/ui/StatusBadge'

export interface AdminUser {
  id:          string
  name:        string
  email:       string
  avatar_url?: string | null
}

export interface Contact {
  id:    string
  name:  string
  email: string | null
  phone: string | null
  role:  string
}

export const CONTACT_ROLE: Record<string, { label: string; tone: StatusTone }> = {
  primary: { label: 'Primary', tone: 'info' },
  billing: { label: 'Billing', tone: 'warning' },
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

export function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}
