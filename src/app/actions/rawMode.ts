'use server'

import { cookies } from 'next/headers'
import { isAdminAuthed } from '@/lib/auth'

/**
 * Server action: toggle admin raw cost mode.
 * Sets/clears the `admin_raw_mode` httpOnly cookie.
 * When active, all dashboard cost metrics are shown without ad fuel markup.
 * Auth-guarded — only valid admin sessions can set this cookie.
 */
export async function setRawMode(enabled: boolean) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')?.value
  if (!isAdminAuthed(session)) throw new Error('Unauthorized')

  if (enabled) {
    cookieStore.set('admin_raw_mode', '1', {
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      maxAge: 60 * 60 * 8, // auto-expire after 8 hours
    })
  } else {
    cookieStore.delete('admin_raw_mode')
  }
}
