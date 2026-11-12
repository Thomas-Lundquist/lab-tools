import { useState, useEffect, useRef } from 'react'
import { Plus, Link2, BookOpen, AlertTriangle, Trash2, Loader, X, Pencil } from 'lucide-react'
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
import { getEnrollments } from '../../api/enrollments.js'
import { NotFoundError } from '../../api/errors.js'
import { createOverride, updateOverride, deleteOverride, getOverrides } from '../../api/overrides.js'
import { getModules, ensureModuleItem } from '../../api/modules.js'
import { getCourseSetup, getLabs, saveLab, deleteLab, isStandalone, getTemplates } from '../../storage/setup.js'
import { clearAllLabGrading, getAllLabGrading } from '../../storage/labGrading.js'
import { mapLimit } from '../../utils/mapLimit.js'
import { loadJournalUndo, runJournalUndo } from './labRemoval.js'
import { isProfessionalismAssignment, journalGradedGaps } from './scoring.js'
import {
  STANDALONE, JournalSelect, ModulePicker, SCOPE_OPTIONS, sectionsInScope, inferScope,
  professionalismOverrideDates, journalOverrideDates,
} from './LabFormFields.jsx'
import EditLabModal from './EditLabModal.jsx'

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

const toSubMap = subs => Object.fromEntries(subs.map(s => [s.userId, { score: s.score, excused: !!s.excused }]))

// Every assignment already in the course whose title collides with `title`.
// Canvas permits identical titles and does nothing to stop a second copy, so
// this is what makes "create the same lab twice" detectable. Returns all
// matches — tracked by this tool or made by hand in Canvas — so the confirm
// modal can report how many exist and offer one to reuse.
export function findDuplicateAssignments(title, assignments) {
  const target = normalizeTitle(title)
  return assignments.filter(a => normalizeTitle(a.name) === target)
}

// A short scope summary for a row, built on the same inference EditLabModal
// uses to seed its Scope picker — see LabFormFields.jsx's inferScope.
function scopeBadge(assignment, courseSetup) {
  const scope = inferScope(assignment, courseSetup)
  if (scope === 'all') return 'All periods'
  if (scope === 'A') return 'A day'
  if (scope === 'B') return 'B day'
  if (scope === 'custom') return 'Custom'
  return null
}

