'use client'

// An <img> for a picture that may live on a CLIENT'S site rather than on ours.
//
// Their media is served from their own server, and a browser fetching it directly shows up as
// a foreign origin — which hotlink rules and Cloudflare's bot filtering routinely drop. So the
// src is routed through /api/admin/content/image-proxy, which fetches it server-side with
// credentials those filters accept.
//
// The fallback matters as much as the proxy. If the proxy cannot serve it — the connection was
// switched, the host check does not match, their site is down — this drops back to the original
// URL, which is exactly what the page would have requested anyway. Trying can therefore never
// leave a reviewer worse off than not trying.

import { useEffect, useState } from 'react'
import { proxiedImageSrc } from '@/lib/content/imageProxy'

interface Props {
  src: string | null | undefined
  /** The connection that authorises the proxy fetch. Without one the URL is used as-is. */
  connectionId?: string | null
  alt: string
  style?: React.CSSProperties
  className?: string
  loading?: 'lazy' | 'eager'
}

export default function ClientImage({ src, connectionId, alt, style, className, loading }: Props) {
  const [current, setCurrent] = useState(() => proxiedImageSrc(src, connectionId))

  // Re-derive when the picture or the connection changes, or a reviewer switching sites would
  // keep looking at the previous post's image.
  useEffect(() => { setCurrent(proxiedImageSrc(src, connectionId)) }, [src, connectionId])

  if (!src) return null

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt={alt}
      loading={loading}
      // Costs nothing, and satisfies the subset of hotlink rules that only check the Referer —
      // which is the case the direct fallback below can still win.
      referrerPolicy="no-referrer"
      onError={() => { if (current !== src) setCurrent(src) }}
      style={style}
      className={className}
    />
  )
}
