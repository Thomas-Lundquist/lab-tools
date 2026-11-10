/**
 * Textarea — a multi-line text input.
 *
 * Tier 1 atom, the multi-line sibling of TextField.jsx. Same controlled
 * contract: `onChange` receives the next string value, not the DOM event.
 *
 * Deliberately label-less: pair with <FieldLabel htmlFor={id}> at the call
 * site, same as TextField.
 *
 * @param {string} value
 * @param {(next: string) => void} onChange
 * @param {string} [placeholder]
 * @param {boolean} [disabled=false]
 * @param {string} [id]
 * @param {number} [rows=6]
 * @param {string} [className='']
 * @param {object} [rest]  Passed to <textarea> — required, aria-*, etc.
 */
export default function Textarea({
  value,
  onChange,
  placeholder,
  disabled = false,
  id,
  rows = 6,
  className = '',
  ...rest
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      className={`input font-mono text-xs ${className}`.trim()}
      {...rest}
    />
  )
}