// Strips a trailing "Lab" from an existing journal's name, then the full
// literal Professionalism assignment title is prefilled from it —
// e.g. "Cobb Salad Lab" -> "Cobb Salad" -> "Cobb Salad Lab Professionalism"
// (still fully editable; nothing is appended silently at submit time).
function stripLabSuffix(name) {
  return name.replace(/\s*lab\s*$/i, '').trim()
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
        Lab date for each period
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
function EntryRow({ entry, assignments, modules, courseId, sections, courseSetup, journalGap, onAdded, onRemove, onEdit }) {
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
  // Which covered section's date is being edited in place, and its draft value.
  const [editingSectionId, setEditingSectionId] = useState(null)
  const [editSectionDate, setEditSectionDate]   = useState('')

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
    if (!sec) { toast('Choose a period to add.', 'warning'); return }
    if (!labDate) { toast('Enter the lab date for the period.', 'warning'); return }
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
      toast(`Could not add the period: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  // Un-assigns a period Canvas mistakenly got added to (or one the teacher
  // just wants off this assignment), the reverse of "Add a period": removes
  // its professionalism override (and the paired journal's, if any), then
  // drops the period's lab date from this tool's own record so it stops
  // showing as due or appearing in the date range shown on the list.
  async function handleRemoveSection(sectionId) {
    const sec = sections.find(s => s.id === sectionId)
    setBusy(true)
    try {
      const profOverride = (overrides ?? []).find(o => o.courseSectionId === sectionId)
      if (profOverride) await deleteOverride(courseId, assignmentId, profOverride.id)
      if (!isStandalone(entry) && entry.journalAssignmentId) {
        const journalOverrides = await getOverrides(courseId, entry.journalAssignmentId)
        const journalOverride = journalOverrides.find(o => o.courseSectionId === sectionId)
        if (journalOverride) await deleteOverride(courseId, entry.journalAssignmentId, journalOverride.id)
      }
      let updated
      if (entry.dates?.[sectionId] !== undefined || entry.closeDates?.[sectionId] !== undefined) {
        const dates = { ...entry.dates }; delete dates[sectionId]
        const closeDates = { ...entry.closeDates }; delete closeDates[sectionId]
        updated = await saveLab({ id: entry.id, dates, closeDates })
      }
      toast(`Removed ${sec?.name ?? 'the period'} from "${professionalism?.name ?? entry.name}".`, 'success')
      await loadOverrides()
      onAdded?.(updated)
    } catch (err) {
      toast(`Could not remove ${sec?.name ?? 'the period'}: ${err.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  // Edits an already-covered section's lab date in place — same effect as a
  // remove followed by an add, without the round trip (and without a moment
  // where the section has no override at all). Mirrors handleAdd's
  // existing-vs-create check, since a section can be covered by a dateless
  // visibility override (added via a scope change) with nothing yet to update.
  async function handleEditSectionDate(sectionId) {
    const sec = sections.find(s => s.id === sectionId)
    if (!editSectionDate) { toast('Enter the lab date for the period.', 'warning'); return }
    setBusy(true)
    try {
      const profFields = { courseSectionId: sectionId, ...professionalismOverrideDates(editSectionDate), title: sec?.name ?? sectionId }
      const profOverride = (overrides ?? []).find(o => o.courseSectionId === sectionId)
      if (profOverride) await updateOverride(courseId, assignmentId, profOverride.id, profFields)
      else await createOverride(courseId, assignmentId, profFields)
      if (!isStandalone(entry) && entry.journalAssignmentId) {
        const journalFields = { courseSectionId: sectionId, ...journalOverrideDates(editSectionDate, journalDueOffset, journalCloseOffset), title: sec?.name ?? sectionId }
        const journalOverrides = await getOverrides(courseId, entry.journalAssignmentId)
        const journalOverride = journalOverrides.find(o => o.courseSectionId === sectionId)
        if (journalOverride) await updateOverride(courseId, entry.journalAssignmentId, journalOverride.id, journalFields)
        else await createOverride(courseId, entry.journalAssignmentId, journalFields)
      }
      const updated = await saveLab({ id: entry.id, dates: { ...entry.dates, [sectionId]: editSectionDate } })
      toast(`Updated ${sec?.name ?? 'the period'}'s lab date.`, 'success')
      setEditingSectionId(null)
      await loadOverrides()
      onAdded?.(updated)
    } catch (err) {
      toast(`Could not update ${sec?.name ?? 'the period'}: ${err.message}`, 'error')
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
          {journalGap?.length > 0 && (
            <div className="flex items-start gap-1 text-xs text-[var(--color-warning)]">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                {journalGap.length} graded journal{journalGap.length === 1 ? '' : 's'}, no professionalism score yet:{' '}
                {journalGap.slice(0, 4).map(g => g.userName).join(', ')}{journalGap.length > 4 ? `, +${journalGap.length - 4} more` : ''}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {sections.length > 0 && assignmentId && (
            <Button variant="ghost" size="sm" icon={Plus} onClick={toggleOpen} aria-expanded={open}>
              {open ? 'Close' : 'Add a period'}
            </Button>
          )}
          <button
            type="button"
            onClick={() => onEdit(entry)}
            title="Edit"
            aria-label={`Edit ${professionalism?.name ?? entry.name}`}
            className="p-1.5 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] hover:bg-[var(--color-bg-hover)]"
          >
            <Pencil size={15} />
          </button>
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
            <p className="text-xs text-[var(--color-text-muted)]">Loading periods…</p>
          ) : (
            <>
              {coveredSectionIds.size > 0 && (
                <div className="space-y-1">
                  <FieldLabel>Periods on this assignment</FieldLabel>
                  {[...coveredSectionIds].map(id => {
                    const sec = sections.find(s => s.id === id)
                    const editing = editingSectionId === id
                    return (
                      <div key={id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[var(--color-text-body)]">{sec?.name ?? id}</span>
                        {editing ? (
                          <div className="flex items-center gap-1.5">
                            <TextField
                              type="date"
                              value={editSectionDate}
                              onChange={setEditSectionDate}
                              className="max-w-[9rem]"
                              aria-label={`${sec?.name ?? 'this period'}'s lab date`}
                            />
                            <Button size="sm" variant="ghost" onClick={() => handleEditSectionDate(id)} disabled={busy}>
                              Save
                            </Button>
                            <button
                              type="button"
                              onClick={() => setEditingSectionId(null)}
                              disabled={busy}
                              title="Cancel"
                              aria-label={`Cancel editing ${sec?.name ?? 'this period'}'s lab date`}
                              className="p-1 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] hover:bg-[var(--color-bg-subtle)]"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => { setEditingSectionId(id); setEditSectionDate(entry.dates?.[id] ?? '') }}
                              disabled={busy}
                              title={`Edit ${sec?.name ?? 'this period'}'s lab date`}
                              aria-label={`Edit ${sec?.name ?? 'this period'}'s lab date`}
                              className="p-1 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] hover:bg-[var(--color-bg-subtle)]"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveSection(id)}
                              disabled={busy}
                              title={`Remove ${sec?.name ?? 'this period'}`}
                              aria-label={`Remove ${sec?.name ?? 'this period'} from ${professionalism?.name ?? entry.name}`}
                              className="p-1 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-bg-subtle)]"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {availableSections.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">Every period already has a date on this assignment.</p>
              ) : (
                <>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <FieldLabel htmlFor={`sec-${entry.id}`}>Period</FieldLabel>
                  <Select
                    id={`sec-${entry.id}`}
                    value={sectionId}
                    onChange={setSectionId}
                    placeholder="Select a period"
                    options={availableSections.map(s => ({ value: s.id, label: s.name }))}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`lab-${entry.id}`}>Lab date</FieldLabel>
                  <TextField id={`lab-${entry.id}`} type="date" value={labDate} onChange={setLabDate} />
                </div>
              </div>
              <Button size="sm" icon={Plus} onClick={handleAdd} disabled={busy}>
                {busy ? 'Adding…' : 'Add period'}
              </Button>
                </>
              )}
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
function EntryList({ entries, assignments, modules, courseId, sections, courseSetup, journalGaps, onAdded, onRemove, onEdit }) {
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
      {/* Shown while a filter is on, too, so it can always be cleared. */}
      {(entries.length > 5 || q || unitId) && (
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
              journalGap={journalGaps?.[entry.id]}
              onAdded={onAdded}
              onRemove={onRemove}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Entries saved before `origin` was recorded: a linked one has no journal and
// no lab dates; anything else was most likely created here, but can't be told
// apart from a reused one, so it is never assumed.
function entryOrigin(entry) {
  if (entry.origin) return entry.origin
  return !entry.journalAssignmentId && Object.keys(entry.dates ?? {}).length === 0 ? 'linked' : 'unknown'
}

// Delete a tracked assignment: from Canvas too (the assignment and its scores),
// or from Lab Tools only. Deleting from Canvas also offers to undo what the
// lab's commits did to the journal (absent students' zeros and locks), since
// no Revert is left to do it. Only an assignment Lab Tools created starts on
// "Delete from Canvas". Both paths are PIN-gated and audit-logged.
function RemoveLabModal({ entry, assignments, courseId, courseName, onClose, onRemoved }) {
  const toast = useToast()
  const { requirePin } = usePinGate()
  const professionalism = assignments.find(a => a.id === entry.professionalismAssignmentId)
  const journal = assignments.find(a => a.id === entry.journalAssignmentId)
  const name = professionalism?.name ?? entry.name
  const origin = entryOrigin(entry)
  const inCanvas = !!professionalism
  const [choice, setChoice]     = useState(inCanvas && origin === 'created' ? 'delete' : 'unlink')
  const [graded, setGraded]     = useState(null) // students with a score or excused; -1 = couldn't check
  const [journalOps, setJournalOps] = useState(null) // journal zeros/locks to undo; null = loading
  const [undoJournal, setUndoJournal] = useState(true)
  const [busy, setBusy]         = useState(false)

  useEffect(() => {
    if (!inCanvas) return
    let cancelled = false
    getAssignmentSubmissions(courseId, entry.professionalismAssignmentId)
      .then(subs => { if (!cancelled) setGraded(subs.filter(s => s.score != null || s.excused).length) })
      .catch(() => { if (!cancelled) setGraded(-1) })
    getAllLabGrading(entry.id)
      .then(state => loadJournalUndo(courseId, entry.journalAssignmentId, state))
      .then(ops => { if (!cancelled) setJournalOps(ops) })
      .catch(() => { if (!cancelled) setJournalOps([]) })
    return () => { cancelled = true }
  }, [inCanvas, courseId, entry.id, entry.professionalismAssignmentId, entry.journalAssignmentId])

  async function remove(fromCanvas) {
    setBusy(true)
    let journalFailed = 0
    try {
      if (fromCanvas) {
        try {
          await deleteAssignment(courseId, entry.professionalismAssignmentId)
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err // already gone counts as done
        }
        if (undoJournal && journalOps?.length) ({ failed: journalFailed } = await runJournalUndo(courseId, entry, journalOps))
      }
    } catch (err) {
      toast(`Could not delete "${name}": ${err.message}`, 'error')
      setBusy(false)
      return
    }
    // Canvas is done. A local failure from here on must not read as "nothing happened".
    try {
      await deleteLab(entry.id)
      // The lab's saved grading is cleared only when its scores are gone from
      // Canvas too. "Lab Tools only" keeps it, so the record of what was posted survives.
      if (fromCanvas) await clearAllLabGrading(entry.id)
      if (journalFailed) toast(`Deleted "${name}", but ${journalFailed} journal change${journalFailed === 1 ? '' : 's'} could not be undone. Details: Settings › Testing › Diagnostics`, 'warning')
      else toast(fromCanvas ? `Deleted "${name}" from Canvas` : `Removed "${name}" from Lab Tools. It's still in Canvas.`, 'success')
    } catch (err) {
      toast(`${fromCanvas ? `Deleted "${name}" from Canvas, but` : 'But'} Lab Tools couldn't update its own records: ${err.message}. It may reappear in the list.`, 'warning')
    } finally {
      setBusy(false)
    }
    onRemoved(entry, fromCanvas)
  }

  async function confirm() {
    const deleting = choice === 'delete'
    const scoreWarning = graded > 0 ? `${graded} student${graded === 1 ? ' has a score' : 's have scores'} on it.`
      : graded === -1 ? 'Couldn’t check for scores; it may have some.' : undefined
    try {
      await requirePin(
        {
          action: deleting ? 'delete_professionalism_assignment' : 'untrack_professionalism_assignment',
          summary: deleting ? `Delete "${name}" from ${courseName}` : `Remove "${name}" from Lab Tools in ${courseName}`,
          courseId, courseName,
          warning: deleting ? scoreWarning : undefined,
        },
        () => remove(deleting),
        { forcePrompt: deleting },
      )
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const journalCount = journalOps?.length ?? 0
  const checking = choice === 'delete' && (graded === null || journalOps === null)

  return (
    <Modal
      title={`Delete "${name}"?`}
      onClose={() => !busy && onClose()}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={choice === 'delete' ? 'danger' : 'primary'} onClick={confirm} disabled={busy || checking}>
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
              {origin !== 'created' && (
                <span className="block text-xs text-[var(--color-text-muted)] mt-1">
                  {origin === 'unknown' ? 'Lab Tools can’t tell whether it created this one or reused one made in Canvas.' : `This one was ${origin}, not created by Lab Tools.`}
                </span>
              )}
              {graded === null && <span className="block text-xs text-[var(--color-text-muted)] mt-1">Checking Canvas for scores…</span>}
              {(graded > 0 || graded === -1) && (
                <span className="flex items-start gap-1.5 mt-1 text-[var(--color-warning)]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {graded > 0
                    ? <>{graded} student{graded === 1 ? ' has a score' : 's have scores'} on it. Those are deleted too.</>
                    : <>Couldn’t check Canvas for scores. Assume it has some.</>}
                </span>
              )}
              {graded === 0 && <span className="block text-xs text-[var(--color-text-muted)] mt-1">No student has a score on it yet.</span>}
            </span>
          </label>
        )}
        {choice === 'delete' && journalCount > 0 && (
          <label className="flex items-start gap-2 ml-6">
            <input type="checkbox" checked={undoJournal} onChange={e => setUndoJournal(e.target.checked)} className="mt-1" />
            <span>
              Also undo this lab’s absences on the journal{journal ? <> &ldquo;{journal.name}&rdquo;</> : null} for {journalCount} student{journalCount === 1 ? '' : 's'}: clear the journal zero and remove the lock.
              <span className="block text-xs text-[var(--color-text-muted)] mt-1">A journal with a real score is left alone.</span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2">
          <input type="radio" name="remove-choice" checked={choice === 'unlink'} onChange={() => setChoice('unlink')} className="mt-1" />
          <span>
            <strong className="text-[var(--color-text-body)]">Remove from Lab Tools only.</strong>{' '}
            Canvas keeps the assignment, its scores, and any journal zeros and locks. It leaves this list, the Lab tab, and Unit rollups.
            {!inCanvas && <span className="block text-xs text-[var(--color-text-muted)] mt-1">It’s already gone from Canvas.</span>}
          </span>
        </label>
      </div>
    </Modal>
  )
}

export default function ProfessionalismPanel({ courseId, courseName, loadingCourse, ready, active = true, setupVersion, onChanged, onLabCreated, onLabRemoved, onGoToSetup }) {
  const toast = useToast()
  // Which form is open above the list: 'create', 'link', or null (list only).
  // With nothing tracked yet the create form shows on its own.
  const [mode, setMode]               = useState(null)
  const [showAllJournals, setShowAllJournals] = useState(false)
  const [removing, setRemoving]       = useState(null) // entry in the delete modal
  const [editing, setEditing]         = useState(null) // entry in the edit modal
  const [loading, setLoading]         = useState(false)
  const [sections, setSections]       = useState([])
  const [assignments, setAssignments] = useState([])
  const [modules, setModules]         = useState([])
  const [entries, setEntries]         = useState([])
  const [courseSetup, setCourseSetup] = useState(null)
  const [templates, setTemplates]     = useState([])
  const [journalGaps, setJournalGaps] = useState({}) // entry.id -> [{ userId, userName }]
  // Shown again after something changed while hidden: reload (see ScoringPanel's
  // same active/dataVersion/loadedVersion shape). A background tab no longer
  // eagerly re-fetches the instant a sibling panel bumps setupVersion.
  const [reloadTick, setReloadTick]   = useState(0)
  const loadedVersion                 = useRef(setupVersion)

  // Create-new form state
  const [name, setName]               = useState('')
  const [moduleId, setModuleId]       = useState('')
  const [journalId, setJournalId]     = useState(STANDALONE)
  const [scope, setScope]             = useState('all')
  const [aDate, setADateRaw]          = useState('')
  const [bDate, setBDateRaw]          = useState('')
  const [sectionDueDates, setSectionDueDates]     = useState({})
  const [templateId, setTemplateIdRaw] = useState('')
  const [creating, setCreating]       = useState(false)
  // Non-null while the duplicate-title warning is open. Holds the validated
  // create context plus the colliding assignments, so the modal's buttons can
  // drive performCreate without re-validating. See handleCreate.
  const [dupPrompt, setDupPrompt]     = useState(null)
  const touchedDueSections   = useRef(new Set())
  const touchedTemplate      = useRef(false)

  // Link-existing: search the course's professionalism assignments and link one
  // (with an optional Module for rollup) straight into grading.
  const [linkSearch, setLinkSearch]         = useState('')
  const [linkModuleById, setLinkModuleById] = useState({})
  const [linkingId, setLinkingId]           = useState(null)
  // Linking several at once: the ticked rows, and progress while it runs.
  const [linkSelected, setLinkSelected]     = useState(() => new Set())
  const [bulkProgress, setBulkProgress]     = useState(null) // "3 of 6" while linking
  const [showUnpublished, setShowUnpublished] = useState(false)

  // Shown again (or still active) after setupVersion moved on without us: reload.
  useEffect(() => {
    if (active && loadedVersion.current !== setupVersion) setReloadTick(t => t + 1)
  }, [active, setupVersion])

  useEffect(() => {
    if (!courseId) { setSections([]); setAssignments([]); setModules([]); setEntries([]); setCourseSetup(null); return }
    setLoading(true)
    loadedVersion.current = setupVersion
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
      getTemplates(),
    ])
      .then(([secs, labAsns, profAsns, mods, l, s, tmpls]) => {
        const byId = new Map()
        for (const a of [...labAsns, ...profAsns]) byId.set(a.id, a)
        setSections(secs)
        setAssignments([...byId.values()])
        setModules(mods)
        setEntries(l)
        setCourseSetup(s)
        setTemplates(tmpls)
      })
      .finally(() => setLoading(false))
  }, [courseId, reloadTick])

  // Background check, after the list itself has loaded: for each Pairing, has
  // its journal been graded for a student whose professionalism score is
  // still blank? That's a sign grading was simply never finished for them,
  // not that nothing happened that day — easy to miss once a lab's day has
  // passed and nothing draws you back to it. Runs lazily so it never blocks
  // the list from showing; badges fill in once it's done.
  useEffect(() => {
    if (!courseId || entries.length === 0) { setJournalGaps({}); return }
    const publishedIds = new Set(assignments.filter(a => a.published).map(a => a.id))
    const checkable = entries.filter(e => !isStandalone(e) && publishedIds.has(e.journalAssignmentId) && publishedIds.has(e.professionalismAssignmentId))
    if (checkable.length === 0) { setJournalGaps({}); return }
    let cancelled = false
    ;(async () => {
      const enrollments = await getEnrollments(courseId).catch(() => [])
      const nameById = Object.fromEntries(enrollments.map(e => [e.userId, e.userName]))
      const results = await mapLimit(checkable, 4, async entry => {
        const [journalSubs, profSubs] = await Promise.all([
          getAssignmentSubmissions(courseId, entry.journalAssignmentId).then(toSubMap),
          getAssignmentSubmissions(courseId, entry.professionalismAssignmentId).then(toSubMap),
        ])
        return [entry.id, journalGradedGaps(profSubs, journalSubs).map(userId => ({ userId, userName: nameById[userId] ?? userId }))]
      })
      if (!cancelled) setJournalGaps(Object.fromEntries(results.filter(([, gap]) => gap.length > 0)))
    })()
    return () => { cancelled = true }
  }, [courseId, entries, assignments])

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

  // Default the Template picker to the course's configured default, unless
  // the teacher has already picked a different one this session (same
  // touched-ref pattern as the per-section due dates above).
  useEffect(() => {
    if (touchedTemplate.current) return
    setTemplateIdRaw(courseSetup?.settings?.professionalismTemplateId ?? '')
  }, [courseSetup])

  function setTemplateId(v) {
    touchedTemplate.current = true
    setTemplateIdRaw(v)
  }

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
    setTemplateIdRaw(courseSetup?.settings?.professionalismTemplateId ?? '')
    touchedTemplate.current = false
  }

  async function handleCreate() {
    const standalone = journalId === STANDALONE
    if (!journalId) { toast('Select a journal, or choose standalone.', 'warning'); return }
    if (!name.trim()) { toast('Enter a title for the Professionalism assignment.', 'warning'); return }
    // Scoring finds Professionalism assignments by name, not by this tool's
    // records — a title without the word would be created fine and then
    // silently never show up there.
    if (!isProfessionalismAssignment(name.trim())) {
      toast('The title needs the word "Professionalism" so Unit & Term Scores can find it.', 'warning')
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
      toast(`No periods are set as ${scope} day. Set one in Course settings, or choose All periods.`, 'warning')
      return
    }
    const expectedTitle = name.trim()
    const templateHtml = templates.find(t => t.id === templateId)?.html ?? ''
    const ctx = { expectedTitle, freshSetup, standalone, scoped, targetSections, templateHtml }

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
    const { expectedTitle, freshSetup, standalone, scoped, targetSections, templateHtml } = ctx
    setCreating(true)
    try {
      const existing = reuseTarget
      // A reused assignment keeps whatever description it already has in
      // Canvas — the template only ever fills a brand-new one.
      const assignment = existing ?? await createAssignment(courseId, {
        name: expectedTitle,
        pointsPossible: 4,
        gradingType: 'points',
        submissionTypes: ['none'],
        assignmentGroupId: freshSetup.professionalismGroupId,
        published: true,
        postToSis: freshSetup.settings.syncLabsToFocus,
        description: templateHtml,
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

  // Track one existing assignment, in its Module. The Module item is added in
  // Canvas only if the assignment isn't already in that Module.
  async function linkOne(assignment, moduleId) {
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
    return entry
  }

  // Link every ticked row with the Module shown on it. One at a time, so a
  // failure on one doesn't stop the rest; no jump to Grade afterwards.
  async function handleLinkSelected(rows) {
    const failures = []
    let done = 0
    setBulkProgress(`0 of ${rows.length}`)
    for (const a of rows) {
      try {
        await linkOne(a, moduleFor(a))
      } catch (err) {
        failures.push({ name: a.name, message: err.message })
      }
      setBulkProgress(`${++done} of ${rows.length}`)
    }
    setBulkProgress(null)
    setLinkSelected(new Set())
    onChanged?.()
    const ok = rows.length - failures.length
    if (failures.length) toast(`Linked ${ok} of ${rows.length}. Couldn't link ${failures.map(f => `"${f.name}"`).join(', ')}: ${failures[0].message}`, 'warning')
    else toast(`Linked ${ok} assignment${ok === 1 ? '' : 's'}`, 'success')
  }

  async function handleLink(assignment, moduleId) {
    setLinkingId(assignment.id)
    try {
      const entry = await linkOne(assignment, moduleId)
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
  // Unpublished ones can't hold grades (usually last year's or templates), so they
  // wait behind a checkbox. Published first, then by name.
  const unpublishedCount = linkableProfessionalismAssignments.filter(a => !a.published).length
  const linkMatches = linkableProfessionalismAssignments
    .filter(a => showUnpublished || a.published)
    .filter(a => a.name.toLowerCase().includes(linkSearch.trim().toLowerCase()))
    .sort((a, b) => (b.published - a.published) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  // A row's Module: what the teacher picked, else the Module it's already in on Canvas.
  const canvasModule = a => (a.moduleIds ?? []).map(String).find(mid => modules.some(m => m.id === mid)) ?? ''
  const moduleFor = a => linkModuleById[a.id] ?? canvasModule(a)
  const selectedRows = linkMatches.filter(a => linkSelected.has(a.id))
  const allShownSelected = linkMatches.length > 0 && linkMatches.every(a => linkSelected.has(a.id))
  function toggleLinkRow(id) {
    setLinkSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAllShown() {
    setLinkSelected(allShownSelected ? new Set() : new Set(linkMatches.map(a => a.id)))
  }
  function setModuleForSelected(mid) {
    setLinkModuleById(prev => ({ ...prev, ...Object.fromEntries(selectedRows.map(a => [a.id, mid])) }))
  }

  // Candidates for the "journal" link: any assignment not already used as a
  // journal elsewhere, and not itself a professionalism/score assignment.
  // Published assignments with "lab" in the name are surfaced first, since
  // those are almost always the pre-existing Canvas activity a teacher wants
  // to attach a new professionalism score to.
  const pairedJournalAssignmentIds = new Set(entries.map(e => e.journalAssignmentId).filter(Boolean))
  const journalCandidates = assignments.filter(a => !isProfessionalismAssignment(a.name) && !pairedJournalAssignmentIds.has(a.id))
  // Lab journals and lab submissions; makeups, proposals, supplements and the
  // syllabus are never a journal, so they wait behind "Show all assignments".
  const likelyJournal = a => (/journal/i.test(a.name) || /\blab\b/i.test(a.name)) && !/makeup|proposal|syllabus|supplement/i.test(a.name)
  const labJournalOptions = journalCandidates.filter(a => a.published && likelyJournal(a))
  const otherJournalOptions = showAllJournals ? journalCandidates.filter(a => !labJournalOptions.includes(a)) : []

  // A period's add/remove/date-edit inside an EntryRow: merge the already-known
  // result straight into our own `entries` (same local-merge pattern as
  // performCreate/linkOne above), then bump setupVersion for the other panels
  // but mark ourselves already caught up to it — otherwise our own lazy-reload
  // effect above would immediately refetch and re-skeleton the list we just
  // updated in place. See DECISIONS.md / the reload-flash investigation.
  function handleRowChanged(updatedEntry) {
    if (updatedEntry) setEntries(prev => prev.map(e => (e.id === updatedEntry.id ? updatedEntry : e)))
    const newVersion = onChanged?.()
    if (newVersion != null) loadedVersion.current = newVersion
  }

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
          <label className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <input type="checkbox" checked={showAllJournals} onChange={e => setShowAllJournals(e.target.checked)} />
            Show all assignments (not just lab journals)
          </label>
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
            &ldquo;Professionalism&rdquo; so Unit &amp; Term Scores can find it.
          </p>
        </div>

        <div>
          <FieldLabel htmlFor="module">Module</FieldLabel>
          <ModulePicker id="module" modules={modules} value={moduleId} onChange={setModuleId} />
        </div>

        {templates.length > 0 && (
          <div>
            <FieldLabel htmlFor="template">Template</FieldLabel>
            <Select
              id="template"
              value={templateId}
              onChange={setTemplateId}
              className="max-w-xs"
              options={[{ value: '', label: 'No template' }, ...templates.map(t => ({ value: t.id, label: t.name }))]}
            />
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Deployed into the new assignment's description. Defaults to this course's template (Course settings) — change it here just for this one.
            </p>
          </div>
        )}

        <div>
          <FieldLabel htmlFor="scope">Assign to</FieldLabel>
          <Select id="scope" value={scope} onChange={setScope} options={SCOPE_OPTIONS} className="max-w-xs" />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {scope === 'all'
              ? 'Visible to every period. Set a period’s own date below only where it differs.'
              : scopeInScopeCount === 0
                ? `No periods are set as ${scope} day yet. Set one in Course settings, or choose All periods.`
                : `Visible to the ${scopeInScopeCount} ${scope}-day period${scopeInScopeCount === 1 ? '' : 's'} only. Other periods won’t see it; add them later with Add a period.`}
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
            <p><strong>Create anyway</strong> makes a second copy with the same title. Unit &amp; Term Scores finds professionalism assignments by name, so both copies would count there.</p>
          </div>
        </Modal>
      )}

      {formOpen === 'link' && (
      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-body)]">Link existing Professionalism assignments</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Track professionalism assignments you already made in Canvas, so they count in Unit and Term scores.
            Each row starts with the Module it&rsquo;s in on Canvas; change it if needed. Tick several and use Link selected,
            or Link one to open it for grading.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <TextField
            value={linkSearch}
            onChange={setLinkSearch}
            placeholder="Search professionalism assignments"
            aria-label="Search professionalism assignments"
            className="max-w-sm flex-1 min-w-[12rem]"
          />
          {unpublishedCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <input type="checkbox" checked={showUnpublished} onChange={e => setShowUnpublished(e.target.checked)} />
              Show unpublished ({unpublishedCount})
            </label>
          )}
        </div>

        {/* Bulk bar: select all shown, give the ticked rows one Module, link them. */}
        {linkMatches.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] bg-[var(--color-bg-hover)] px-3 py-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-body)]">
              <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} aria-label="Select all shown" />
              {selectedRows.length ? `${selectedRows.length} selected` : 'Select all'}
            </label>
            <Select
              value=""
              onChange={v => v && setModuleForSelected(v === 'none' ? '' : v)}
              disabled={!selectedRows.length}
              aria-label="Set the Module for the selected assignments"
              className="w-56"
              options={[{ value: '', label: 'Set Module for selected…' }, { value: 'none', label: 'No module' }, ...modules.map(m => ({ value: m.id, label: m.name }))]}
            />
            <div className="ml-auto">
              <Button size="sm" icon={Link2} onClick={() => handleLinkSelected(selectedRows)} disabled={!selectedRows.length || !!bulkProgress}>
                {bulkProgress ? `Linking ${bulkProgress}…` : `Link selected${selectedRows.length ? ` (${selectedRows.length})` : ''}`}
              </Button>
            </div>
          </div>
        )}

        {linkableProfessionalismAssignments.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Every professionalism assignment in this course is already linked, or none exist yet.
          </p>
        ) : !showUnpublished && unpublishedCount === linkableProfessionalismAssignments.length ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Every published professionalism assignment is already linked. Only unpublished ones are left.
          </p>
        ) : linkMatches.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No assignment matches &ldquo;{linkSearch}&rdquo;.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border)]">
            {linkMatches.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 flex-wrap">
                <label className="flex items-center gap-2 flex-1 min-w-[12rem] min-w-0">
                  <input type="checkbox" checked={linkSelected.has(a.id)} onChange={() => toggleLinkRow(a.id)} aria-label={`Select ${a.name}`} />
                  <span className="text-sm text-[var(--color-text-body)] truncate" title={a.name}>{a.name}</span>
                  {!a.published && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] whitespace-nowrap">Unpublished</span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <Select
                    value={moduleFor(a)}
                    onChange={v => setLinkModuleById(prev => ({ ...prev, [a.id]: v }))}
                    aria-label={`Module for ${a.name}`}
                    className="w-40"
                    options={[{ value: '', label: 'No module' }, ...modules.map(m => ({ value: m.id, label: m.name }))]}
                  />
                  <Button size="sm" variant="secondary" icon={Link2} onClick={() => handleLink(a, moduleFor(a))} disabled={linkingId === a.id || !!bulkProgress}>
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
            courseSetup={courseSetup} journalGaps={journalGaps} onAdded={handleRowChanged} onRemove={setRemoving} onEdit={setEditing} />
        </Card>
      )}

      {removing && (
        <RemoveLabModal entry={removing} assignments={assignments} courseId={courseId} courseName={courseName}
          onClose={() => setRemoving(null)} onRemoved={handleRemoved} />
      )}

      {editing && (
        <EditLabModal
          entry={editing}
          assignment={assignments.find(a => a.id === editing.professionalismAssignmentId)}
          assignments={assignments}
          modules={modules}
          sections={sections}
          courseSetup={courseSetup}
          courseId={courseId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged?.() }}
        />
      )}
    </div>
  )
}
