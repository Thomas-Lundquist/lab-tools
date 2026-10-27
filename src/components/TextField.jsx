/**
 * TextField — a single-line text/number/email input.
 *
 * Tier 1 atom. Canonicalizes the ~18 hand-rolled `<input className="input">`
 * fields across the tools. A thin, controlled wrapper over the shared `.input`
 * class in global.css. For numeric entry use the sibling `NumberField` atom,
 * which hides the native spin buttons and draws theme-styled steppers — reach
 * for `type="number"` here only for a bare numeric field with no increment UI.
 *
 * Controlled contract: `onChange` receives the next string *value*, not the DOM
 * event — matching SearchInput, so consumers skip the `e.target.value` unwrap.
 *
 * Deliberately label-less: pair with <FieldLabel htmlFor={id}> at the call site
 * (composition over a baked-in label), so labelled and unlabelled uses share one
 * atom. `id` wires the two together.
 *
 * @param {string|number} value
 * @param {(next: string) => void} onChange  Handed the next value.
 * @param {string} [type='text']  Any text-like input type (text|number|email|url|tel|password).
 * @param {string} [placeholder]
 * @param {boolean} [disabled=false]
 * @param {string} [id]           Wire to a FieldLabel's htmlFor.
 * @param {string} [className='']
 * @param {object} [rest]  Passed to <input> — min/max/step, required, aria-*, inputMode, etc.
 */
export default function TextField({
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled = false,
  id,
  className = '',
  ...rest
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`input ${className}`.trim()}
      {...rest}
    />
  )
}
