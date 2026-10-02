// A client's publishing schedule in words. Shared by the Pipeline and the Content page's Clients
// overview so the two always describe a schedule the same way.

const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks',
  monthly: 'Monthly', monthly_first: 'Monthly (1st)', monthly_mid: 'Monthly (15th)', monthly_end: 'Monthly (28th)',
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Weekly on Mondays", "Monthly on the first Monday" — the schedule in Content settings, in words. */
export function cadenceLabel(cs: Record<string, unknown>): string {
  const freq = (cs.schedule_frequency as string | null) ?? 'weekly'
  const day  = DAY_NAMES[(cs.schedule_day_of_week as number | null) ?? 1] ?? 'Monday'
  const perDate = Math.min(10, Math.max(1, Number(cs.posts_per_run ?? 1) || 1))
  const base =
    freq === 'daily'         ? 'Every day'
    : freq === 'weekly'      ? `Weekly on ${day}s`
    : freq === 'biweekly'    ? `Every two weeks on ${day}s`
    : freq === 'monthly_first' ? 'Monthly on the 1st'
    : freq === 'monthly_mid'   ? 'Monthly on the 15th'
    : freq === 'monthly_end'   ? 'Monthly on the 28th'
    : freq === 'monthly'       ? `Monthly on the first ${day}`
    : (FREQ_LABEL[freq] ?? freq)
  return perDate > 1 ? `${base}, ${perDate} posts each date` : base
}

/**
 * How far ahead the planner fills dates, in the schedule's own unit: weeks_ahead counts cadence
 * cycles (a monthly cycle is 28 days), so "2" is two months for a monthly client.
 */
export function planningWindowLabel(frequency: string | null, weeksAhead: number | null | undefined): string {
  const n = Math.max(Number(weeksAhead ?? 1) || 1, 1)
  const freq = frequency ?? 'weekly'
  const [count, unit]: [number, string] =
    freq === 'daily'             ? [n, 'day']
    : freq === 'biweekly'        ? [n * 2, 'week']
    : freq.startsWith('monthly') ? [n, 'month']
    : [n, 'week']
  return `${count} ${unit}${count === 1 ? '' : 's'} ahead`
}
