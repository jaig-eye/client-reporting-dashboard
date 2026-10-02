// The settings tabs, in a plain module: the server page reads it to validate ?tab=, and a value
// exported from a 'use client' file reaches a server component only as a reference.
export const SETTINGS_TABS = [
  { id: 'branding',      label: 'Branding'      },
  { id: 'benchmarks',    label: 'Benchmarks'    },
  { id: 'colors',        label: 'Colors'        },
  { id: 'ai',            label: 'AI'            },
  { id: 'sync',          label: 'Sync'          },
  { id: 'notifications', label: 'Notifications' },
  { id: 'layouts',       label: 'Layouts'       },
] as const
export type SettingsTab = typeof SETTINGS_TABS[number]['id']
