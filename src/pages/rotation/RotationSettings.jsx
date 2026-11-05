import { Plus, Trash2 } from 'lucide-react'
import Card from '../../components/Card.jsx'
import Button from '../../components/Button.jsx'
import { allBlockIds, blockLabel } from './model.js'

// Duties, job titles, and the participation records. Text fields save on
// blur (onBlur), not per keystroke, so typing never pushes a sync per letter.
export default function RotationSettings({ state, recordCount, onChange, onExportAll, onClearHistory }) {
  const ids = allBlockIds(state)

  return (
    <div className="space-y-6">
      <Card padding="lg">
        <h2 className="text-base font-semibold text-[var(--color-text-body)]">Extra duties</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-1 mb-4">
          Tick the classes each duty applies to. Duties move one kitchen per rotation. A kitchen never repeats a duty within a day, since the next period works the same station.
        </p>
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-secondary)]">
                <th className="py-1.5 pr-3 font-medium">Duty</th>
                {ids.map(id => <th key={id} className="py-1.5 px-2 font-medium text-center">{blockLabel(state, id)}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {state.duties.map((d, i) => (
                <tr key={`${i}-${d.text}`} className="border-t border-[var(--color-border-subtle)]">
                  <td className="py-1.5 pr-3">
                    <input className="input min-w-[14rem]" defaultValue={d.text} aria-label="Duty"
                      onBlur={e => { const v = e.target.value.trim(); if (v !== d.text) onChange(s => { s.duties[i].text = v || 'Duty' }) }} />
                  </td>
                  {ids.map(id => (
                    <td key={id} className="py-1.5 px-2 text-center">
                      <input type="checkbox" checked={!!d.apply[id]} aria-label={`${d.text} in ${blockLabel(state, id)}`}
                        onChange={e => { const on = e.target.checked; onChange(s => { s.duties[i].apply[id] = on }) }} />
                    </td>
                  ))}
                  <td className="py-1.5 pl-2">
                    <button aria-label={`Remove ${d.text}`} onClick={() => onChange(s => { s.duties.splice(i, 1) })}
                      className="p-1.5 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-bg-hover)]">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {state.duties.length === 0 && (
                <tr><td colSpan={ids.length + 2} className="py-2 text-[var(--color-text-muted)]">No duties yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Button size="sm" variant="secondary" icon={Plus}
            onClick={() => onChange(s => { s.duties.push({ text: 'New duty', apply: Object.fromEntries(allBlockIds(s).map(id => [id, false])) }) })}>
            Add duty
          </Button>
        </div>
      </Card>

      <Card padding="lg">
        <h2 className="text-base font-semibold text-[var(--color-text-body)]">Job titles</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-1 mb-4">
          Titles belong to the seat, not the student. A kitchen smaller than this list shows SPLIT for the leftover jobs, which the whole kitchen shares.
        </p>
        <div className="space-y-2 max-w-md">
          {state.jobTitles.map((t, i) => (
            <div key={`${i}-${t}`} className="flex items-center gap-3">
              <span className="w-14 text-sm text-[var(--color-text-secondary)]">Seat {i + 1}</span>
              <input className="input" defaultValue={t} aria-label={`Seat ${i + 1} title`}
                onBlur={e => { const v = e.target.value.trim() || `Seat ${i + 1}`; if (v !== t) onChange(s => { s.jobTitles[i] = v }) }} />
            </div>
          ))}
        </div>
      </Card>

      <Card padding="lg">
        <h2 className="text-base font-semibold text-[var(--color-text-body)]">Participation records</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-1 mb-4">
          Each rotation records what the class just finished, so rotate at the end of a session, not the start. The last 90 rotations per class are kept and sync across your devices. A class’s history is in its ⋮ menu.
        </p>
        <p className="text-sm text-[var(--color-text-body)] mb-3">
          {recordCount == null ? 'Counting…' : recordCount === 0 ? 'No rotations recorded yet.' : `${recordCount} rotation${recordCount === 1 ? '' : 's'} recorded.`}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onExportAll} disabled={!recordCount}>Export participation CSV</Button>
          <Button size="sm" variant="ghost" onClick={onClearHistory} disabled={!recordCount}>Clear history…</Button>
        </div>
      </Card>
    </div>
  )
}
