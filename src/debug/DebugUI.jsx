import { useState, useSyncExternalStore } from 'react'
import { FlaskConical, ClipboardCopy, Trash2, FileText } from 'lucide-react'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import { navigate, useRoute } from '../utils/nav.js'
import { getDebugState, subscribeDebug, enterDebug, exitDebug } from './debugMode.js'
import { getDiagnostics, subscribeDiagnostics, clearDiagnostics, buildId } from './diagnostics.js'
import { diagnosticsText } from './scrub.js'

export function useDebugState() {
  return useSyncExternalStore(subscribeDebug, getDebugState)
}

export function useDiagnostics() {
  return useSyncExternalStore(subscribeDiagnostics, getDiagnostics)
}

const stripes = {
  background: 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-warning) 24%, var(--color-bg-surface)) 0 14px, color-mix(in srgb, var(--color-warning) 12%, var(--color-bg-surface)) 14px 28px)',
  borderColor: 'color-mix(in srgb, var(--color-warning) 45%, var(--color-bg-surface))',
}

export async function toggleDebug(on, { route, params }) {
  if (on) await enterDebug()
  else await exitDebug()
  // Remount so every page reloads from the right storage (sandbox or real).
  const next = !on && route === 'debug' ? 'settings' : route
  navigate(next, next === route ? params : {}, { replace: true, remount: true })
}

// Shown on every page while debug mode is on — impossible to miss.
export function DebugBar() {
  const { active, entries } = useDebugState()
  const { route, params } = useRoute()
  if (!active) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-6 py-2 text-sm border-t" style={stripes}>
      <FlaskConical size={16} className="text-[var(--color-warning)] shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-[12rem] font-semibold text-[var(--color-text-body)]">
        Debug mode — nothing is being sent to Canvas
        <span className="font-normal text-[var(--color-text-secondary)]"> · {entries.length} write{entries.length === 1 ? '' : 's'} recorded</span>
      </span>
      {route !== 'debug' && <Button size="sm" variant="secondary" icon={FileText} onClick={() => navigate('debug')}>View report</Button>}
      <Button size="sm" variant="ghost" onClick={() => toggleDebug(false, { route, params })}>Turn off</Button>
    </div>
  )
}

// Clipboard first; if the browser refuses, show the text to copy by hand.
export function useCopy() {
  const [fallback, setFallback] = useState(null)
  const [copied, setCopied] = useState(false)
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setFallback(text)
    }
  }
  const fallbackBox = fallback && (
    <div className="space-y-2">
      <p className="text-xs text-[var(--color-text-muted)]">Couldn't copy automatically — select all of this and copy it:</p>
      <textarea readOnly value={fallback} rows={8} className="w-full text-xs font-mono p-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-page)] text-[var(--color-text-body)]" onFocus={e => e.target.select()} />
      <Button size="sm" variant="ghost" onClick={() => setFallback(null)}>Close</Button>
    </div>
  )
  return { copy, copied, fallbackBox }
}

const fmtTime = iso => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function TestingSection() {
  const { active } = useDebugState()
  const diagnostics = useDiagnostics()
  const { route, params } = useRoute()
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const { copy, copied, fallbackBox } = useCopy()
  const shown = showAll ? diagnostics : diagnostics.slice(0, 5)

  async function toggle() {
    setBusy(true)
    await toggleDebug(!active, { route, params })
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold text-[var(--color-text-body)]">Testing</h2>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-body)]">Debug mode</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Try anything — create pairings, take attendance, commit grades — without sending a thing to Canvas. Lab Tools still reads your real courses, works on a throwaway copy of this device's setup, and records every write it would have made in a report, with the same safety checks as live. Turning it off (or relaunching) throws the copy away.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={active ? 'secondary' : 'primary'} icon={FlaskConical} onClick={toggle} disabled={busy}>
            {active ? 'Turn off debug mode' : 'Turn on debug mode'}
          </Button>
          {active && <Button size="sm" variant="secondary" icon={FileText} onClick={() => navigate('debug')}>View report</Button>}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-body)]">Diagnostics</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Every error on this device, newest first. If something goes wrong, tap Copy for Claude and paste it into our chat — student names, ids, scores, and comments are left out.
        </p>
        {diagnostics.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No errors recorded.</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((d, i) => (
              <li key={`${d.at}-${i}`} className="text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] p-2 space-y-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono font-semibold text-[var(--color-error)]">{d.code}</span>
                  {d.count > 1 && <span className="text-xs text-[var(--color-text-muted)]">×{d.count}</span>}
                  {d.debug && <span className="text-xs text-[var(--color-warning)]">debug mode</span>}
                  <span className="text-xs text-[var(--color-text-muted)] ml-auto">{fmtTime(d.at)}</span>
                </div>
                <p className="text-[var(--color-text-body)]">{d.message}</p>
                {d.nextStep && <p className="text-xs text-[var(--color-text-secondary)]">{d.nextStep}</p>}
                {d.operation && <p className="text-xs font-mono text-[var(--color-text-muted)] break-all">{d.operation}</p>}
              </li>
            ))}
          </ul>
        )}
        {diagnostics.length > 5 && (
          <button className="text-xs underline text-[var(--color-text-secondary)]" onClick={() => setShowAll(s => !s)}>
            {showAll ? 'Show fewer' : `Show all ${diagnostics.length}`}
          </button>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={ClipboardCopy} onClick={() => copy(diagnosticsText(diagnostics, { build: buildId() }))} disabled={!diagnostics.length}>
            {copied ? 'Copied' : 'Copy for Claude'}
          </Button>
          <Button size="sm" variant="ghost" icon={Trash2} onClick={clearDiagnostics} disabled={!diagnostics.length}>Clear</Button>
        </div>
        {fallbackBox}
      </div>
    </Card>
  )
}
