/**
 * Common Meta action_type values that can be used as the conversion metric.
 * These are offered as preset options in the metric mapping UI.
 * The admin can also select from live-discovered action types (stored in
 * ad_accounts.available_meta_actions after a sync run).
 */
export const META_CONVERSION_PRESETS: { value: string; label: string }[] = [
  { value: 'results',                                          label: 'Campaign Results (Meta default)' },
  { value: 'lead',                                             label: 'Leads — Instant Form / Messenger' },
  { value: 'offsite_conversion.fb_pixel_lead',                 label: 'Website Leads — Pixel' },
  { value: 'offsite_conversion.fb_pixel_purchase',             label: 'Purchases — Pixel' },
  { value: 'onsite_conversion.lead_grouped',                   label: 'Instant Form Leads — On-Site' },
  { value: 'onsite_conversion.purchase',                       label: 'On-Site Purchases' },
  { value: 'omni_complete_registration',                       label: 'Registrations' },
  { value: 'offsite_conversion.fb_pixel_complete_registration', label: 'Website Registrations — Pixel' },
  { value: 'offsite_conversion.fb_pixel_schedule',             label: 'Scheduled Appointments — Pixel' },
  { value: 'offsite_conversion.fb_pixel_contact',              label: 'Contact Events — Pixel' },
  { value: 'phone_call',                                       label: 'Phone Calls' },
]

/** Build a combined, deduped option list from presets + live-discovered action types. */
export function buildMetaActionOptions(
  discoveredActions: string[]
): { value: string; label: string }[] {
  const presetValues = new Set(META_CONVERSION_PRESETS.map(p => p.value))
  const extras = discoveredActions
    .filter(a => !presetValues.has(a))
    .map(a => ({ value: a, label: a }))
  return [...META_CONVERSION_PRESETS, ...extras]
}
