import { NextResponse } from 'next/server'

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function parseBody<T>(request: Request): Promise<T | null> {
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
