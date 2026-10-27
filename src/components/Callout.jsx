import { Info, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react'

/**
 * Callout — a bordered, tinted notice box for inline messages.
 *
 * Tier 1 atom. Canonicalizes the 10 tools that hand-roll colored notice boxes
 * (`bg-red-50 border border-red-200 rounded-lg p-3 …`) — which were also a token
 * violation, using raw Tailwind palette colors instead of the semantic tokens.
 * This atom paints from `--color-info|success|warning|error` via the same
 * `color-mix` tint idiom Badge uses, so notices re-theme with the design system.
 *
 * Accessibility: urgency maps to ARIA role — `error`/`warning` are `role="alert"`
 * (assertive, interrupts), `info`/`success` are `role="status"` (polite). The
 * per-tone icon is decorative (`aria-hidden`); the message text carries meaning,
 * and the tone color is never the sole signal (WCAG 1.4.1).
 *
 * @param {'info'|'success'|'warning'|'error'} [tone='info']
 * @param {React.ComponentType<{ size?: number }>} [icon]  Override the default tone icon.
 * @param {React.ReactNode} [title]  Optional bold lead line.
 * @param {React.ReactNode} children  The message body.
 * @param {string} [className='']
 * @param {object} [rest]  Passed to the wrapper.
 */

// A wash of a semantic token over the live surface (same idiom as Toast),
// computed at paint time so one token change re-tints every callout of that
// tone. Mixing toward the surface, not white, is what keeps it a *dark* tint in
// dark mode — mixing toward white painted a near-white box under near-white text.
const tint = (token, pct) => `color-mix(in srgb, var(${token}) ${pct}%, var(--color-bg-surface))`

const TONES = {
  info: { token: '--color-info', Icon: Info, assertive: false },
  success: { token: '--color-success', Icon: CheckCircle2, assertive: false },
  warning: { token: '--color-warning', Icon: AlertTriangle, assertive: true },
  error: { token: '--color-error', Icon: AlertCircle, assertive: true },
}

export default function Callout({
  tone = 'info',
  icon: IconOverride,
  title,
  children,
  className = '',
  ...rest
}) {
  const { token, Icon, assertive } = TONES[tone] ?? TONES.info
  const Glyph = IconOverride ?? Icon

  return (
    <div
      role={assertive ? 'alert' : 'status'}
      className={`rounded-[var(--radius-card)] flex items-start gap-2 ${className}`.trim()}
      style={{
        background: tint(token, 12),
        border: `1px solid ${tint(token, 35)}`,
        color: 'var(--color-text-body)',
        padding: 'var(--space-3)',
      }}
      {...rest}
    >
      <Glyph size={16} aria-hidden="true" className="shrink-0" style={{ color: `var(${token})`, marginTop: '0.125rem' }} />
      <div className="text-sm">
        {title && <div className="font-semibold" style={{ marginBottom: '0.125rem' }}>{title}</div>}
        {children}
      </div>
    </div>
  )
}
