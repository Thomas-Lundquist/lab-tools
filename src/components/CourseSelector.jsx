import { ChevronDown } from 'lucide-react'

// Course names only ("Culinary 1 Semester 1"); Canvas's long term name
// ("2027-Skyline Senior High-Semester 1") is added only where two courses share
// a name, and is always in the tooltip.
export default function CourseSelector({ courses, selectedId, onChange, loading }) {
  const selected = courses.find(c => String(c.id) === String(selectedId))
  const dupName = name => courses.filter(c => c.name === name).length > 1
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
                {c.name}{c.term && dupName(c.name) ? ` — ${c.term}` : ''}
              </option>
            ))}
          </>
        )}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
    </div>
  )
}
