'use client'

import { useEffect, useState } from 'react'

interface Props {
  totalPosts:   number
  clientsTotal: number
  month:        string
  onExit:       () => void
}

export default function MonthlyReviewComplete({ totalPosts, clientsTotal, month, onExit }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <div style={{
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      minHeight:      '60vh',
      padding:        '48px 24px',
      position:       'relative',
      overflow:       'hidden',
    }}>
      {/* Drifting background dots */}
      {[4, 6, 8].map((dur, i) => (
        <div key={i} style={{
          position:        'absolute',
          width:           12,
          height:          12,
          borderRadius:    '50%',
          background:      '#16a34a',
          top:             `${30 + i * 20}%`,
          left:            `${20 + i * 25}%`,
          animation:       `monthly-dot-drift ${dur}s ease-in-out infinite`,
          animationDelay:  `${i * 1.5}s`,
          opacity:         0.2,
        }} />
      ))}

      {/* Checkmark */}
      <div style={{
        fontSize:       72,
        lineHeight:     1,
        marginBottom:   24,
        animation:      visible ? 'monthly-complete-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' : 'none',
        transform:      visible ? undefined : 'scale(0.3)',
        opacity:        visible ? undefined : 0,
      }}>
        ✅
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, textAlign: 'center' }}>
        {month} Review Complete
      </h1>

      <p style={{ fontSize: 16, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 420, lineHeight: 1.6, marginBottom: 36 }}>
        {totalPosts} post{totalPosts === 1 ? '' : 's'} approved across {clientsTotal} client{clientsTotal === 1 ? '' : 's'}.
        They&apos;ll publish on their scheduled dates through the month.
      </p>

      <div style={{ display: 'flex', gap: 12 }}>
        <a href="/admin/content" className="btn btn-secondary">
          View Content Calendar
        </a>
        <button onClick={onExit} className="btn btn-primary">
          Exit Review
        </button>
      </div>
    </div>
  )
}
