import { ChevronDown } from 'lucide-react'

export default function CourseSelector({ courses, selectedId, onChange, loading }) {
  const selected = courses.find(c => String(c.id) === String(selectedId))
  const titleText = selected ? `${selected.name}${selected.term ? ` — ${selected.term}` : ''}` : undefined

  return (
    <div className="relative flex-1 min-w-0 max-w-sm">
      <select
        value={selectedId ?? ''}
        onChange={e => onChange(e.target.value)}
        disabled={loading || courses.length === 0}
        title={titleText}
        className="appearance-none pl-3 pr-9 py-2 w-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-[var(--radius-control)] text-sm
                   font-medium text-[var(--color-text-body)] shadow-[var(--shadow-sm)]
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading && <option value="">Loading courses...</option>}
        {!loading && courses.length === 0 && <option value="">No courses found</option>}
        {!loading && courses.length > 0 && (
          <>
            <option value="" disabled>Select a course</option>
            {courses.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.term ? ` — ${c.term}` : ''}
              </option>
            ))}
          </>
        )}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
    </div>
  )
}
