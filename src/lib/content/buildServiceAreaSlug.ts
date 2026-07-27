export type SlugStructure =
  | 'service_slash_city_state'
  | 'service_dash_city_state'
  | 'service_slash_city'
  | 'silo_slash_service_city_state'

export function buildServiceAreaSlug(
  structure: SlugStructure,
  serviceName: string,
  city: string,
  state: string,
  siloSlug?: string,
): string {
  const s    = toSlug(serviceName)
  const c    = toSlug(city)
  const st   = state.toLowerCase().replace(/[^a-z]/g, '')
  const silo = siloSlug ? toSlug(siloSlug) : 'services'
  switch (structure) {
    case 'service_slash_city_state':      return `${s}/${c}-${st}/`
    case 'service_dash_city_state':       return `${s}-${c}-${st}/`
    case 'service_slash_city':            return `${s}/${c}/`
    case 'silo_slash_service_city_state': return `${silo}/${s}/${c}-${st}/`
  }
}

/**
 * Build a slug using an explicit base page path.
 * basePath: '/services/rv-detailing'  →  'services/rv-detailing/melbourne-fl/'
 * format 'city_state' = city-state suffix (melbourne-fl)
 * format 'city'       = city only         (melbourne)
 */
export function buildSlugFromBasePage(
  basePath: string,
  city: string,
  state: string,
  format: 'city_state' | 'city' = 'city_state',
): string {
  const base  = basePath.replace(/^\/|\/$/g, '')
  const c     = toSlug(city)
  const st    = state.toLowerCase().replace(/[^a-z]/g, '')
  const child = format === 'city' ? c : `${c}-${st}`
  return `${base}/${child}/`
}

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
