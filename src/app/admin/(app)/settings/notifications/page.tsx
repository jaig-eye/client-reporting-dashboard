import { redirect } from 'next/navigation'

// Notification settings are now embedded in the main settings Notifications tab.
export default function NotificationsRedirect() {
  redirect('/admin/settings?tab=notifications')
}
