// Runs fn over items with at most `limit` in flight, keeping output order.
// Used anywhere a screen needs one Canvas request per assignment/id but can't
// afford to fire them all at once (e.g. a course with many tracked labs).
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
