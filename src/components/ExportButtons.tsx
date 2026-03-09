'use client'

export default function ExportButtons({ clientId }: { clientId: string }) {
  function downloadCsv() {
    window.location.href = `/api/export/csv?clientId=${clientId}`
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={downloadCsv}
        className="btn btn-secondary flex items-center gap-1.5"
        style={{ padding: '0.375rem 0.75rem' }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
          style={{ color: 'var(--text-muted)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span className="text-sm">CSV</span>
      </button>
    </div>
  )
}
