import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export default function Modal({ title, subtitle, children, onClose, size = 'md', footer }) {
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Mount-only: re-running this on every onClose identity change (callers routinely pass
  // an inline arrow function) re-focused the dialog's first focusable element — the close
  // button — on every keystroke in a form field further down. Read onClose via a ref instead.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const previouslyFocused = document.activeElement

    // Focus first focusable element
    const focusable = () => [...dialog.querySelectorAll(FOCUSABLE_SELECTORS)]
    focusable()[0]?.focus()

    function handleKeyDown(e) {
      if (e.key === 'Escape') { onCloseRef.current?.(); return }
      if (e.key !== 'Tab') return
      const els = focusable()
      if (!els.length) return
      if (e.shiftKey) {
        if (document.activeElement === els[0]) { e.preventDefault(); els[els.length - 1].focus() }
      } else {
        if (document.activeElement === els[els.length - 1]) { e.preventDefault(); els[0].focus() }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-5xl' }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-xl)] w-full ${widths[size]} flex flex-col max-h-[90vh]`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] flex-shrink-0">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold text-[var(--color-text-body)]">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] hover:bg-[var(--color-bg-hover)]"
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-[var(--color-border)] flex justify-end gap-3 flex-shrink-0 bg-[var(--color-bg-hover)] rounded-b-[var(--radius-card)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
