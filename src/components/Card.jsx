/**
 * Card — a surface container: rounded, bordered panel on the page background.
 *
 * Tier 1 atom. Canonicalizes the 18 tools that hand-roll `className="card p-4"`
 * / `"card p-5"` into one component that wraps the shared `.card` class (which
 * owns the surface colour, border, and radius) and adds a padding scale.
 *
 * Padding is driven by the `--space-*` tokens rather than fixed Tailwind
 * utilities, so a future `data-density` remap (doc 10, "Spacing Modes") reflows
 * every card at once — the whole reason the design system consumes tokens.
 *
 * @param {'none'|'sm'|'md'|'lg'} [padding='md']  Inner padding, from the space scale.
 * @param {string} [className='']
 * @param {object} [style]  Merged after padding (caller can override).
 * @param {React.ReactNode} children
 * @param {object} [rest]  Passed to the <div> (role, aria-*, data-*, …).
 */
const PAD_TOKEN = {
  none: '0',
  sm: 'var(--space-3)', // 0.75rem
  md: 'var(--space-4)', // 1rem  — list-row / default card
  lg: 'var(--space-5)', // 1.5rem — roomy card
}

export default function Card({ padding = 'md', className = '', style, children, ...rest }) {
  return (
    <div
      className={`card ${className}`.trim()}
      style={{ padding: PAD_TOKEN[padding] ?? PAD_TOKEN.md, ...style }}
      {...rest}
    >
      {children}
    </div>
  )
}
