/**
 * FieldLabel — the micro, uppercase label that sits above a form control.
 *
 * Tier 1 atom. Canonicalizes the ~11 hand-rolled `text-xs font-medium uppercase
 * tracking-wide` labels across the tools into one `<label>` element that reuses
 * the existing `.section-label` class from global.css (so it re-themes with the
 * design tokens automatically).
 *
 * It is a real `<label>` with `htmlFor`, so clicking the label focuses its
 * control (native behaviour) — a free accessibility + usability win over the
 * `<div>`/`<span>` labels most tools hand-rolled. Pair it with a control that
 * carries a matching `id`:
 *
 *   <FieldLabel htmlFor="due">Due date</FieldLabel>
 *   <DateInput id="due" … />
 *
 * @param {string} [htmlFor]   id of the control this labels (enables click-to-focus).
 * @param {boolean} [required=false]  Show a decorative asterisk. The control must
 *   also set `required`/`aria-required` — the asterisk is `aria-hidden`, not the
 *   accessible source of required-ness.
 * @param {React.ReactNode} children  The label text.
 * @param {string} [className='']  Extra utilities (e.g. spacing overrides).
 * @param {object} [rest]  Passed to <label>.
 */
export default function FieldLabel({
  htmlFor,
  required = false,
  children,
  className = '',
  ...rest
}) {
  return (
    <label htmlFor={htmlFor} className={`section-label ${className}`.trim()} {...rest}>
      {children}
      {required && (
        <span className="text-[var(--color-error)]" aria-hidden="true">
          {' *'}
        </span>
      )}
    </label>
  )
}
