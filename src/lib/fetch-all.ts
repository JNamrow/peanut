/**
 * PostgREST returns at most 1,000 rows per request (Supabase's default
 * max-rows), and a plain `select` silently stops there. Page through a query
 * until it runs dry. Order the query so pages are stable.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<{ data: T[] }> {
  const data: T[] = [];
  for (let from = 0; ; from += size) {
    const res = await page(from, from + size - 1);
    if (res.error) throw new Error(res.error.message);
    const rows = res.data ?? [];
    data.push(...rows);
    if (rows.length < size) break;
  }
  return { data };
}
