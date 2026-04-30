// ConnectorLogo — platform-accurate SVG logos for each connector type.
// Used in connector cards, client connection cards, and the client dashboard platform pills.

import type { ConnectorType } from '@/lib/types'

export function ConnectorLogo({
  type,
  size = 20,
  className,
  'aria-hidden': ariaHidden,
}: {
  type: ConnectorType | string
  size?: number
  className?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}) {
  const ah = ariaHidden === true || ariaHidden === 'true' ? 'true' as const : undefined
  switch (type) {
    case 'google_ads':            return <GoogleAdsLogo size={size} className={className} aria-hidden={ah} />
    case 'meta_ads':              return <MetaAdsLogo   size={size} className={className} aria-hidden={ah} />
    case 'google_analytics':      return <GALogo        size={size} className={className} aria-hidden={ah} />
    case 'google_search_console': return <GSCLogo       size={size} className={className} aria-hidden={ah} />
    case 'ghl':                   return <GhlLogo       size={size} className={className} aria-hidden={ah} />
    case 'wordpress':             return <WpLogo        size={size} className={className} aria-hidden={ah} />
    default:                      return <DefaultLogo   size={size} className={className} label={type} aria-hidden={ah} />
  }
}

// ── Google Ads ───────────────────────────────────────────────────────────────
// Google Ads logo: the Google "G" shape with multicolor segments
export function GoogleAdsLogo({ size = 20, className, 'aria-hidden': ah }: { size?: number; className?: string; 'aria-hidden'?: 'true' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden={ah}>
      {/* Google G shape */}
      <path
        d="M21.805 10.023H12.18v3.955h5.518c-.239 1.237-.963 2.284-2.052 2.987v2.48h3.32c1.944-1.79 3.066-4.424 3.066-7.551 0-.607-.046-1.194-.127-1.77l-0.1-.101z"
        fill="#4285F4"
      />
      <path
        d="M12.18 22c2.77 0 5.095-.918 6.793-2.49l-3.32-2.48c-.918.616-2.092.981-3.473.981-2.671 0-4.934-1.804-5.742-4.23H3.01v2.563A10.257 10.257 0 0 0 12.18 22z"
        fill="#34A853"
      />
      <path
        d="M6.438 13.781A6.174 6.174 0 0 1 6.116 12c0-.62.107-1.224.322-1.781V7.656H3.01A10.257 10.257 0 0 0 1.922 12c0 1.508.328 2.94.916 4.22l-.039.122 2.52 1.955.12-.049 1-.467z"
        fill="#FBBC05"
      />
      <path
        d="M12.18 5.989c1.506 0 2.856.518 3.919 1.534l2.938-2.938C17.27 2.892 14.948 2 12.18 2A10.257 10.257 0 0 0 3.01 7.656l3.428 2.563c.808-2.426 3.071-4.23 5.742-4.23z"
        fill="#EA4335"
      />
    </svg>
  )
}

// ── Meta Ads ─────────────────────────────────────────────────────────────────
// Meta logo: the Meta "∞" (infinity) wordmark shape in Meta blue
export function MetaAdsLogo({ size = 20, className, 'aria-hidden': ah }: { size?: number; className?: string; 'aria-hidden'?: 'true' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden={ah}>
      {/* Meta infinity logo — simplified lemniscate */}
      <path
        d="M12 8.5C10.066 6.122 8.21 5 6.5 5 3.462 5 1.5 7.686 1.5 12s1.962 7 5 7c1.71 0 3.566-1.122 5.5-3.5.552-.713 1.063-1.453 1.5-2.184A21.42 21.42 0 0 0 15 15.5c1.934 2.378 3.79 3.5 5.5 3.5 3.038 0 5-2.686 5-7s-1.962-7-5-7c-1.71 0-3.566 1.122-5.5 3.5A21.49 21.49 0 0 0 13.5 10.7 21.49 21.49 0 0 0 12 8.5zM9.5 12c-.48.767-1.003 1.498-1.5 2.054C6.936 15.454 5.846 16 5 16c-1.486 0-2.5-1.686-2.5-4s1.014-4 2.5-4c.846 0 1.936.546 3 1.946.497.556 1.02 1.287 1.5 2.054zm5 0c.48-.767 1.003-1.498 1.5-2.054C17.064 8.546 18.154 8 19 8c1.486 0 2.5 1.686 2.5 4s-1.014 4-2.5 4c-.846 0-1.936-.546-3-1.946A19.682 19.682 0 0 1 14.5 12z"
        fill="#0081FB"
      />
    </svg>
  )
}

