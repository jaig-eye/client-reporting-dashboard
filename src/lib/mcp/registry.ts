import { createAdminClient } from '@/lib/supabase/server'
import * as clients  from './tools/clients'
import * as content  from './tools/content'
import * as sites    from './tools/sites'
import * as analytics from './tools/analytics'
import * as agency   from './tools/agency'
import type { ToolResult } from './types'

const modules = [clients, content, sites, analytics, agency]

export const allTools = modules.flatMap(m => m.tools)

export async function dispatch(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  const db = createAdminClient()
  for (const mod of modules) {
    if (mod.tools.some(t => t.name === toolName)) {
      return mod.handle(toolName, args, db)
    }
  }
  return {
    content: [{ type: 'text', text: `Unknown tool: ${toolName}. Available tools: ${allTools.map(t => t.name).join(', ')}` }],
    isError: true,
  }
}
