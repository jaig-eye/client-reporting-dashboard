/**
 * Campaign goal type definitions.
 * Each campaign can be assigned a goal type that controls:
 *  - Which conversion metric to show (count / revenue)
 *  - Whether to display ROAS or CPL
 *  - The badge color and label in the campaign table
 */

export type GoalType =
  | 'lead_gen'
  | 'ecommerce'
  | 'calls'
  | 'appointments'
  | 'awareness'
  | 'other'
  | 'unset'

export interface GoalTypeDef {
  label: string
  /** Short label shown in badges */
  badge: string
  /** Tailwind color classes for badge */
  badgeClasses: string
  /** Show ROAS metric for this goal type */
  showRoas: boolean
  /** Show CPL / cost-per-conversion metric */
  showCpl: boolean
  /** Default display label for conversions */
  defaultConversionLabel: string
}

export const GOAL_TYPE_DEFS: Record<GoalType, GoalTypeDef> = {
  lead_gen: {
    label: 'Lead Generation',
    badge: 'Lead Gen',
    badgeClasses: 'bg-violet-500/15 text-violet-300 border border-violet-500/20',
    showRoas: false,
    showCpl: true,
    defaultConversionLabel: 'Leads',
  },
  ecommerce: {
    label: 'E-Commerce / Purchases',
    badge: 'Ecommerce',
    badgeClasses: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20',
    showRoas: true,
    showCpl: false,
    defaultConversionLabel: 'Purchases',
  },
  calls: {
    label: 'Phone Calls',
    badge: 'Calls',
    badgeClasses: 'bg-sky-500/15 text-sky-300 border border-sky-500/20',
    showRoas: false,
    showCpl: true,
    defaultConversionLabel: 'Calls',
  },
  appointments: {
    label: 'Appointments',
    badge: 'Appts',
    badgeClasses: 'bg-amber-500/15 text-amber-300 border border-amber-500/20',
    showRoas: false,
    showCpl: true,
    defaultConversionLabel: 'Appointments',
  },
  awareness: {
    label: 'Brand Awareness',
    badge: 'Awareness',
    badgeClasses: 'bg-slate-500/15 text-slate-400 border border-slate-500/20',
    showRoas: false,
    showCpl: false,
    defaultConversionLabel: 'Impressions',
  },
  other: {
    label: 'Other',
    badge: 'Other',
    badgeClasses: 'bg-slate-500/15 text-slate-400 border border-slate-500/20',
    showRoas: false,
    showCpl: true,
    defaultConversionLabel: 'Conversions',
  },
  unset: {
    label: 'Not Configured',
    badge: 'Unset',
    badgeClasses: 'bg-slate-800/60 text-slate-500 border border-slate-700/50',
    showRoas: false,
    showCpl: true,
    defaultConversionLabel: 'Conversions',
  },
}

/** Ordered list for dropdowns (unset always last) */
export const GOAL_TYPE_OPTIONS: GoalType[] = [
  'lead_gen', 'ecommerce', 'calls', 'appointments', 'awareness', 'other', 'unset',
]

/** Keyword-based auto-detection heuristic. Returns a suggested GoalType from the campaign name. */
export function detectGoalType(campaignName: string): GoalType {
  const n = campaignName.toLowerCase()

  // E-commerce signals
  if (/purchas|buy|shop|sale|ecom|cart|checkout|retarget|remarketing|\broas\b|revenue|convers.*value/.test(n)) {
    return 'ecommerce'
  }
  // Call signals
  if (/call|phone|click.to.call/.test(n)) {
    return 'calls'
  }
  // Appointment signals
  if (/appoint|book(ing)?|schedul|meeting/.test(n)) {
    return 'appointments'
  }
  // Awareness signals
  if (/brand|awareness|reach|views?|impress/.test(n)) {
    return 'awareness'
  }
  // Lead gen signals (broad — most common default for service businesses)
  if (/lead|form|prospect|inquiry|sign.?up|register|generat/.test(n)) {
    return 'lead_gen'
  }

  return 'unset'
}

/** Returns the effective conversion label for a goal type + optional custom label. */
export function getConversionLabel(goalType: GoalType, customLabel?: string | null): string {
  if (customLabel?.trim()) return customLabel.trim()
  return GOAL_TYPE_DEFS[goalType]?.defaultConversionLabel ?? 'Conversions'
}

/** Whether ROAS is a meaningful metric for this goal type. */
export function shouldShowRoas(goalType: GoalType): boolean {
  return GOAL_TYPE_DEFS[goalType]?.showRoas ?? false
}
