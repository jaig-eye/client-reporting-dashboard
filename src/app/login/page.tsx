import { redirect } from 'next/navigation'

// Magic link login removed — clients access via token link from GHL
export default function LoginPage() {
  redirect('/access')
}