// ── Google Analytics ─────────────────────────────────────────────────────────
export function GALogo({ size = 20, className, 'aria-hidden': ah }: { size?: number; className?: string; 'aria-hidden'?: 'true' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden={ah}>
      <rect x="3" y="14" width="4" height="7" rx="1" fill="#E37400" />
      <rect x="10" y="9"  width="4" height="12" rx="1" fill="#E37400" opacity="0.7" />
      <rect x="17" y="3"  width="4" height="18" rx="1" fill="#E37400" opacity="0.5" />
    </svg>
  )
}

// ── Google Search Console ────────────────────────────────────────────────────
export function GSCLogo({ size = 20, className, 'aria-hidden': ah }: { size?: number; className?: string; 'aria-hidden'?: 'true' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden={ah}>
      <circle cx="11" cy="11" r="7" stroke="#34A853" strokeWidth="2.5" fill="none" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="#34A853" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

// ── GoHighLevel ──────────────────────────────────────────────────────────────
export function GhlLogo({ size = 20, className, 'aria-hidden': ah }: { size?: number; className?: string; 'aria-hidden'?: 'true' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden={ah}>
      <rect width="24" height="24" rx="5" fill="#FF6B35" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="10" fontWeight="bold" fill="white" fontFamily="Arial, sans-serif">
        GHL
      </text>
    </svg>
  )
}

// ── WordPress ────────────────────────────────────────────────────────────────
export function WpLogo({ size = 20, className, 'aria-hidden': ah }: { size?: number; className?: string; 'aria-hidden'?: 'true' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden={ah}>
      <circle cx="12" cy="12" r="10" fill="#21759B" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="bold" fill="white" fontFamily="serif">
        W
      </text>
    </svg>
  )
}

// ── Discord ──────────────────────────────────────────────────────────────────
export function DiscordLogo({ size = 20, className, 'aria-hidden': ah }: { size?: number; className?: string; 'aria-hidden'?: 'true' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden={ah}>
      <path
        d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
        fill="#5865F2"
      />
    </svg>
  )
}

// ── Stripe ───────────────────────────────────────────────────────────────────
export function StripeLogo({ size = 20, className, 'aria-hidden': ah }: { size?: number; className?: string; 'aria-hidden'?: 'true' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden={ah}>
      <rect width="24" height="24" rx="5" fill="#635BFF" />
      <path
        d="M11.12 9.47c0-.62.51-.86 1.35-.86 1.21 0 2.74.37 3.95 1.02V6.2A10.49 10.49 0 0 0 12.47 5.5c-2.63 0-4.38 1.37-4.38 3.66 0 3.57 4.92 3 4.92 4.53 0 .73-.64.97-1.52.97-1.32 0-3-.54-4.33-1.27v3.48c1.47.64 2.96.91 4.33.91 2.69 0 4.54-1.33 4.54-3.65-.02-3.85-4.91-3.16-4.91-4.66z"
        fill="white"
      />
    </svg>
  )
}

// ── Local Dominator ──────────────────────────────────────────────────────────
export function LocalDominatorLogo({ size = 20, className, 'aria-hidden': ah }: { size?: number; className?: string; 'aria-hidden'?: 'true' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden={ah}>
      <path
        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
        fill="#f97316"
      />
      <circle cx="12" cy="9" r="2.5" fill="white" />
    </svg>
  )
}

// ── Fallback ─────────────────────────────────────────────────────────────────
function DefaultLogo({ size = 20, className, label, 'aria-hidden': ah }: { size?: number; className?: string; label: string; 'aria-hidden'?: 'true' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden={ah}>
      <rect width="24" height="24" rx="4" fill="#6b7280" />
      <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="bold" fill="white">
        {label.slice(0, 1).toUpperCase()}
      </text>
    </svg>
  )
}
