'use client'

// Full-height iframe rendering the client dashboard (/dashboard).
// The client_token cookie is set server-side before this component renders,
// so the iframe loads the correct client's dashboard automatically.

export default function PreviewIframe() {
  return (
    <iframe
      src="/dashboard"
      style={{
        flex:   1,
        width:  '100%',
        height: '100%',
        border: 'none',
        display: 'block',
      }}
      title="Client Dashboard Preview"
    />
  )
}
