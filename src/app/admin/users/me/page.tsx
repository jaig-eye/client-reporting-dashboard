// My Profile — /admin/users/me
// Allows the logged-in admin to update their display name, email, password, and avatar.
// Linked from the sidebar user card.

import ProfileForm from './ProfileForm'

export default function MyProfilePage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Profile</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Update your display name, password, and avatar.
          </p>
        </div>
      </div>

      <div className="max-w-lg">
        <ProfileForm />
      </div>
    </div>
  )
}
