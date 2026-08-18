import { NextResponse } from 'next/server'

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function parseBody<T>(request: Request): Promise<T | null> {
  // Require an explicit JSON content-type. A cross-site form POST uses text/plain
  // to dodge the CORS preflight; rejecting non-JSON closes that CSRF vector.
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) return null
  try {
    return await request.json() as T
  } catch {
    return null
  }
}

export function errorResponse(err: unknown, fallback = 'Internal server error'): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode })
  }
  console.error('[api]', err)
  return NextResponse.json({ error: fallback }, { status: 500 })
}
