// How an Ad Fuel balance is coloured, everywhere it appears.
//
// The colour says one thing: how low the balance is. It deliberately ignores spend pace and
// projected run-out dates — ACH payments land on unpredictable days, so any "runs out before the
// next bill" guess would be wrong often enough to be noise.

/** Balance at or below this is "low" when a client has no alert threshold of its own. */
export const DEFAULT_LOW_BALANCE = 500

export type BalanceLevel = 'negative' | 'low' | 'healthy'

export function balanceLevel(balance: number, lowThreshold?: number | null): BalanceLevel {
  if (balance < 0) return 'negative'
  if (balance <= (lowThreshold ?? DEFAULT_LOW_BALANCE)) return 'low'
  return 'healthy'
}

export function balanceColor(balance: number, lowThreshold?: number | null): string {
  const level = balanceLevel(balance, lowThreshold)
  return level === 'negative' ? 'var(--red)' : level === 'low' ? 'var(--amber)' : 'var(--green)'
}
