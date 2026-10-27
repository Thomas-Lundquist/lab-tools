/**
 * Button — a labeled text button, optionally with a leading icon.
 *
 * Tier 1 atom. A thin typed wrapper over the existing `.btn-*` CSS classes in
 * global.css, so callers stop hand-writing class strings. Deliberately mirrors
 * IconButton's prop shape (variant / size / icon / disabled / ...rest) — the
 * two are siblings: IconButton for icon-only actions, Button for labeled ones.
 *
 * @param {'primary'|'secondary'|'danger'|'success'|'ghost'} [variant='primary']
 * @param {'sm'|'md'} [size='md']
 * @param {React.ComponentType<{ size?: number, 'aria-hidden'?: boolean }>} [icon]  Leading icon, decorative.
 * @param {() => void} [onClick]
 * @param {boolean} [disabled=false]
 * @param {'button'|'submit'|'reset'} [type='button']
 * @param {React.ReactNode} children  The label — carries meaning.
 * @param {object} [rest]  Passed to <button> (aria-*, form, data-*, etc.).
 */

const VARIANT_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  success: 'btn-success',
  ghost: 'btn-ghost',
}

// md inherits the base `.btn` sizing; sm overrides via utilities (which win
// over the components-layer `.btn` @apply — same idiom used across the tools).
const SIZE_CLASS = {
  sm: 'text-xs px-3 py-1.5',
  md: '',
}

const ICON_PX = { sm: 14, md: 16 }

export default function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  onClick,
  disabled = false,
  type = 'button',
  children,
  ...rest
}) {
  const className = `${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]}`.trim()

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={className} {...rest}>
      {Icon && <Icon size={ICON_PX[size]} aria-hidden="true" />}
      {children}
    </button>
  )
}
