import { NextResponse } from 'next/server'
// This endpoint has been removed. See /api/admin/connections and /api/admin/categories.
export async function GET() { return NextResponse.json({ error: 'Endpoint removed' }, { status: 410 }) }
export async function POST() { return NextResponse.json({ error: 'Endpoint removed' }, { status: 410 }) }
export async function PATCH() { return NextResponse.json({ error: 'Endpoint removed' }, { status: 410 }) }
export async function DELETE() { return NextResponse.json({ error: 'Endpoint removed' }, { status: 410 }) }
