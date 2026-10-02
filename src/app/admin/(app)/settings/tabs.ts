// The sections of Agency settings, in a plain module: the Settings menu lists them, and the page
// reads ?tab= against them. (A value exported from a 'use client' file reaches a server component
// only as a reference.)
export const SETTINGS_TABS = [
  { id: 'branding',      label: 'Branding'          },
  { id: 'colors',        label: 'Colors'            },
  { id: 'layouts',       label: 'Dashboard layouts' },
  { id: 'benchmarks',    label: 'Benchmarks'        },
  { id: 'ai',            label: 'AI'                },
  { id: 'notifications', label: 'Notifications'     },
  { id: 'sync',          label: 'Sync schedule'     },
] as const
export type SettingsTab = typeof SETTINGS_TABS[number]['id']

export function isSettingsTab(id: string | null | undefined): id is SettingsTab {
  return SETTINGS_TABS.some(t => t.id === id)
}
