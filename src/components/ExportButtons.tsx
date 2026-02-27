'use client'

export default function ExportButtons({ clientId }: { clientId: string }) {
  function downloadCsv() {
    window.location.href = `/api/export/csv?clientId=${clientId}`
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={downloadCsv}
        className="flex items-center gap-1.5 text-sm border border-gray-200 bg-white rounded-lg px-3 py-1.5 hover:border-gray-300 transition-colors text-gray-700"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        CSV
      </button>
    </div>
  )
}
