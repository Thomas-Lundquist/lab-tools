export function darkenHex(hex, amount = 30) {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, (n >> 16) - amount)
  const g = Math.max(0, ((n >> 8) & 0xff) - amount)
  const b = Math.max(0, (n & 0xff) - amount)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

// Sets data-theme on <html> so the palette's full token set (colors, shadows,
// radii — see the [data-theme="bauhaus"] block in global.css) applies.
// Persists to localStorage so the inline <head> script can apply it before
// first paint, avoiding a flash of the wrong palette.
// The Modern theme was called 'default' before it had a name of its own. Installs
// that stored the old value are normalized here as well as in the storage
// migration, because localStorage is written from the page and the service worker
// that runs migrations cannot reach it.
export function normalizePalette(name) {
  return name === 'default' ? 'modern' : (name || 'bauhaus')
}

export function applyPalette(name = 'bauhaus') {
  const palette = normalizePalette(name)
  document.documentElement.setAttribute('data-theme', palette)
  try { localStorage.setItem('cpt_palette', palette) } catch { /* storage unavailable */ }
}

// Applies or removes the 'dark' class on <html> based on mode.
// Persists mode to localStorage so theme-init.js applies it before first paint.
export function applyDarkMode(mode = 'system') {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
  try { localStorage.setItem('cpt_theme', mode) } catch { /* storage unavailable */ }
}

// Tags <html> with the chosen size so all rem-based sizes scale proportionally.
// Persists to localStorage so theme-init.js can apply it before first paint.
//
// The sizes themselves live in global.css, keyed off this attribute — this list
// is only the valid-key whitelist. It deliberately holds no measurements: an
// earlier version mirrored the px values here, where nothing ever read them, so
// the two copies could disagree without anything visibly breaking.
export const TEXT_SIZES = ['small', 'medium', 'large', 'extra-large']

export function applyTextSize(size = 'medium') {
  const resolved = TEXT_SIZES.includes(size) ? size : 'medium'
  document.documentElement.setAttribute('data-text-size', resolved)
  // Persist the resolved value, not the raw one: theme-init.js writes whatever
  // it finds straight onto the attribute before paint, and an unrecognised key
  // matches no rule — the page would render at the browser default for a frame
  // and then jump once this ran.
  try { localStorage.setItem('cpt_text_size', resolved) } catch { /* storage unavailable */ }
}
