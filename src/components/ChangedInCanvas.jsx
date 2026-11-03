import { AlertTriangle } from 'lucide-react'

// Students whose scores were changed in Canvas since Lab Tools last wrote them
// (a makeup, a hand edit). Left alone unless the teacher turns on Overwrite.
// students: [{ userId, userName, outside: [reason], overwriting }]
// verb: 'commit' | 'revert' | 'push'
export default function ChangedInCanvas({ students, verb, onToggle, onToggleAll }) {
  const allOn = students.length > 0 && students.every(s => s.overwriting)
  return (
    <div className="rounded-[var(--radius-control)] border-2 border-[var(--color-warning)] p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-start gap-1.5 text-sm font-medium text-[var(--color-text-body)]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
          Changed in Canvas since Lab Tools last wrote {students.length === 1 ? 'it' : 'them'} ({students.length})
        </p>
        {onToggleAll && students.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs shrink-0 text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={allOn} onChange={() => onToggleAll(!allOn)} />
            Overwrite all
          </label>
        )}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        A makeup or a hand edit. Left as is unless you choose Overwrite{verb === 'revert' ? ', which puts back the score from before' : ''}.
      </p>
      <ul className="max-h-60 overflow-y-auto divide-y divide-[var(--color-border-subtle)]">
        {students.map(s => (
          <li key={s.userId} className="py-1.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-[var(--color-text-body)]">{s.userName ?? 'A student'}</p>
              {s.outside.map(r => <p key={r} className="text-xs text-[var(--color-text-muted)]">{r}</p>)}
            </div>
            <label className="flex items-center gap-1.5 text-xs shrink-0 text-[var(--color-text-secondary)]">
              <input type="checkbox" checked={!!s.overwriting} onChange={() => onToggle(s.userId)} />
              Overwrite
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
