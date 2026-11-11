import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

// A collapsible section for long list-type settings (courses, templates,
// flags, comment bank) so a short list stays visible but a long one doesn't
// dominate the page. `defaultOpen` is left to the caller so a short list can
// start expanded while a long one starts collapsed.
export default function Disclosure({ title, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--color-bg-hover)] rounded-[var(--radius-control)]"
      >
        <span className="text-sm font-medium text-[var(--color-text-body)]">
          {title}
          {count != null && <span className="font-normal text-[var(--color-text-muted)]"> ({count})</span>}
        </span>
        {open
          ? <ChevronDown size={16} className="shrink-0 text-[var(--color-text-muted)]" />
          : <ChevronRight size={16} className="shrink-0 text-[var(--color-text-muted)]" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-3 border-t border-[var(--color-border-subtle)]">{children}</div>}
    </div>
  )
}
