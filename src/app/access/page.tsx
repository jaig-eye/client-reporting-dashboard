// Clients land here when their token cookie is missing
export default function AccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#080c18]">
      <div className="text-center max-w-sm">
        <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-slate-100 mb-1">Invalid access link</h1>
        <p className="text-sm text-slate-500">Please use the dashboard link provided by your agency. If you believe this is an error, contact your account manager.</p>
      </div>
    </div>
  )
}
