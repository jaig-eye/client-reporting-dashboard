'use client'

export function CopyAdLibraryButton({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-secondary"
      style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
    >
      Preview Library →
    </a>
  )
}
