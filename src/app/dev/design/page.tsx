// /dev/design — local design sandbox.
//
// Real components and real global styles, rendered with made-up data: no login, no database,
// no secrets. It exists so the interface can be looked at (and screenshotted) while working on
// design direction, without signing in or pointing a local server at production data.
//
// Never served in production.

import { notFound } from 'next/navigation'
import DesignGallery from './DesignGallery'

export default function DesignSandboxPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <DesignGallery />
}
