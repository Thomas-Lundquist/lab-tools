import { useState, useEffect, useRef } from 'react'
import { Plus, Link2, BookOpen, AlertTriangle, Trash2, Loader, X } from 'lucide-react'
import Card from '../../components/Card.jsx'
import Button from '../../components/Button.jsx'
import Modal from '../../components/Modal.jsx'
import TextField from '../../components/TextField.jsx'
import Select from '../../components/Select.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import { useToast } from '../../components/Toast.jsx'
import { usePinGate } from '../../security/usePinGate.jsx'
import { getSections } from '../../api/sections.js'
import { getAssignments, createAssignment, deleteAssignment } from '../../api/assignments.js'
import { getAssignmentSubmissions } from '../../api/submissions.js'
import { NotFoundError } from '../../api/errors.js'
import { createOverride, updateOverride, getOverrides } from '../../api/overrides.js'
import { getModules, ensureModuleItem } from '../../api/modules.js'
import { getCourseSetup, getLabs, saveLab, deleteLab, isStandalone } from '../../storage/setup.js'
import { clearAllLabGrading } from '../../storage/labGrading.js'
import { isProfessionalismAssignment } from './scoring.js'

// JournalSelect sentinel for "no journal — standalone". The primary form
// requires an explicit pick (placeholder is disabled), so a real lab can't end
// up Standalone just because the teacher forgot to choose its Journal.
const STANDALONE = 'standalone'

// Scope options for the create form. 'all' is the historical behavior — the
// assignment is visible to the whole course. 'A' / 'B' restrict it to the
// sections tagged with that day type in Course Settings.
const SCOPE_OPTIONS = [
  { value: 'all', label: 'All sections' },
  { value: 'A', label: 'A-day sections only' },
  { value: 'B', label: 'B-day sections only' },
]

// Which sections a given scope targets. 'all' is every section; an 'A'/'B'
// scope keeps only sections tagged with that day type. Sections with no day
// type set are intentionally excluded from a scoped create — the teacher adds
// them afterward with "Add a section" once they know that section's date.
function sectionsInScope(sections, courseSetup, scope) {
  if (scope === 'all') return sections
  return sections.filter(sec => courseSetup?.sections?.[sec.id]?.dayType === scope)
}

// Normalize a title before comparing two of them. Trim + lowercase mirrors the
// comparison Scoring already uses to find a lab's assignment by name, so what
// this treats as "the same" matches what Scoring will later reconcile.
//
// This is the one tuning knob for duplicate detection. If you title the same
// lab inconsistently — "Lab 3 — Professionalism" one week, "Lab 3
// Professionalism" the next — widen this (e.g. strip punctuation and collapse
// whitespace) so both still count as a collision.
function normalizeTitle(title) {
  return title.trim().toLowerCase()
}

// Every assignment already in the course whose title collides with `title`.
// Canvas permits identical titles and does nothing to stop a second copy, so
// this is what makes "create the same lab twice" detectable. Returns all
// matches — tracked by this tool or made by hand in Canvas — so the confirm
// modal can report how many exist and offer one to reuse.
export function findDuplicateAssignments(title, assignments) {
  const target = normalizeTitle(title)
  return assignments.filter(a => normalizeTitle(a.name) === target)
}

// ISO for the end (23:59) and start (00:00) of a YYYY-MM-DD date string, in the
// browser's local zone, matching how the form writes section override dates.
function endOfDayIso(dateStr) {
  return new Date(`${dateStr}T23:59:00`).toISOString()
}
function startOfDayIso(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toISOString()
}

