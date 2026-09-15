// Read every row of a query, a page at a time.
//
// The database API returns at most 1000 rows per request. A read that needs more — every ad of a
// busy campaign across a month — silently stops at 1000, and anything summed from it comes out
// low with no error. This keeps asking for the next page until a short one comes back.
//
// The query passed in must have a stable order (e.g. .order('id')), or pages can overlap or skip.

const PAGE_SIZE = 1000

type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>

export async function fetchAllRows<T = Record<string, unknown>>(
  page: (from: number, to: number) => PageResult,
  { maxRows = 50_000 }: { maxRows?: number } = {},
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) {
      // Same behaviour as the single reads this replaces: log, and return what was read.
      console.error('[fetchAllRows] page failed at offset', from, error.message)
      break
    }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}
