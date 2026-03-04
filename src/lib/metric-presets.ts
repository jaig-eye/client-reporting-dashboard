/**
 * Common Meta action_type values that can be used as the conversion metric.
 * These are offered as preset options in the metric mapping UI.
 * The admin can also select from live-discovered action types (stored in
 * ad_accounts.available_meta_actions after a sync run).
 */
export const META_CONVERSION_PRESETS: { value: string; label: string }[] = [
  { value: 'results',                                          label: 'Campaign Results (Meta default) (results)' },
  { value: 'lead',                                             label: 'Leads — Instant Form / Messenger (lead)' },
  { value: 'offsite_conversion.fb_pixel_lead',                 label: 'Website Leads — Pixel (offsite_conversion.fb_pixel_lead)' },
  { value: 'offsite_conversion.fb_pixel_purchase',             label: 'Purchases — Pixel (offsite_conversion.fb_pixel_purchase)' },
  { value: 'onsite_conversion.lead_grouped',                   label: 'Instant Form Leads — On-Site (onsite_conversion.lead_grouped)' },
  { value: 'onsite_conversion.purchase',                       label: 'On-Site Purchases (onsite_conversion.purchase)' },
  { value: 'omni_complete_registration',                       label: 'Registrations (omni_complete_registration)' },
  { value: 'offsite_conversion.fb_pixel_complete_registration', label: 'Website Registrations — Pixel (offsite_conversion.fb_pixel_complete_registration)' },
  { value: 'offsite_conversion.fb_pixel_schedule',             label: 'Scheduled Appointments — Pixel (offsite_conversion.fb_pixel_schedule)' },
  { value: 'offsite_conversion.fb_pixel_contact',              label: 'Contact Events — Pixel (offsite_conversion.fb_pixel_contact)' },
  { value: 'phone_call',                                       label: 'Phone Calls (phone_call)' },
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