// A YYYY-MM-DD string shifted by a whole number of days. These offsets are fixed
// arithmetic on a date the teacher typed (the lab date) — not a guess about the
// A/B calendar — so +1 and +14 are safe to derive automatically.
function addDays(dateStr, days) {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// The lab date drives every override date. A Professionalism assignment takes no
// submission, so it opens and closes on the lab day itself. Its paired Journal
// opens the lab day, is due some days later, and closes some days after that —
// both offsets come from Course Settings (defaults: due +1 day, close +14 days
// after due).
function professionalismOverrideDates(labDate) {
  return { unlockAt: startOfDayIso(labDate), dueAt: endOfDayIso(labDate), lockAt: endOfDayIso(labDate) }
}
function journalOverrideDates(labDate, dueOffsetDays, closeOffsetDays) {
  const dueDate = addDays(labDate, dueOffsetDays)
  return {
    unlockAt: startOfDayIso(labDate),
    dueAt: endOfDayIso(dueDate),
    lockAt: endOfDayIso(addDays(dueDate, closeOffsetDays)),
  }
}

// A short scope summary for a row. An assignment that isn't override-gated is
// visible to everyone ("All sections"). A gated one is summarized by the day
// type of its section overrides — the common case is every override on the same
// day (1A + 2A → "A day"). Anything mixed, untagged, or student-targeted falls
// back to "Custom" rather than claiming a day it can't prove.
function scopeBadge(assignment, courseSetup) {
  if (!assignment) return null
  if (!assignment.onlyVisibleToOverrides) return 'All sections'
  const sectionOverrides = (assignment.overrides ?? []).filter(o => o.courseSectionId)
  if (sectionOverrides.length === 0) return 'Custom'
  const dayTypes = new Set(sectionOverrides.map(o => courseSetup?.sections?.[o.courseSectionId]?.dayType))
  if (dayTypes.size === 1) {
    const only = [...dayTypes][0]
    if (only === 'A') return 'A day'
    if (only === 'B') return 'B day'
  }
  return 'Custom'
}

// Strips a trailing "Lab" from an existing journal's name, then the full
// literal Professionalism assignment title is prefilled from it —
// e.g. "Cobb Salad Lab" -> "Cobb Salad" -> "Cobb Salad Lab Professionalism"
// (still fully editable; nothing is appended silently at submit time).
function stripLabSuffix(name) {
  return name.replace(/\s*lab\s*$/i, '').trim()
}

// requireChoice: the primary form's picker opens on a disabled placeholder,
// with "No journal — standalone" as an explicit option under it (value
// STANDALONE). The link-fallback's picker stays optional — its empty value
// already means standalone, since there the Professionalism assignment is
// picked separately.
function JournalSelect({ id, value, onChange, labOptions, otherOptions, requireChoice = false }) {
  const otherLabel = labOptions.length > 0 ? 'Other assignments' : 'Assignments'
  return (
    <Select id={id} value={value} onChange={onChange}>
      {requireChoice ? (
        <>
          <option value="" disabled>Select a journal, or standalone</option>
          <option value={STANDALONE}>No journal — standalone</option>
        </>
      ) : (
        <option value="">No journal — standalone</option>
      )}
      {labOptions.length > 0 && (
        <optgroup label="Published lab assignments">
          {labOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </optgroup>
      )}
      {otherOptions.length > 0 && (
        <optgroup label={otherLabel}>
          {otherOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </optgroup>
      )}
    </Select>
  )
}

function ModulePicker({ id, modules, value, onChange }) {
  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      options={[{ value: '', label: 'No module' }, ...modules.map(m => ({ value: m.id, label: m.name }))]}
    />
  )
}

// One lab date per section, tucked behind a native <details> so the common case
// (just the A/B-day quick-set) isn't buried under a list of every section every
// time the form is open. Every other date (professionalism close, journal due
// and close) derives from this one date, so it's the only per-section input.
function SectionDatesAccordion({ sections, dates, onChange }) {
  if (sections.length === 0) return null
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-body)] select-none">
        Per-section lab dates
      </summary>
      <div className="mt-3 space-y-2">
        {sections.map(sec => (
          <div key={sec.id} className="flex items-center gap-3">
            <span className="text-sm text-[var(--color-text-body)] w-32 shrink-0">{sec.name}</span>
            <TextField
              type="date"
              value={dates[sec.id] ?? ''}
              onChange={v => onChange(sec.id, v)}
              className="max-w-[10rem]"
              aria-label={`${sec.name} lab date`}
            />
          </div>
        ))}
      </div>
    </details>
  )
}

