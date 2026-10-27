/**
 * Select — a native dropdown, styled to the design system.
 *
 * Tier 1 atom. Canonicalizes the ~12 hand-rolled `<select className="input">`
 * dropdowns across the tools. Reuses the shared `.input` class *and* the
 * `select.input` rule in global.css, which already replaces the OS arrow with a
 * consistent custom SVG chevron — so this atom inherits the branded arrow for free.
 *
 * Native `<select>` on purpose: it is fully keyboard-accessible, screen-reader
 * friendly, and mobile-native out of the box — a custom listbox would have to
 * re-earn all of that. Options come either as an `options` array (the common
 * case) or as `<option>` children (when a consumer needs <optgroup> or custom
 * markup).
 *
 * Controlled contract: `onChange` receives the next value string, matching
 * TextField/SearchInput.
 *
 * @param {string} value
 * @param {(next: string) => void} onChange
 * @param {Array<{ value: string, label: string, disabled?: boolean }>} [options]
 * @param {string} [placeholder]  Renders a disabled leading option (empty value).
 * @param {boolean} [disabled=false]
 * @param {string} [id]  Wire to a FieldLabel's htmlFor.
 * @param {string} [className='']
 * @param {React.ReactNode} [children]  Use instead of `options` for optgroups/custom.
 * @param {object} [rest]  Passed to <select> (required, aria-*, name, …).
 */
export default function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  id,
  className = '',
  children,
  ...rest
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      disabled={disabled}
      className={`input ${className}`.trim()}
      {...rest}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  )
}
