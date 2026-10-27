/**
 * EmptyState — a centered icon + headline + guidance (+ optional actions),
 * shown where a list would otherwise be blank.
 *
 * Tier 1 atom. Canonicalizes the ~25 divergent empty-state strings into one
 * layout. It owns only the rhythm and typography — each *situation* supplies
 * its own copy (never a generic "No data"), and passes its own controls into
 * the `actions` slot (typically the `Button` atom). Supports 0, 1, or 2 actions.
 *
 * Renders an <h2>: these states sit under a PageHeader (h1), so h2 keeps them
 * inside the page's heading outline. Spread `...rest` onto the wrapper so a
 * consumer can add role="status" when the emptiness is *dynamic* (e.g. a
 * filter cleared the list) and should be announced.
 *
 * @param {React.ComponentType<{ size?: number, 'aria-hidden'?: boolean }>} [icon]
 * @param {string} title  The headline for this specific situation.
 * @param {string} [body]  Optional guidance line.
 * @param {React.ReactNode} [actions]  0–2 controls (e.g. <Button>).
 * @param {object} [rest]  Passed to the wrapper (e.g. role="status").
 */

const ICON_PX = 48

export default function EmptyState({ icon: Icon, title, body, actions, ...rest }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-12" {...rest}>
      {Icon && (
        <Icon
          size={ICON_PX}
          strokeWidth={1.5}
          aria-hidden="true"
          className="text-[var(--color-text-muted)] mb-4"
        />
      )}
      <h2 className="text-[1.125rem] font-semibold text-[var(--color-text-body)]">{title}</h2>
      {body && (
        <p className="mt-2 max-w-sm text-sm text-[var(--color-text-secondary)]">{body}</p>
      )}
      {actions && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{actions}</div>
      )}
    </div>
  )
}