// One row in the list — a Pairing shows its Journal underneath, a Standalone
// has none to show. Each row can also take a new section (with its own due
// date) after the fact: an assignment first created for just the A-day or B-day
// sections gets extended to another section here, once that date is known.
function EntryRow({ entry, assignments, modules, courseId, sections, courseSetup, onAdded, onRemove }) {
  const toast = useToast()
  const mod = modules.find(m => m.id === entry.moduleId)
  const journal = assignments.find(a => a.id === entry.journalAssignmentId)
  const professionalism = assignments.find(a => a.id === entry.professionalismAssignmentId)
  const assignmentId = entry.professionalismAssignmentId
  const badge = scopeBadge(professionalism, courseSetup)

  const [open, setOpen]           = useState(false)
  const [overrides, setOverrides] = useState(null)   // null = not loaded yet
  const [sectionId, setSectionId] = useState('')
  const [labDate, setLabDate]     = useState('')
  const [busy, setBusy]           = useState(false)

  const journalDueOffset   = courseSetup?.settings?.journalDueOffsetDays ?? 1
  const journalCloseOffset = courseSetup?.settings?.labCloseDateOffsetDays ?? 14

  async function loadOverrides() {
    try { setOverrides(await getOverrides(courseId, assignmentId)) }
    catch { setOverrides([]) }
  }

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next && overrides === null) loadOverrides()
  }

  // Sections that already have an override (section-scoped only) are off the
  // list — one override per section is all Canvas keeps.
  const coveredSectionIds = new Set((overrides ?? []).map(o => o.courseSectionId).filter(Boolean))
  const availableSections = sections.filter(s => !coveredSectionIds.has(s.id))

  async function handleAdd() {
    const sec = sections.find(s => s.id === sectionId)
    if (!sec) { toast('Choose a section to add.', 'warning'); return }
    if (!labDate) { toast('Enter the lab date for the section.', 'warning'); return }
    setBusy(true)
    try {
      // Professionalism: opens and closes on the lab day. Journal (pairings
      // only): opens the lab day, due + close offsets from settings.
      await createOverride(courseId, assignmentId, {
        courseSectionId: sec.id,
        ...professionalismOverrideDates(labDate),
        title: sec.name,
      })
      if (!isStandalone(entry) && entry.journalAssignmentId) {
        await createOverride(courseId, entry.journalAssignmentId, {
          courseSectionId: sec.id,
          ...journalOverrideDates(labDate, journalDueOffset, journalCloseOffset),
          title: sec.name,
        })
      }
      toast(`Added ${sec.name} to "${professionalism?.name ?? entry.name}".`, 'success')
      setSectionId(''); setLabDate('')
      await loadOverrides()
      onAdded?.()
    } catch (err) {
      toast(`Could not add the section: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const when = fmtLabDates(entry)
  return (
    <div className="px-3 py-2 space-y-1 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[var(--color-text-body)]">{professionalism?.name ?? entry.name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] whitespace-nowrap">
              {isStandalone(entry) ? 'Standalone' : 'Pairing'}
            </span>
            {badge && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] whitespace-nowrap">
                {badge}
              </span>
            )}
          </div>
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-[var(--color-text-muted)]">
            {when && <span>{when}</span>}
            <span>{mod ? mod.name : 'No unit'}</span>
            {!isStandalone(entry) && (
              <span className="flex items-center gap-1">
                <BookOpen size={12} /> {journal ? journal.name : 'Journal not found in Canvas'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {sections.length > 0 && assignmentId && (
            <Button variant="ghost" size="sm" icon={Plus} onClick={toggleOpen} aria-expanded={open}>
              {open ? 'Close' : 'Add a section'}
            </Button>
          )}
          <button
            type="button"
            onClick={() => onRemove(entry)}
            title="Delete"
            aria-label={`Delete ${professionalism?.name ?? entry.name}`}
            className="p-1.5 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-bg-hover)]"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 rounded-[var(--radius-control)] bg-[var(--color-bg-hover)] p-3 space-y-3">
          {overrides === null ? (
            <p className="text-xs text-[var(--color-text-muted)]">Loading sections…</p>
          ) : availableSections.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">Every section already has a date on this assignment.</p>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <FieldLabel htmlFor={`sec-${entry.id}`}>Section</FieldLabel>
                  <Select
                    id={`sec-${entry.id}`}
                    value={sectionId}
                    onChange={setSectionId}
                    placeholder="Select a section"
                    options={availableSections.map(s => ({ value: s.id, label: s.name }))}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`lab-${entry.id}`}>Lab date</FieldLabel>
                  <TextField id={`lab-${entry.id}`} type="date" value={labDate} onChange={setLabDate} />
                </div>
              </div>
              <Button size="sm" icon={Plus} onClick={handleAdd} disabled={busy}>
                {busy ? 'Adding…' : 'Add section'}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// The entry's lab dates as YYYY-MM-DD strings, sorted. Linked entries have
// none; their id carries the time they were added (lab_<ms>).
function labDates(entry) {
  return [...new Set(Object.values(entry.dates ?? {}).filter(Boolean))].sort()
}
function sortDate(entry) {
  const dates = labDates(entry)
  if (dates.length) return dates[dates.length - 1]
  const ms = Number(String(entry.id).replace(/^lab_/, ''))
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : ''
}
function fmtDay(d) {
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function fmtLabDates(entry) {
  const dates = labDates(entry)
  if (dates.length === 0) return null
  if (dates.length <= 2) return dates.map(fmtDay).join(' & ')
  return `${fmtDay(dates[0])} – ${fmtDay(dates[dates.length - 1])}`
}

// The tracked assignments as one list, newest lab first, with a search and a
// Unit filter so a full year stays usable. Scrolls inside its card.
function EntryList({ entries, assignments, modules, courseId, sections, courseSetup, onAdded, onRemove }) {
  const [query, setQuery]   = useState('')
  const [unitId, setUnitId] = useState('')
  const q = query.trim().toLowerCase()
  const nameOf = e => (assignments.find(a => a.id === e.professionalismAssignmentId)?.name ?? e.name)
  const shown = entries
    .filter(e => !unitId || (unitId === 'none' ? !e.moduleId : e.moduleId === unitId))
    .filter(e => !q || nameOf(e).toLowerCase().includes(q))
    .sort((a, b) => sortDate(b).localeCompare(sortDate(a)) || String(b.id).localeCompare(String(a.id)))
  const usedModules = modules.filter(m => entries.some(e => e.moduleId === m.id))
  const anyWithoutUnit = entries.some(e => !e.moduleId)

  return (
    <div className="space-y-3">
      {entries.length > 5 && (
        <div className="flex flex-wrap gap-2">
          <TextField value={query} onChange={setQuery} placeholder="Search" aria-label="Search Professionalism assignments" className="flex-1 min-w-[10rem] max-w-sm" />
          {usedModules.length > 0 && (
            <Select value={unitId} onChange={setUnitId} aria-label="Filter by unit" className="w-48"
              options={[
                { value: '', label: 'All units' },
                ...usedModules.map(m => ({ value: m.id, label: m.name })),
                ...(anyWithoutUnit ? [{ value: 'none', label: 'No unit' }] : []),
              ]} />
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Nothing matches.</p>
      ) : (
        <div className="max-h-[28rem] overflow-y-auto divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border)]">
          {shown.map(entry => (
            <EntryRow
              key={entry.id}
              entry={entry}
              assignments={assignments}
              modules={modules}
              courseId={courseId}
              sections={sections}
              courseSetup={courseSetup}
              onAdded={onAdded}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Delete a tracked assignment: from Canvas too (the assignment and its scores),
// or from Lab Tools only. Either way the lab's saved grading here goes with it.
// The journal is never touched. Assignments linked or reused rather than made
// here default to "Lab Tools only", since someone made them by hand in Canvas.
function RemoveLabModal({ entry, assignments, courseId, courseName, onClose, onRemoved }) {
  const toast = useToast()
  const { requirePin } = usePinGate()
  const professionalism = assignments.find(a => a.id === entry.professionalismAssignmentId)
  const journal = assignments.find(a => a.id === entry.journalAssignmentId)
  const name = professionalism?.name ?? entry.name
  const madeHere = entry.origin !== 'linked' && entry.origin !== 'reused'
  const inCanvas = !!professionalism
  const [choice, setChoice] = useState(inCanvas && madeHere ? 'delete' : 'unlink')
  const [graded, setGraded] = useState(null) // students with a score or excused in Canvas; -1 = unknown
  const [busy, setBusy]     = useState(false)

  useEffect(() => {
    if (!inCanvas) return
    let cancelled = false
    getAssignmentSubmissions(courseId, entry.professionalismAssignmentId)
      .then(subs => { if (!cancelled) setGraded(subs.filter(s => s.score != null || s.excused).length) })
      .catch(() => { if (!cancelled) setGraded(-1) })
    return () => { cancelled = true }
  }, [inCanvas, courseId, entry.professionalismAssignmentId])

  async function remove(fromCanvas) {
    setBusy(true)
    try {
      if (fromCanvas) {
        try {
          await deleteAssignment(courseId, entry.professionalismAssignmentId)
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err // already gone counts as done
        }
      }
      await deleteLab(entry.id)
      await clearAllLabGrading(entry.id)
      toast(fromCanvas ? `Deleted "${name}" from Canvas` : `Removed "${name}" from Lab Tools. It's still in Canvas.`, 'success')
      onRemoved(entry, fromCanvas)
    } catch (err) {
      toast(`Could not delete "${name}": ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (choice !== 'delete') { await remove(false); return }
    try {
      await requirePin(
        {
          action: 'delete_professionalism_assignment',
          summary: `Delete "${name}" from ${courseName}`,
          courseId, courseName,
          warning: graded > 0 ? `${graded} student${graded === 1 ? ' has a score' : 's have scores'} on it.` : undefined,
        },
        () => remove(true),
        { forcePrompt: true },
      )
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  return (
    <Modal
      title={`Delete "${name}"?`}
      onClose={() => !busy && onClose()}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={choice === 'delete' ? 'danger' : 'primary'} onClick={confirm} disabled={busy || (choice === 'delete' && graded === null)}>
          <span className="flex items-center gap-1.5">
            {busy && <Loader size={13} className="animate-spin" />}
            {choice === 'delete' ? 'Delete from Canvas' : 'Remove from Lab Tools'}
          </span>
        </Button>
      </>}
    >
      <div className="text-sm text-[var(--color-text-secondary)] space-y-3">
        {inCanvas && (
          <label className="flex items-start gap-2">
            <input type="radio" name="remove-choice" checked={choice === 'delete'} onChange={() => setChoice('delete')} className="mt-1" />
            <span>
              <strong className="text-[var(--color-text-body)]">Delete from Canvas too.</strong>{' '}
              The assignment and every score on it are removed from the gradebook.
              {!madeHere && <span className="block text-xs text-[var(--color-text-muted)] mt-1">This one was {entry.origin === 'linked' ? 'linked' : 'reused'}, not created by Lab Tools.</span>}
              {graded === null && <span className="block text-xs text-[var(--color-text-muted)] mt-1">Checking Canvas for scores…</span>}
              {graded > 0 && (
                <span className="flex items-start gap-1.5 mt-1 text-[var(--color-warning)]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {graded} student{graded === 1 ? ' has a score' : 's have scores'} on it. Those are deleted too.
                </span>
              )}
              {graded === 0 && <span className="block text-xs text-[var(--color-text-muted)] mt-1">No student has a score on it yet.</span>}
            </span>
          </label>
        )}
        <label className="flex items-start gap-2">
          <input type="radio" name="remove-choice" checked={choice === 'unlink'} onChange={() => setChoice('unlink')} className="mt-1" />
          <span>
            <strong className="text-[var(--color-text-body)]">Remove from Lab Tools only.</strong>{' '}
            Canvas keeps the assignment and its scores. It leaves this list, the Lab tab, and Unit rollups.
            {!inCanvas && <span className="block text-xs text-[var(--color-text-muted)] mt-1">It’s already gone from Canvas.</span>}
          </span>
        </label>
        <p className="text-xs text-[var(--color-text-muted)]">
          Either way, the grading Lab Tools saved for this lab is cleared
          {journal ? <>. The journal &ldquo;{journal.name}&rdquo; is not touched, and its dates stay</> : null}.
        </p>
      </div>
    </Modal>
  )
}

export default function ProfessionalismPanel({ courseId, courseName, loadingCourse, ready, setupVersion, onChanged, onLabCreated, onLabRemoved, onGoToSetup }) {
  const toast = useToast()
  // Which form is open above the list: 'create', 'link', or null (list only).
  // With nothing tracked yet the create form shows on its own.
  const [mode, setMode]               = useState(null)
  const [removing, setRemoving]       = useState(null) // entry in the delete modal
  const [loading, setLoading]         = useState(false)
  const [sections, setSections]       = useState([])
  const [assignments, setAssignments] = useState([])
  const [modules, setModules]         = useState([])
  const [entries, setEntries]         = useState([])
  const [courseSetup, setCourseSetup] = useState(null)

  // Create-new form state
  const [name, setName]               = useState('')
  const [moduleId, setModuleId]       = useState('')
  const [journalId, setJournalId]     = useState(STANDALONE)
  const [scope, setScope]             = useState('all')
  const [aDate, setADateRaw]          = useState('')
  const [bDate, setBDateRaw]          = useState('')
  const [sectionDueDates, setSectionDueDates]     = useState({})
  const [creating, setCreating]       = useState(false)
  // Non-null while the duplicate-title warning is open. Holds the validated
  // create context plus the colliding assignments, so the modal's buttons can
  // drive performCreate without re-validating. See handleCreate.
  const [dupPrompt, setDupPrompt]     = useState(null)
  const touchedDueSections   = useRef(new Set())

  // Link-existing: search the course's professionalism assignments and link one
  // (with an optional Module for rollup) straight into grading.
  const [linkSearch, setLinkSearch]         = useState('')
  const [linkModuleById, setLinkModuleById] = useState({})
  const [linkingId, setLinkingId]           = useState(null)

  useEffect(() => {
    if (!courseId) { setSections([]); setAssignments([]); setModules([]); setEntries([]); setCourseSetup(null); return }
    setLoading(true)
    // This tab only cares about two kinds of assignment: lab journals (title has
    // "lab") and professionalism scores (title has "professionalism"). Fetch just
    // those two scoped sets server-side instead of every assignment in the course,
    // then merge and dedupe by id (a "… Lab Professionalism" title matches both).
    // include is trimmed to what the tab reads: module_ids (link autofill) and
    // overrides (the scope badge); assignment_group and the rest are left out.
    const opts = { include: ['module_ids', 'overrides'] }
    Promise.all([
      getSections(courseId),
      getAssignments(courseId, { ...opts, searchTerm: 'lab' }),
      getAssignments(courseId, { ...opts, searchTerm: 'professionalism' }),
      getModules(courseId),
      getLabs(courseId),
      getCourseSetup(courseId),
    ])
      .then(([secs, labAsns, profAsns, mods, l, s]) => {
        const byId = new Map()
        for (const a of [...labAsns, ...profAsns]) byId.set(a.id, a)
        setSections(secs)
        setAssignments([...byId.values()])
        setModules(mods)
        setEntries(l)
        setCourseSetup(s)
      })
      .finally(() => setLoading(false))
  }, [courseId, setupVersion])

  // Prefill each section's lab date from the A/B-day quick-set fields, unless
  // the teacher has edited that section's date directly this session.
  useEffect(() => {
    setSectionDueDates(prev => {
      const next = { ...prev }
      for (const sec of sections) {
        if (touchedDueSections.current.has(sec.id)) continue
        const day = courseSetup?.sections?.[sec.id]?.dayType
        next[sec.id] = day === 'A' ? aDate : day === 'B' ? bDate : (next[sec.id] ?? '')
      }
      return next
    })
  }, [aDate, bDate, sections, courseSetup])

  // Picking a Journal prefills two fields it already implies: the module the
  // Journal lives in (published or not — module_ids covers both), and the
  // professionalism title. Standalone implies neither, so it skips both.
  function handleJournalChange(id) {
    setJournalId(id)
    if (!id || id === STANDALONE) return
    const assignment = assignments.find(a => a.id === id)
    if (!assignment) return
    // Autofill the module to the Journal's current module, if that module is one
    // of this course's; otherwise fall back to "No module".
    const modId = (assignment.moduleIds ?? []).map(String).find(mid => modules.some(m => m.id === mid))
    setModuleId(modId ?? '')
    // Prefill the title only when the teacher hasn't already typed one.
    if (!name.trim()) setName(`${stripLabSuffix(assignment.name)} Lab Professionalism`)
  }

  // The A/B lab date drives its day type's sections. Every other date derives
  // from it at submit time, so these setters just store the raw value.
  function setADate(v) { setADateRaw(v) }
  function setBDate(v) { setBDateRaw(v) }

  function setSectionDueDate(sectionId, val) {
    touchedDueSections.current.add(sectionId)
    setSectionDueDates(prev => ({ ...prev, [sectionId]: val }))
  }

  function resetCreateForm() {
    setName(''); setModuleId(''); setJournalId(STANDALONE); setScope('all')
    setADateRaw(''); setBDateRaw('')
    setSectionDueDates({})
    touchedDueSections.current = new Set()
  }

  async function handleCreate() {
    const standalone = journalId === STANDALONE
    if (!journalId) { toast('Select a journal, or choose standalone.', 'warning'); return }
    if (!name.trim()) { toast('Enter a title for the Professionalism assignment.', 'warning'); return }
    // Scoring finds Professionalism assignments by name, not by this tool's
    // records — a title without the word would be created fine and then
    // silently never show up there.
    if (!isProfessionalismAssignment(name.trim())) {
      toast('The title needs the word "Professionalism" so Scoring can find it.', 'warning')
      return
    }
    // Re-read setup straight from storage instead of trusting the courseSetup
    // state snapshot. Tagging a section writes localStorage synchronously, but
    // the state copy only updates once its network refetch lands — so a Create
    // fired right after tagging would otherwise filter against a stale tag set
    // and reach just one section. See DECISIONS.md.
    const freshSetup = await getCourseSetup(courseId)
    if (!freshSetup?.professionalismGroupId) { toast('Set up the Professionalism assignment group first.', 'warning'); return }
    const scoped = scope !== 'all'
    const targetSections = sectionsInScope(sections, freshSetup, scope)
    if (scoped && targetSections.length === 0) {
      toast(`No sections are tagged ${scope}-day. Tag one in Course Settings, or choose All sections.`, 'warning')
      return
    }
    const expectedTitle = name.trim()
    const ctx = { expectedTitle, freshSetup, standalone, scoped, targetSections }

    // Protect against making the same lab's assignment twice. If any assignment
    // already carries this title, stop and let the teacher decide: reuse it,
    // make a second copy on purpose, or cancel. Resolved in the modal below.
    const duplicates = findDuplicateAssignments(expectedTitle, assignments)
    if (duplicates.length > 0) {
      setDupPrompt({ ctx, matches: duplicates })
      return
    }
    await performCreate(ctx, null)
  }

  // The actual Canvas create. `reuseTarget` is an existing assignment to attach
  // to (picked in the duplicate modal) or null to make a new one. Split out from
  // handleCreate so both "Reuse existing" and "Create anyway" share one path with
  // the already-validated context.
  async function performCreate(ctx, reuseTarget) {
    const { expectedTitle, freshSetup, standalone, scoped, targetSections } = ctx
    setCreating(true)
    try {
      const existing = reuseTarget
      const assignment = existing ?? await createAssignment(courseId, {
        name: expectedTitle,
        pointsPossible: 4,
        gradingType: 'points',
        submissionTypes: ['none'],
        assignmentGroupId: freshSetup.professionalismGroupId,
        published: true,
        postToSis: freshSetup.settings.syncLabsToFocus,
        // A scoped assignment is hidden from everyone; the per-section overrides
        // below are what reveal it to the chosen day's sections.
        onlyVisibleToOverrides: scoped,
      })

      // Record the assignment as soon as it exists in Canvas, not after the
      // whole flow succeeds — otherwise a failure anywhere below (overrides,
      // module item) leaves this out of the in-memory list, so a retry can't
      // find it by name and creates another duplicate assignment instead of
      // reusing the one that already exists.
      if (!existing) setAssignments(prev => [...prev, assignment])

      if (moduleId) await ensureModuleItem(courseId, moduleId, assignment.id)

      const journalDueOffset   = freshSetup.settings.journalDueOffsetDays ?? 1
      const journalCloseOffset = freshSetup.settings.labCloseDateOffsetDays ?? 14

      // Retrying after a partial failure (or reusing an existing assignment)
      // can mean a section already has an override here — Canvas rejects a
      // second one for the same section outright ("already assigned more
      // than once"), so look up what's already there and update it instead
      // of blindly creating a duplicate.
      const existingProfOverrides = await getOverrides(courseId, assignment.id)
      const profOverrideBySection = new Map(existingProfOverrides.map(o => [o.courseSectionId, o]))
      const existingJournalOverrides = standalone ? [] : await getOverrides(courseId, journalId)
      const journalOverrideBySection = new Map(existingJournalOverrides.map(o => [o.courseSectionId, o]))

      // Each in-scope section gets a professionalism override (open/due/close on
      // its lab date) and, for pairings, a journal override (open on the lab
      // date, due and close offset from settings). A scoped create still writes
      // a professionalism override for a dateless section, because that override
      // is what grants the section visibility; the journal write needs a date.
      // Each section's lab date: prefer the form's per-section value, then fall
      // back to the day-type quick-set date. The fallback matters on a create
      // fired right after tagging — sectionDueDates is prefilled by a
      // courseSetup-state effect that may not have run yet for a just-tagged
      // section, but freshSetup already knows that section's day type and the
      // A/B date fields hold the date the teacher typed. resolvedDates feeds the
      // saved lab record so it matches the overrides actually written.
      const resolvedDates = { ...sectionDueDates }
      for (const sec of targetSections) {
        const dayType = freshSetup.sections?.[sec.id]?.dayType
        const labDate = sectionDueDates[sec.id] || (dayType === 'A' ? aDate : dayType === 'B' ? bDate : '')
        if (!scoped && !labDate) continue
        if (labDate) resolvedDates[sec.id] = labDate
        const profFields = {
          courseSectionId: sec.id,
          ...(labDate ? professionalismOverrideDates(labDate) : {}),
          title: sec.name,
        }
        const existingProfOverride = profOverrideBySection.get(sec.id)
        if (existingProfOverride) {
          await updateOverride(courseId, assignment.id, existingProfOverride.id, profFields)
        } else {
          await createOverride(courseId, assignment.id, profFields)
        }
        if (!standalone && labDate) {
          const journalFields = {
            courseSectionId: sec.id,
            ...journalOverrideDates(labDate, journalDueOffset, journalCloseOffset),
            title: sec.name,
          }
          const existingJournalOverride = journalOverrideBySection.get(sec.id)
          if (existingJournalOverride) {
            await updateOverride(courseId, journalId, existingJournalOverride.id, journalFields)
          } else {
            await createOverride(courseId, journalId, journalFields)
          }
        }
      }

      const entry = await saveLab({
        courseId,
        moduleId: moduleId || null,
        name: name.trim(),
        professionalismAssignmentId: assignment.id,
        journalAssignmentId: standalone ? null : journalId,
        dates: resolvedDates,
        closeDates: {},
        // Whether this tool made the Canvas assignment; the delete dialog says so.
        origin: existing ? 'reused' : 'created',
      })

      setEntries(prev => [...prev, entry])
      const verb = existing ? `Reused the existing "${assignment.name}"` : `Created "${assignment.name}"`
      toast(standalone ? `${verb} as a standalone` : `${verb} and paired it with its journal`, 'success')
      resetCreateForm()
      setMode(null)
      onChanged?.()
      // Hand the new lab to the Lab tab so the teacher flows straight into grading.
      onLabCreated?.(entry.id)
    } catch (err) {
      toast(`Could not create the ${standalone ? 'standalone' : 'pairing'}: ${err.message}`, 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleLink(assignment, moduleId) {
    setLinkingId(assignment.id)
    try {
      if (moduleId) await ensureModuleItem(courseId, moduleId, assignment.id)
      const entry = await saveLab({
        courseId,
        moduleId: moduleId || null,
        name: assignment.name,
        professionalismAssignmentId: assignment.id,
        journalAssignmentId: null,
        dates: {},
        closeDates: {},
        origin: 'linked',
      })
      setEntries(prev => [...prev, entry])
      setMode(null)
      toast(`Linked "${assignment.name}" — opening it for grading`, 'success')
      onChanged?.()
      // Drop straight into grading the linked assignment, same as a created one.
      onLabCreated?.(entry.id)
    } catch (err) {
      toast(`Could not link "${assignment.name}": ${err.message}`, 'error')
    } finally {
      setLinkingId(null)
    }
  }

  if (loading || loadingCourse) {
    return (
      <div className="space-y-3">
        <Skeleton height="6rem" />
        <Skeleton height="12rem" />
      </div>
    )
  }

  if (!courseId) {
    return <EmptyState title="Select a course" body="Choose a course above to manage Professionalism assignments." />
  }

  if (!ready) {
    return (
      <EmptyState
        title="Finish setup first"
        body="Enable this course and create the Professionalism assignment group before adding Professionalism assignments."
        actions={<Button onClick={onGoToSetup}>Set Up Course</Button>}
      />
    )
  }

  const trackedProfessionalismAssignmentIds = new Set(entries.map(e => e.professionalismAssignmentId))
  const linkableProfessionalismAssignments = assignments.filter(a => isProfessionalismAssignment(a.name) && !trackedProfessionalismAssignmentIds.has(a.id))
  const linkMatches = linkableProfessionalismAssignments.filter(a => a.name.toLowerCase().includes(linkSearch.trim().toLowerCase()))

  // Candidates for the "journal" link: any assignment not already used as a
  // journal elsewhere, and not itself a professionalism/score assignment.
  // Published assignments with "lab" in the name are surfaced first, since
  // those are almost always the pre-existing Canvas activity a teacher wants
  // to attach a new professionalism score to.
  const pairedJournalAssignmentIds = new Set(entries.map(e => e.journalAssignmentId).filter(Boolean))
  const journalCandidates = assignments.filter(a => !isProfessionalismAssignment(a.name) && !pairedJournalAssignmentIds.has(a.id))
  const labJournalOptions = journalCandidates.filter(a => a.published && /lab/i.test(a.name))
  const otherJournalOptions = journalCandidates.filter(a => !labJournalOptions.includes(a))

  function handleRemoved(entry, deletedFromCanvas) {
    setEntries(prev => prev.filter(e => e.id !== entry.id))
    if (deletedFromCanvas) setAssignments(prev => prev.filter(a => a.id !== entry.professionalismAssignmentId))
    setRemoving(null)
    onLabRemoved?.(entry.id)
    onChanged?.()
  }

  const formOpen = mode ?? (entries.length === 0 ? 'create' : null)
  const standalone = journalId === STANDALONE
  const scopeInScopeCount = sectionsInScope(sections, courseSetup, scope).length
  const journalDueOffset   = courseSetup?.settings?.journalDueOffsetDays ?? 1
  const journalCloseOffset = courseSetup?.settings?.labCloseDateOffsetDays ?? 14

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold text-[var(--color-text-body)]">
          Professionalism assignments{entries.length > 0 ? ` (${entries.length})` : ''}
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant={formOpen === 'create' ? 'secondary' : 'primary'} icon={formOpen === 'create' && entries.length > 0 ? X : Plus}
            onClick={() => setMode(formOpen === 'create' && entries.length > 0 ? null : 'create')}>
            {formOpen === 'create' && entries.length > 0 ? 'Close' : 'New'}
          </Button>
          <Button size="sm" variant="secondary" icon={formOpen === 'link' ? X : Link2}
            onClick={() => setMode(formOpen === 'link' ? (entries.length === 0 ? 'create' : null) : 'link')}>
            {formOpen === 'link' ? 'Close' : 'Link existing'}
          </Button>
        </div>
      </div>

      {formOpen === 'create' && (
      <Card className="space-y-4">
        <div>
          <FieldLabel htmlFor="journal" required>Journal</FieldLabel>
          <JournalSelect
            id="journal"
            value={journalId}
            onChange={handleJournalChange}
            labOptions={labJournalOptions}
            otherOptions={otherJournalOptions}
            requireChoice
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {standalone
              ? 'A professionalism score for a day with no lab activity. At attendance, marking a student absent only zeros this score — there’s no journal to lock.'
              : 'The existing Canvas assignment or quiz students submit the lab work to — or choose standalone for a day with no lab. We’ll create the Professionalism assignment (or reuse one if an exact-name match already exists).'}
          </p>
        </div>

        <div>
          <FieldLabel htmlFor="labName" required>Professionalism assignment title</FieldLabel>
          <TextField
            id="labName"
            value={name}
            onChange={setName}
            placeholder={standalone ? 'Kitchen Cleanup Professionalism' : 'Cobb Salad Lab Professionalism'}
            className="max-w-sm"
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            The exact title of the Canvas assignment (0–4 points) that holds the score. Must include
            &ldquo;Professionalism&rdquo; so Scoring can find it.
          </p>
        </div>

        <div>
          <FieldLabel htmlFor="module">Module</FieldLabel>
          <ModulePicker id="module" modules={modules} value={moduleId} onChange={setModuleId} />
        </div>

        <div>
          <FieldLabel htmlFor="scope">Assign to</FieldLabel>
          <Select id="scope" value={scope} onChange={setScope} options={SCOPE_OPTIONS} className="max-w-xs" />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {scope === 'all'
              ? 'Visible to every section. Fill in per-section dates below only where they differ.'
              : scopeInScopeCount === 0
                ? `No sections are tagged ${scope}-day yet. Tag one in Course Settings, or choose All sections.`
                : `Visible to the ${scopeInScopeCount} ${scope}-day section${scopeInScopeCount === 1 ? '' : 's'} only. Other sections won’t see it — add them later from the list above.`}
          </p>
        </div>

        {/* One lab date per day type drives everything. A-day scope hides the B
            field and vice versa; 'All' shows both, since both day types are in. */}
        <div>
          <div className="grid sm:grid-cols-2 gap-3 max-w-md">
            {scope !== 'B' && (
              <div>
                <FieldLabel htmlFor="aDate">A day lab date</FieldLabel>
                <TextField id="aDate" type="date" value={aDate} onChange={setADate} />
              </div>
            )}
            {scope !== 'A' && (
              <div>
                <FieldLabel htmlFor="bDate">B day lab date</FieldLabel>
                <TextField id="bDate" type="date" value={bDate} onChange={setBDate} />
              </div>
            )}
          </div>
          {!standalone && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Professionalism opens and closes on the lab date. The Journal opens that day, is due
              {' '}{journalDueOffset} day{journalDueOffset === 1 ? '' : 's'} later, and closes
              {' '}{journalCloseOffset} day{journalCloseOffset === 1 ? '' : 's'} after that. Change these offsets in Course Settings.
            </p>
          )}
        </div>

        <SectionDatesAccordion
          sections={sections}
          dates={sectionDueDates}
          onChange={setSectionDueDate}
        />

        <Button icon={Plus} onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating…' : standalone ? 'Create Standalone' : 'Create Pairing'}
        </Button>
      </Card>
      )}

      {dupPrompt && (
        <Modal
          title="An assignment with this title already exists"
          onClose={() => !creating && setDupPrompt(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setDupPrompt(null)} disabled={creating}>Cancel</Button>
            <Button
              variant="secondary"
              onClick={() => { const { ctx } = dupPrompt; setDupPrompt(null); performCreate(ctx, null) }}
              disabled={creating}
            >
              Create anyway
            </Button>
            <Button
              onClick={() => { const { ctx, matches } = dupPrompt; setDupPrompt(null); performCreate(ctx, matches[0]) }}
              disabled={creating}
            >
              Reuse existing
            </Button>
          </>}
        >
          <div className="text-sm text-[var(--color-text-secondary)] space-y-2">
            <p className="flex items-start gap-1.5 text-[var(--color-warning)]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {dupPrompt.matches.length === 1
                ? <>&ldquo;{dupPrompt.matches[0].name}&rdquo; already exists in this course.</>
                : <>{dupPrompt.matches.length} assignments titled &ldquo;{dupPrompt.ctx.expectedTitle}&rdquo; already exist in this course.</>}
            </p>
            <p><strong>Reuse existing</strong> grades the lab on the assignment already there — the usual choice when you meant the same lab.</p>
            <p><strong>Create anyway</strong> makes a second copy with the same title. Scoring finds professionalism assignments by name, so two copies will collide there.</p>
          </div>
        </Modal>
      )}

      {formOpen === 'link' && (
      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-body)]">Link an existing Professionalism assignment</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Grade a professionalism assignment you already made in Canvas. Search by name, pick a Module if you
            want it in a Unit rollup, then Link — it opens in the Lab tab for grading.
          </p>
        </div>

        <TextField
          value={linkSearch}
          onChange={setLinkSearch}
          placeholder="Search professionalism assignments"
          aria-label="Search professionalism assignments"
          className="max-w-sm"
        />

        {linkableProfessionalismAssignments.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Every professionalism assignment in this course is already linked, or none exist yet.
          </p>
        ) : linkMatches.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No assignment matches &ldquo;{linkSearch}&rdquo;.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border)]">
            {linkMatches.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 flex-wrap">
                <span className="text-sm text-[var(--color-text-body)] flex-1 min-w-[12rem] truncate" title={a.name}>{a.name}</span>
                <div className="flex items-center gap-2">
                  <Select
                    value={linkModuleById[a.id] ?? ''}
                    onChange={v => setLinkModuleById(prev => ({ ...prev, [a.id]: v }))}
                    aria-label={`Module for ${a.name}`}
                    className="w-40"
                    options={[{ value: '', label: 'No module' }, ...modules.map(m => ({ value: m.id, label: m.name }))]}
                  />
                  <Button size="sm" icon={Link2} onClick={() => handleLink(a, linkModuleById[a.id] ?? '')} disabled={linkingId === a.id}>
                    {linkingId === a.id ? 'Linking…' : 'Link'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      )}

      {entries.length > 0 && (
        <Card>
          <EntryList entries={entries} assignments={assignments} modules={modules} courseId={courseId} sections={sections}
            courseSetup={courseSetup} onAdded={onChanged} onRemove={setRemoving} />
        </Card>
      )}

      {removing && (
        <RemoveLabModal entry={removing} assignments={assignments} courseId={courseId} courseName={courseName}
          onClose={() => setRemoving(null)} onRemoved={handleRemoved} />
      )}
    </div>
  )
}
