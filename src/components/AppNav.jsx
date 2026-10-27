import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Check, Settings } from 'lucide-react'
import { TOOLS, MODULES } from '../config/tools.jsx'
import { pageUrl } from '../utils/nav.js'

function navigate(path) {
  if (window.location.href.includes(path)) return
  window.location.href = pageUrl(path)
}

export default function AppNav({ current }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const wasOpen = useRef(false)

  const currentTool = TOOLS.find(t => t.id === current)
  const TriggerIcon = currentTool?.Icon ?? TOOLS[0].Icon

  const close = useCallback(() => setOpen(false), [])

  // Return focus to trigger when dropdown closes
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    function onMouseDown(e) {
      if (!ref.current?.contains(e.target)) close()
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  // Group tools by module for the dropdown
  const grouped = MODULES.map(mod => ({
    ...mod,
    tools: TOOLS.filter(t => t.module === mod.id),
  })).filter(g => g.tools.length > 0)

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        className="cpt-nav-trigger flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-control)] text-sm font-medium transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <TriggerIcon size={14} />
        {currentTool?.shortLabel ?? 'Tools'}
        <ChevronDown size={12} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="cpt-nav-dropdown absolute right-0 top-full mt-1.5 w-60 bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] border border-[var(--color-border)] py-1.5 z-50 max-h-[70vh] overflow-y-auto"
          role="menu"
        >
          {grouped.map((group, gi) => (
            <div key={group.id} role="group" aria-label={group.label}>
              {/* Module header */}
              <p className={`px-4 pb-1 text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-muted)] ${gi > 0 ? 'pt-3 border-t border-[var(--color-border-subtle)] mt-1' : 'pt-2'}`}>
                {group.label}
              </p>
              {group.tools.map(tool => {
                const active = tool.id === current
                return (
                  <button
                    key={tool.id}
                    onClick={() => { navigate(tool.path); setOpen(false) }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-[var(--color-bg-hover)] transition-colors duration-75"
                    role="menuitem"
                  >
                    <tool.Icon
                      size={15}
                      style={active ? { color: 'var(--cpt-color-text)' } : undefined}
                      className={active ? '' : 'text-[var(--color-text-muted)]'}
                    />
                    <span
                      className={active ? 'font-semibold' : 'text-[var(--color-text-secondary)]'}
                      style={active ? { color: 'var(--cpt-color-text)' } : undefined}
                    >
                      {tool.label}
                    </span>
                    {active && <Check size={13} className="ml-auto shrink-0" style={{ color: 'var(--cpt-color-text)' }} />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SettingsButton() {
  return (
    <button
      onClick={() => navigate('src/settings/index.html')}
      className="p-2 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] hover:bg-[var(--color-bg-hover)] transition-colors duration-75"
      title="Settings"
      aria-label="Settings"
    >
      <Settings size={16} />
    </button>
  )
}

export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <div className="w-7 h-7 rounded-[var(--radius-control)] flex items-center justify-center shrink-0"
           style={{ backgroundColor: 'var(--cpt-color)' }}>
        <span className="text-white text-xs font-black">C</span>
      </div>
      <span className="text-sm font-semibold text-[var(--color-text-body)] hidden sm:block">Culinary Canvas Tools</span>
    </div>
  )
}

export function BrandLogo() {
  return (
    <button
      onClick={() => navigate('src/shell/index.html')}
      className="hover:opacity-80 transition-opacity shrink-0"
      aria-label="Culinary Canvas Tools home"
    >
      <BrandMark />
    </button>
  )
}
