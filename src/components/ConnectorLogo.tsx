// ConnectorLogo — platform-accurate SVG logos for each connector type.
// Used in connector cards, client connection cards, and the client dashboard platform pills.

import type { ConnectorType } from '@/lib/types'

export function ConnectorLogo({
  type,
  size = 20,
  className,
}: {
  type: ConnectorType | string
  size?: number
  className?: string
}) {
  switch (type) {
    case 'google_ads':        return <GoogleAdsLogo  size={size} className={className} />
    case 'meta_ads':          return <MetaAdsLogo    size={size} className={className} />
    case 'google_analytics':  return <GALogo         size={size} className={className} />
    case 'google_search_console': return <GSCLogo    size={size} className={className} />
    case 'ghl':               return <GhlLogo      size={size} className={className} />
    case 'wordpress':         return <WpLogo       size={size} className={className} />
    default:                  return <DefaultLogo    size={size} className={className} label={type} />
  }
}

// ── Google Ads ───────────────────────────────────────────────────────────────
// Google Ads logo: the Google "G" shape with multicolor segments
export function GoogleAdsLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
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
export function MetaAdsLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      {/* Meta infinity logo — simplified lemniscate */}
      <path
        d="M12 8.5C10.066 6.122 8.21 5 6.5 5 3.462 5 1.5 7.686 1.5 12s1.962 7 5 7c1.71 0 3.566-1.122 5.5-3.5.552-.713 1.063-1.453 1.5-2.184A21.42 21.42 0 0 0 15 15.5c1.934 2.378 3.79 3.5 5.5 3.5 3.038 0 5-2.686 5-7s-1.962-7-5-7c-1.71 0-3.566 1.122-5.5 3.5A21.49 21.49 0 0 0 13.5 10.7 21.49 21.49 0 0 0 12 8.5zM9.5 12c-.48.767-1.003 1.498-1.5 2.054C6.936 15.454 5.846 16 5 16c-1.486 0-2.5-1.686-2.5-4s1.014-4 2.5-4c.846 0 1.936.546 3 1.946.497.556 1.02 1.287 1.5 2.054zm5 0c.48-.767 1.003-1.498 1.5-2.054C17.064 8.546 18.154 8 19 8c1.486 0 2.5 1.686 2.5 4s-1.014 4-2.5 4c-.846 0-1.936-.546-3-1.946A19.682 19.682 0 0 1 14.5 12z"
        fill="#0081FB"
      />
    </svg>
  )
}

// ── Google Analytics ─────────────────────────────────────────────────────────
export function GALogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <rect x="3" y="14" width="4" height="7" rx="1" fill="#E37400" />
      <rect x="10" y="9"  width="4" height="12" rx="1" fill="#E37400" opacity="0.7" />
      <rect x="17" y="3"  width="4" height="18" rx="1" fill="#E37400" opacity="0.5" />
    </svg>
  )
}

// ── Google Search Console ────────────────────────────────────────────────────
export function GSCLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="11" cy="11" r="7" stroke="#34A853" strokeWidth="2.5" fill="none" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="#34A853" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

// ── GoHighLevel ──────────────────────────────────────────────────────────────
export function GhlLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <rect width="24" height="24" rx="5" fill="#FF6B35" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="10" fontWeight="bold" fill="white" fontFamily="Arial, sans-serif">
        GHL
      </text>
    </svg>
  )
}

// ── WordPress ────────────────────────────────────────────────────────────────
export function WpLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="10" fill="#21759B" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="bold" fill="white" fontFamily="serif">
        W
      </text>
    </svg>
  )
}

// ── Fallback ─────────────────────────────────────────────────────────────────
function DefaultLogo({ size = 20, className, label }: { size?: number; className?: string; label: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <rect width="24" height="24" rx="4" fill="#6b7280" />
      <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="bold" fill="white">
        {label.slice(0, 1).toUpperCase()}
      </text>
    </svg>
  )
}
