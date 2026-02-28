'use client'

export default function ExportButtons({ clientId }: { clientId: string }) {
  function downloadCsv() {
    window.location.href = `/api/export/csv?clientId=${clientId}`
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={downloadCsv}
        className="flex items-center gap-1.5 text-sm border border-[#1e2a40] bg-[#0f1525] text-slate-300 rounded-lg px-3 py-1.5 hover:border-[#2a3a54] hover:bg-[#151c30] transition-colors"
      >
        <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        CSV
      </button>
    </div>
  )
}
