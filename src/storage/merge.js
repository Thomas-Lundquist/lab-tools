// Three-way merge for synced documents (see storage/sync.js). Pure — no
// storage, no network — so it's unit-tested on its own.
//
// `base` is the copy both sides last agreed on, `local` is this device's
// copy, `remote` is what Canvas holds now. Whatever only one side changed is
// kept. Objects merge key by key, so two devices editing different labs,
// sections, or students both keep their edits. Arrays and plain values are
// replaced whole. When both sides changed the same value differently, this
// device's edit wins: it's the one pushing, so it's the latest.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)

export function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

export function merge3(base, local, remote) {
  if (deepEqual(local, base)) return remote
  if (deepEqual(remote, base)) return local
  if (deepEqual(local, remote)) return local
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {}
    const out = {}
    for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      const v = merge3(b[k], local[k], remote[k])
      if (v !== undefined) out[k] = v
    }
    return out
  }
  return local
}
