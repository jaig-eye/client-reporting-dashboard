import { createAdminClient } from './supabase/server'
import type { AgencySettings } from './types'

export const DEFAULT_SETTINGS: AgencySettings = {
  id: '',
  agency_name: 'My Agency',
  agency_logo_url: undefined,
  benchmark_roas: 3.0,
  benchmark_ctr: 0.03,
  benchmark_cpc: 3.0,
  benchmark_conv_rate: 0.03,
  benchmark_cpm: 15.0,
  default_date_range_days: 30,
  default_conversion_value: 0,
  ad_fuel_cut: 0.20,
  cron_enabled: true,
  app_version: '',
  updated_at: '',
}

export async function getAgencySettings(): Promise<AgencySettings> {
  try {
    const db = createAdminClient()
    const { data } = await db.from('agency_settings').select('*').single()
    return (data as AgencySettings) ?? DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

/**
 * Returns a 0–100 efficiency score from metric actuals vs benchmark targets.
 * Weights: ROAS 35%, Conv Rate 25%, CTR 20%, CPC 20% (inverted — lower is better).
 * Each component is capped at 100 before weighting.
 */
export function calcEfficiencyScore(
  actual: { roas: number; ctr: number; cpc: number; convRate: number },
  benchmarks: Pick<AgencySettings, 'benchmark_roas' | 'benchmark_ctr' | 'benchmark_cpc' | 'benchmark_conv_rate'>
): number {
  const roasPct  = pctOfBenchmark(actual.roas,     benchmarks.benchmark_roas,     false)
  const ctrPct   = pctOfBenchmark(actual.ctr,      benchmarks.benchmark_ctr,      false)
  const cpcPct   = pctOfBenchmark(actual.cpc,      benchmarks.benchmark_cpc,      true)
  const convPct  = pctOfBenchmark(actual.convRate, benchmarks.benchmark_conv_rate, false)

  const weighted = roasPct * 0.35 + convPct * 0.25 + ctrPct * 0.20 + cpcPct * 0.20
  return Math.min(100, Math.max(0, Math.round(weighted)))
}

/**
 * Returns how close `actual` is to `benchmark` as a 0–100 percentage.
 * When `inverted` is true, lower actual = higher score (e.g. CPC).
 */
export function pctOfBenchmark(actual: number, benchmark: number, inverted: boolean): number {
  if (!benchmark || !actual) return 0
  const ratio = inverted ? benchmark / actual : actual / benchmark
  return Math.min(100, Math.round(ratio * 100))
}

export function scoreColor(score: number): string {
  if (score >= 71) return '#10b981' // emerald
  if (score >= 41) return '#f59e0b' // amber
  return '#ef4444'                  // red
}
