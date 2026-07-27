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

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
