import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react'
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = {
  success: CheckCircle,
  error:   AlertCircle,
  warning: AlertTriangle,
  info:    Info,
}

// Status palette → semantic tokens (was raw bg-green-50/text-red-800/etc).
// Background/border are a tint of the status token against the current surface,
// so the wash is pale in light mode and deepened in dark mode from one formula.
// Text + icon use the solid token — Badge verified token-on-12%-tint reads
// >=4.5:1, so the coloured label stays accessible in both themes.
const STATUS_TOKEN = {
  success: '--color-success',
  error:   '--color-error',
  warning: '--color-warning',
  info:    '--color-info',
}

// N% of the status token, remainder the live surface colour.
const tint = (token, pct) => `color-mix(in srgb, var(${token}) ${pct}%, var(--color-bg-surface))`

function statusStyle(type) {
  const token = STATUS_TOKEN[type] ?? STATUS_TOKEN.info
  return {
    container: { backgroundColor: tint(token, 12), borderColor: tint(token, 32) },
    accent:    { color: `var(${token})` },
  }
}

// success/info auto-dismiss; warning/error require manual dismissal
const DEFAULT_DURATION = { success: 5000, info: 5000, warning: null, error: null }

const EXIT_DELAY = 150
const MAX_VISIBLE = 3
const MAX_QUEUE = 20

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timerRefs = useRef(new Map())      // id → timeoutId
  const timerStartRefs = useRef(new Map()) // id → { startedAt, totalMs } — null startedAt = paused
  const exitTimerRefs = useRef(new Set())  // EXIT_DELAY timeout IDs waiting to filter a dismissed toast
  const toastsRef = useRef(toasts)         // stable ref so event listeners don't need toasts in deps

  useEffect(() => { toastsRef.current = toasts }, [toasts])

  // Cancel all pending timers when the provider unmounts
  useEffect(() => {
    const timers = timerRefs.current
    const exitTimers = exitTimerRefs.current
    return () => {
      for (const id of timers.values()) clearTimeout(id)
      for (const id of exitTimers) clearTimeout(id)
    }
  }, [])

  const startTimer = useCallback((id, ms) => {
    const timerId = setTimeout(() => {
      setToasts(t => t.map(x => x.id === id ? { ...x, exiting: true } : x))
      const exitId = setTimeout(() => {
        exitTimerRefs.current.delete(exitId)
        setToasts(t => t.filter(x => x.id !== id))
      }, EXIT_DELAY)
      exitTimerRefs.current.add(exitId)
    }, ms)
    timerRefs.current.set(id, timerId)
    timerStartRefs.current.set(id, { startedAt: Date.now(), totalMs: ms })
  }, [])

  const clearTimer = useCallback(id => {
    const timerId = timerRefs.current.get(id)
    if (timerId !== undefined) {
      clearTimeout(timerId)
      timerRefs.current.delete(id)
    }
    timerStartRefs.current.delete(id)
  }, [])

  const dismiss = useCallback(id => {
    clearTimer(id)
    setToasts(t => t.map(x => x.id === id ? { ...x, exiting: true } : x))
    const exitId = setTimeout(() => {
      exitTimerRefs.current.delete(exitId)
      setToasts(t => t.filter(x => x.id !== id))
    }, EXIT_DELAY)
    exitTimerRefs.current.add(exitId)
  }, [clearTimer])

  // Start timers only when a toast becomes visible; cancel when it leaves the visible window
  useEffect(() => {
    const visible = toasts.slice(0, MAX_VISIBLE)
    const visibleIds = new Set(visible.map(t => t.id))

    for (const id of [...timerRefs.current.keys()]) {
      if (!visibleIds.has(id)) clearTimer(id)
    }

    for (const t of visible) {
      if (!timerRefs.current.has(t.id) && t.duration && !t.exiting) {
        startTimer(t.id, t.duration)
      }
    }
  }, [toasts, startTimer, clearTimer])

  // Escape dismisses the topmost visible toast; skip when focus is in a form field
  useEffect(() => {
    const onKeyDown = e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return
      const visible = toastsRef.current.slice(0, MAX_VISIBLE)
      if (e.key === 'Escape' && visible.length > 0) dismiss(visible.at(-1).id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismiss])

  // Resume hover-paused timers when the tab regains visibility
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return
      for (const [id, entry] of timerStartRefs.current.entries()) {
        if (entry.startedAt === null && entry.totalMs > 0) startTimer(id, entry.totalMs)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [startTimer])

  const toast = useCallback((message, type = 'info', options = {}) => {
    const { actions, duration: customDuration } = typeof options === 'object' ? options : {}
    const hasActions = Array.isArray(actions) && actions.length > 0
    const duration = hasActions ? null : (customDuration ?? DEFAULT_DURATION[type] ?? null)
    const id = Date.now() + Math.random()
    // Append so the queue is FIFO; cap at MAX_QUEUE to bound memory
    setToasts(prev => [
      ...prev.slice(-(MAX_QUEUE - 1)),
      { id, message, type, exiting: false, duration, actions: actions ?? [] },
    ])
  }, [])

  const handleMouseEnter = useCallback(id => {
    if (!timerRefs.current.has(id)) return
    const { startedAt, totalMs } = timerStartRefs.current.get(id) ?? {}
    if (!startedAt) return
    clearTimer(id)
    const remaining = Math.max(0, totalMs - (Date.now() - startedAt))
    // startedAt: null signals "paused"
    timerStartRefs.current.set(id, { startedAt: null, totalMs: remaining })
  }, [clearTimer])

  const handleMouseLeave = useCallback(id => {
    const entry = timerStartRefs.current.get(id)
    if (!entry || entry.startedAt !== null) return
    if (entry.totalMs > 0) startTimer(id, entry.totalMs)
  }, [startTimer])

  const visibleToasts = toasts.slice(0, MAX_VISIBLE)
  const politeToasts = visibleToasts.filter(t => t.type === 'success' || t.type === 'info')
  const assertiveToasts = visibleToasts.filter(t => t.type === 'warning' || t.type === 'error')

  return (
    <ToastContext.Provider value={toast}>
      {children}

      {/* Screen-reader live regions — always in the DOM, never removed */}
      <div role="status" aria-live="polite" aria-atomic="false" className="sr-only">
        {politeToasts.map(t => <div key={t.id}>{t.message}</div>)}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="false" className="sr-only">
        {assertiveToasts.map(t => <div key={t.id}>{t.message}</div>)}
      </div>

      {/* Visual toast stack — top-right, newest visible on top (reverse FIFO order) */}
      <div className="fixed top-6 right-6 flex flex-col gap-2 z-50 pointer-events-none">
        {[...toasts.slice(0, MAX_VISIBLE)].reverse().map(t => {
          const Icon = ICONS[t.type] ?? ICONS.info
          const s = statusStyle(t.type)
          return (
            <div
              key={t.id}
              onMouseEnter={() => handleMouseEnter(t.id)}
              onMouseLeave={() => handleMouseLeave(t.id)}
              style={s.container}
              className={`flex flex-col px-4 py-3 rounded-xl border shadow-lg text-sm pointer-events-auto max-w-sm ${t.exiting ? 'toast-exit' : 'toast-enter'}`}
            >
              <div className="flex items-start gap-3">
                <Icon size={16} aria-hidden="true" style={s.accent} className="shrink-0 mt-0.5" />
                <span className="flex-1 font-medium" style={s.accent}>{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 hover:opacity-70 transition-opacity"
                  style={s.accent}
                  aria-label="Dismiss notification"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              {t.actions.length > 0 && (
                <div className="flex gap-3 mt-2 ml-7">
                  {t.actions.map(action => (
                    <button
                      key={action.label}
                      onClick={action.onClick}
                      className="text-xs font-semibold underline underline-offset-2"
                      style={s.accent}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
