import type { SupabaseClient } from '@supabase/supabase-js'

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export type InputSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export type Tool = {
  name: string
  description: string
  inputSchema: InputSchema
}

export type ToolModule = {
  tools: Tool[]
  handle: (name: string, args: Record<string, unknown>, db: SupabaseClient) => Promise<ToolResult>
}

export function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

export function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

export function fmt(v: unknown): string {
  return JSON.stringify(v, null, 2)
}
