import { CheckCircle, XCircle, AlertTriangle, Circle, ClipboardCopy, Trash2 } from 'lucide-react'
import { BrandLogo, SettingsButton } from '../components/AppNav.jsx'
import ToolShell from '../components/ToolShell.jsx'
import SkipLink from '../components/SkipLink.jsx'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import { navigate } from '../utils/nav.js'
import { COVERAGE } from './describe.js'
import { clearReport } from './debugMode.js'
import { buildId } from './diagnostics.js'
import { debugReportText } from './scrub.js'
import { useDebugState, useCopy } from './DebugUI.jsx'

const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

// Consecutive writes from the same action form one group.
function groupByAction(entries) {
  const groups = []
  for (const e of entries) {
    const last = groups.at(-1)
    if (last && last.action === e.action) last.entries.push(e)
    else groups.push({ action: e.action, at: e.at, entries: [e] })
  }
  return groups
}

function Status({ entry }) {
  if (entry.blocked) return <XCircle size={16} className="text-[var(--color-error)] shrink-0 mt-0.5" aria-label="Blocked" />
  if (entry.checks.some(c => c.level === 'warn')) return <AlertTriangle size={16} className="text-[var(--color-warning)] shrink-0 mt-0.5" aria-label="Warning" />
  return <CheckCircle size={16} className="text-[var(--color-success)] shrink-0 mt-0.5" aria-label="OK" />
}

function Entry({ entry }) {
  const comment = entry.body?.comment?.text_comment
  return (
    <li className="py-3 border-t border-[var(--color-border-subtle)] first:border-t-0">
      <div className="flex gap-2">
        <Status entry={entry} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm text-[var(--color-text-body)]">
            <span className="text-[var(--color-text-muted)] mr-1">#{entry.n}</span>
            {entry.blocked && <strong className="text-[var(--color-error)] mr-1">Blocked:</strong>}
            {entry.text}
          </p>
          {entry.checks.map(c => (
            <p key={c.rule} className={`text-xs ${c.level === 'block' ? 'text-[var(--color-error)]' : 'text-[var(--color-warning)]'}`}>
              {c.level === 'block' ? 'Would not send' : 'Check'}: {c.message}
            </p>
          ))}
          {typeof comment === 'string' && (
            <div className="text-xs">
              <p className="text-[var(--color-text-muted)]">Comment the student would see:</p>
              <p className="whitespace-pre-wrap rounded-[var(--radius-control)] p-2 bg-[var(--color-bg-hover)] text-[var(--color-text-body)]">{comment || '(blank)'}</p>
            </div>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-[var(--color-text-secondary)]">{entry.method} {entry.path}</summary>
            <pre className="mt-1 p-2 rounded-[var(--radius-control)] bg-[var(--color-bg-hover)] overflow-x-auto text-[var(--color-text-body)]">{JSON.stringify(entry.body, null, 2)}</pre>
          </details>
        </div>
      </div>
    </li>
  )
}

export default function DebugReport() {
  const { active, entries } = useDebugState()
  const { copy, copied, fallbackBox } = useCopy()
  const done = new Set(entries.filter(e => !e.blocked).flatMap(e => e.categories))
  const blocked = entries.filter(e => e.blocked).length
  const warned = entries.filter(e => !e.blocked && e.checks.some(c => c.level === 'warn')).length

  return (
    <>
      <SkipLink />
      <ToolShell start={<BrandLogo />} end={<SettingsButton />}>
        <div className="overflow-y-auto flex-1">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-[var(--color-text-body)]">Debug report</h1>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {active
                    ? `${entries.length} write${entries.length === 1 ? '' : 's'} recorded — none sent to Canvas. ${blocked} blocked by safety checks, ${warned} with warnings.`
                    : 'Debug mode is off. Turn it on in Settings › Testing to record writes here.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={ClipboardCopy} disabled={!entries.length}
                  onClick={() => copy(debugReportText(entries, { build: buildId() }))}>
                  {copied ? 'Copied' : 'Copy for Claude'}
                </Button>
                <Button size="sm" variant="ghost" icon={Trash2} disabled={!entries.length} onClick={clearReport}>Clear</Button>
                {!active && <Button size="sm" variant="secondary" onClick={() => navigate('settings')}>Settings</Button>}
              </div>
            </div>
            {fallbackBox}

            <Card className="space-y-3">
              <h2 className="text-base font-semibold text-[var(--color-text-body)]">
                Coverage — {COVERAGE.filter(([k]) => done.has(k)).length} of {COVERAGE.length} kinds of write tried
              </h2>
              <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                {COVERAGE.map(([key, label, how]) => (
                  <li key={key} className="flex items-start gap-2 text-sm">
                    {done.has(key)
                      ? <CheckCircle size={14} className="text-[var(--color-success)] shrink-0 mt-0.5" aria-label="Tried" />
                      : <Circle size={14} className="text-[var(--color-text-disabled)] shrink-0 mt-0.5" aria-label="Not yet" />}
                    <span>
                      <span className={done.has(key) ? 'text-[var(--color-text-body)]' : 'text-[var(--color-text-muted)]'}>{label}</span>
                      {!done.has(key) && <span className="block text-xs text-[var(--color-text-muted)]">{how}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {groupByAction(entries).map((g, i) => (
              <Card key={`${g.at}-${i}`} className="space-y-1">
                <h2 className="text-sm font-semibold text-[var(--color-text-body)]">
                  {g.action ?? 'Writes'} <span className="font-normal text-[var(--color-text-muted)]">· {fmtTime(g.at)}</span>
                </h2>
                <ul>{g.entries.map(e => <Entry key={e.n} entry={e} />)}</ul>
              </Card>
            ))}
          </div>
        </div>
      </ToolShell>
    </>
  )
}
