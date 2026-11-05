import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, UserX } from 'lucide-react'
import Modal from '../../components/Modal.jsx'
import Button from '../../components/Button.jsx'
import Select from '../../components/Select.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import { getCourses } from '../../api/courses.js'
import { getSections } from '../../api/sections.js'
import { getSetup } from '../../storage/setup.js'
import { MAX_KITCHEN, NUM_KITCHENS, activeKitchenIdxs, isAbsent, kitchenOf, dateStamp } from './model.js'
import { matchSection } from './roster.js'

export function ConfirmModal({ title, body, confirmLabel, danger, onConfirm, onClose }) {
  return (
    <Modal title={title} size="sm" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onClose(); onConfirm() }}>{confirmLabel}</Button>
      </>}>
      <p className="text-sm text-[var(--color-text-body)]">{body}</p>
    </Modal>
  )
}

// One student: today's attendance, which kitchen, which job, or unseat.
export function StudentModal({ block, uid, name, onAbsent, onPlace, onNudge, onUnseat, onClose }) {
  const ki = kitchenOf(block, uid)
  const seated = ki >= 0
  const away = isAbsent(block, uid)
  const at = seated ? block.kitchens[ki].students.indexOf(uid) : -1
  return (
    <Modal title={name} subtitle={seated ? `Kitchen ${ki + 1}` : 'Not seated'} size="sm" onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-5">
        {seated && (
          <div>
            <FieldLabel>Today</FieldLabel>
            <div className="flex gap-2 mt-1">
              <Button variant={away ? 'secondary' : 'success'} onClick={() => onAbsent(false)} aria-pressed={!away}>Present</Button>
              <Button variant={away ? 'danger' : 'secondary'} onClick={() => onAbsent(true)} aria-pressed={away}>Absent</Button>
            </div>
          </div>
        )}
        <div>
          <FieldLabel>{seated ? 'Move to kitchen' : 'Seat in kitchen'}</FieldLabel>
          <div className="grid grid-cols-4 gap-2 mt-1">
            {Array.from({ length: NUM_KITCHENS }, (_, k) => {
              const n = block.kitchens[k].students.length
              const full = n >= MAX_KITCHEN && k !== ki
              return (
                <button key={k} disabled={full} onClick={() => onPlace(k)}
                  className={`px-2 py-2 text-sm rounded-[var(--radius-control)] border disabled:opacity-40 disabled:cursor-not-allowed ${k === ki ? 'border-[var(--color-border-strong)] bg-[var(--color-bg-hover)] font-semibold' : 'border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]'} text-[var(--color-text-body)]`}>
                  K{k + 1} <span className="text-xs text-[var(--color-text-muted)]">({n})</span>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">A move puts them at the bottom job of that kitchen; the rotation brings them round.</p>
        </div>
        {seated && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={ArrowUp} disabled={at <= 0} onClick={() => onNudge(-1)}>Job up</Button>
            <Button size="sm" variant="secondary" icon={ArrowDown} disabled={at >= block.kitchens[ki].students.length - 1} onClick={() => onNudge(1)}>Job down</Button>
            <Button size="sm" variant="ghost" icon={UserX} onClick={onUnseat}>Unseat</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// The register for one class. Chips stay in stored order so they don't
// reshuffle under the finger while attendance is being taken.
export function AttendanceModal({ title, block, nameOf, onToggle, onClear, onClose }) {
  return (
    <Modal title={title} subtitle="Tap a student to mark them out today. Marks clear at the next rotation, or overnight." onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClear}>Mark all present</Button>
        <Button onClick={onClose}>Done</Button>
      </>}>
      <div className="space-y-3">
        {activeKitchenIdxs(block).map(ki => (
          <div key={ki} className="flex items-start gap-3">
            <span className="w-8 pt-1.5 text-sm font-semibold text-[var(--color-text-secondary)]">K{ki + 1}</span>
            <div className="flex flex-wrap gap-1.5">
              {block.kitchens[ki].students.map(uid => {
                const away = isAbsent(block, uid)
                return (
                  <button key={uid} onClick={() => onToggle(uid)} aria-pressed={away}
                    className={`text-sm px-2.5 py-1.5 rounded-[var(--radius-control)] border ${away ? 'line-through border-[var(--color-error)] text-[var(--color-text-body)] bg-[var(--color-danger-fill)]' : 'border-[var(--color-border)] text-[var(--color-text-body)] hover:bg-[var(--color-bg-hover)]'}`}>
                    {nameOf(uid)}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

const formatDay = iso => {
  const [y, m, d] = String(iso).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return isNaN(date) ? iso : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function HistoryModal({ title, history, nameOf, onExport, onClose }) {
  const [week, setWeek] = useState(false)
  const all = history ? history.records.slice().reverse() : null
  const cutoff = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return dateStamp(d) })()
  const shown = all && (week ? all.filter(r => r.d >= cutoff) : all)
  return (
    <Modal title={title} size="lg" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onExport} disabled={!all?.length}>Export this class</Button>
        <Button onClick={onClose}>Done</Button>
      </>}>
      <div className="flex gap-2 mb-4">
        <Button size="sm" variant={week ? 'secondary' : 'primary'} onClick={() => setWeek(false)}>All</Button>
        <Button size="sm" variant={week ? 'primary' : 'secondary'} onClick={() => setWeek(true)}>Last 7 days</Button>
      </div>
      {!shown ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        : shown.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            {all.length === 0 ? 'Nothing recorded for this class yet. A record is written each time it rotates.' : 'Nothing in the last seven days.'}
          </p>
        ) : (
          <div className="space-y-4">
            {shown.map(rec => (
              <div key={rec.b + rec.d}>
                <h3 className="text-sm font-semibold text-[var(--color-text-body)] mb-1">{formatDay(rec.d)}</h3>
                <div className="space-y-1">
                  {rec.k.map(kr => {
                    const absent = new Set(kr.ab || [])
                    return (
                      <p key={kr.i} className="text-xs text-[var(--color-text-secondary)]">
                        <b className="text-[var(--color-text-body)]">K{kr.i + 1}</b>
                        {' — '}{[kr.du, kr.cs ? 'Center Sink' : ''].filter(Boolean).join(' · ') || 'no duty'}
                        <br />
                        {kr.s.map((uid, row) => (
                          <span key={uid} className={absent.has(uid) ? 'text-[var(--color-error)]' : ''}>
                            {row > 0 && ', '}{nameOf(uid)} ({rec.t?.[row] || `Seat ${row + 1}`}{absent.has(uid) ? ', out' : ''})
                          </span>
                        ))}
                      </p>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
    </Modal>
  )
}

// Starting a class in an empty period: pick its Canvas section. Sections whose
// name points at this period ("1A" for A1) are listed first and preselected.
// Courses are the ones set up in Labs if any are; otherwise every course the
// teacher teaches (read-only — the rotator never changes Labs setup).
export function StartClassModal({ day, pos, usedSectionIds, onStart, onClose }) {
  const [options, setOptions] = useState(null)
  const [error, setError] = useState(null)
  const [choice, setChoice] = useState('')
  const [course, setCourse] = useState('1')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [courses, setup] = await Promise.all([getCourses(), getSetup()])
      const enabled = courses.filter(c => setup.courses?.[c.id]?.enabled)
      const list = enabled.length ? enabled : courses
      const withSections = await Promise.all(list.map(async c => ({ course: c, sections: await getSections(c.id) })))
      const opts = withSections.flatMap(({ course: c, sections }) => sections.map(s => {
        const m = matchSection(s.name)
        return {
          value: `${c.id}:${s.id}`, courseId: c.id, sectionId: s.id, courseName: c.name,
          label: `${s.name} — ${c.name} (${s.studentCount})`,
          suggested: !!m && m.day === day && m.pos === pos,
          used: usedSectionIds.has(s.id),
        }
      }))
      opts.sort((a, b) => (b.suggested - a.suggested) || a.label.localeCompare(b.label))
      if (cancelled) return
      setOptions(opts)
      const first = opts.find(o => o.suggested && !o.used)
      if (first) { setChoice(first.value); setCourse(/\b2\b|\bII\b/.test(first.courseName) ? '2' : '1') }
    })().catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [day, pos, usedSectionIds])

  const picked = useMemo(() => options?.find(o => o.value === choice), [options, choice])

  return (
    <Modal title={`Start a class at ${day}${pos + 1}`} size="sm" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!picked} onClick={() => onStart({ courseId: picked.courseId, sectionId: picked.sectionId, course: Number(course) })}>Start class</Button>
      </>}>
      {error ? <p className="text-sm text-[var(--color-error)]">Couldn’t load your courses: {error}</p>
        : !options ? <p className="text-sm text-[var(--color-text-muted)]">Loading your Canvas sections…</p>
        : (
          <div className="space-y-4">
            <div>
              <FieldLabel htmlFor="start-section">Canvas section</FieldLabel>
              <Select id="start-section" value={choice} placeholder="Pick a section"
                onChange={v => { setChoice(v); const o = options.find(x => x.value === v); if (o) setCourse(/\b2\b|\bII\b/.test(o.courseName) ? '2' : '1') }}
                options={options.map(o => ({ value: o.value, label: `${o.suggested ? '★ ' : ''}${o.label}${o.used ? ' — already on the board' : ''}`, disabled: o.used }))} />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">★ the section name matches {day}{pos + 1}. The roster comes from Canvas and stays in step with it.</p>
            </div>
            <div>
              <FieldLabel htmlFor="start-course">Class type</FieldLabel>
              <Select id="start-course" value={course} onChange={setCourse}
                options={[{ value: '1', label: 'Culinary 1' }, { value: '2', label: 'Culinary 2' }]} />
            </div>
          </div>
        )}
    </Modal>
  )
}
