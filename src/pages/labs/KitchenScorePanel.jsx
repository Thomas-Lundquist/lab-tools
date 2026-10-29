import { useState, useEffect, useRef } from 'react'
import { Loader, AlertTriangle } from 'lucide-react'
import Card from '../../components/Card.jsx'
import Button from '../../components/Button.jsx'
import Select from '../../components/Select.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import Modal from '../../components/Modal.jsx'
import Chip from '../../components/Chip.jsx'
import { useToast } from '../../components/Toast.jsx'
import { usePinGate } from '../../security/usePinGate.jsx'
import { getSections } from '../../api/sections.js'
import { getEnrollments } from '../../api/enrollments.js'
import { getAssignmentSubmissions, updateSubmissionGrade } from '../../api/submissions.js'
import { getOverrides } from '../../api/overrides.js'
import { getCourseSetup, getLabs, isStandalone } from '../../storage/setup.js'
import { KITCHEN_FLAGS, INDIVIDUAL_FLAGS, FLAG_BY_ID } from '../../config/labFlags.js'
import {
  getLabGrading, saveDraft, commitLabGrading, discardDraft, isUnsavedDraft,
  deriveSectionScores, deriveStudentScore, emptySection,
  toggleKitchenFlag, setKitchenExceeded, toggleStudentFlag, setStudentKitchen, setPresent, setStudentComment,
} from '../../storage/labGrading.js'
import { commitAbsent } from './absentCommit.js'

// Absence convention, unchanged from the old tabs: a professionalism score of
// exactly 0 is what an absence writes, so "currently 0" means "already absent".
const WRITTEN_ZERO = 0
const DEFAULT_KITCHENS = 8
const kitchenTone = id => (FLAG_BY_ID[id]?.severity === 'critical' ? 'critical' : 'minor')

// Build the working section from the roster, seeding each student from the prior
// (committed or draft) flags and from Canvas for present/absent. A Canvas score
// of 0 means already-absent; null/ungraded or a real score means present.
function buildSection(roster, prior, profScores) {
  const students = {}
  for (const s of roster) {
    const was = prior?.students?.[s.userId]
    const canvas = profScores[s.userId]
    students[s.userId] = {
      kitchen: was?.kitchen ?? null,
      flagIds: was?.flagIds ?? [],
      present: was ? was.present : canvas !== WRITTEN_ZERO,
      excused: was?.excused ?? false,
    }
  }
  return { kitchens: prior?.kitchens ?? {}, students }
}

export default function KitchenScorePanel({
  courseId, courseName, loadingCourse, ready, setupVersion,
  labId, sectionId, onSelect, onChanged, onGoToSetup, onGoToLabs,
}) {
  const toast = useToast()
  const { requirePin } = usePinGate()

  const [loading, setLoading]         = useState(false)
  const [entries, setEntries]         = useState([])
  const [sections, setSections]       = useState([])
  const [courseSetup, setCourseSetup] = useState(null)
  const [profOverrides, setProfOverrides] = useState(null)

  const [rosterLoading, setRosterLoading] = useState(false)
  const [roster, setRoster]           = useState([])   // [{ userId, userName }]
  const [profScores, setProfScores]   = useState({})   // userId -> score|null
  const [profComments, setProfComments] = useState({}) // userId -> [existing comment bodies]
  const [section, setSection]         = useState(emptySection())
  const [kitchenCount, setKitchenCount] = useState(DEFAULT_KITCHENS)

  const [pendingDraft, setPendingDraft] = useState(null) // the stored state when an unsaved draft exists
  const [confirming, setConfirming]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [progress, setProgress]       = useState('')

  const autosaveTimer = useRef(null)

  const entry = entries.find(e => e.id === labId) ?? null

  // --- course-level loads ---
  useEffect(() => {
    if (!courseId) { setEntries([]); setSections([]); setCourseSetup(null); return }
    setLoading(true)
    Promise.all([getLabs(courseId), getSections(courseId), getCourseSetup(courseId)])
      .then(([labs, secs, setup]) => { setEntries(labs); setSections(secs); setCourseSetup(setup) })
      .finally(() => setLoading(false))
  }, [courseId, setupVersion])

  // --- which sections this lab is actually assigned to ---
  useEffect(() => {
    if (!entry) { setProfOverrides(null); return }
    let cancelled = false
    getOverrides(courseId, entry.professionalismAssignmentId)
      .then(o => { if (!cancelled) setProfOverrides(o) })
      .catch(() => { if (!cancelled) setProfOverrides([]) })
    return () => { cancelled = true }
  }, [entry, courseId])

  // --- roster + current scores + stored flags for the chosen lab/section ---
  useEffect(() => {
    clearTimeout(autosaveTimer.current)
    setPendingDraft(null)
    if (!entry || !sectionId) { setRoster([]); setProfScores({}); setSection(emptySection()); return }
    setRosterLoading(true)
    Promise.all([
      getEnrollments(courseId),
      getAssignmentSubmissions(courseId, entry.professionalismAssignmentId, { includeComments: true }),
      getLabGrading(labId, sectionId),
    ])
      .then(([enrollments, profSubs, stored]) => {
        const sec = sections.find(s => s.id === sectionId)
        const idsInSection = new Set(sec?.studentIds ?? [])
        const inSection = enrollments
          .filter(e => idsInSection.has(e.userId))
          .sort((a, b) => (a.userSortableName ?? '').localeCompare(b.userSortableName ?? ''))
        const r = inSection.map(e => ({ userId: e.userId, userName: e.userName }))
        const scores = Object.fromEntries(profSubs.map(s => [s.userId, s.score]))
        setRoster(r)
        setProfScores(scores)
        setProfComments(Object.fromEntries(profSubs.map(s => [s.userId, s.comments ?? []])))
        // Baseline from the committed flags; a draft, if any, is offered via prompt.
        setSection(buildSection(r, stored.committed, scores))
        setKitchenCount(maxKitchen(stored.committed, stored.draft))
        if (isUnsavedDraft(stored)) setPendingDraft(stored)
      })
      .finally(() => setRosterLoading(false))
  }, [entry, sectionId, courseId, sections, labId])

  // Every edit goes through here: update state AND debounce-save a draft. Load and
  // Resume call setSection directly, so a draft is only ever written by a real edit.
  function applySection(next) {
    setSection(next)
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => { saveDraft(labId, sectionId, next) }, 600)
  }

  function resumeDraft() {
    const draft = buildSection(roster, pendingDraft.draft, profScores)
    setSection(draft)
    setKitchenCount(maxKitchen(pendingDraft.draft, pendingDraft.committed))
    setPendingDraft(null)
  }

  async function discardAndUseCanvas() {
    await discardDraft(labId, sectionId)
    setPendingDraft(null) // section already shows the committed baseline
  }

  async function refreshScores() {
    const subs = await getAssignmentSubmissions(courseId, entry.professionalismAssignmentId, { includeComments: true })
    setProfScores(Object.fromEntries(subs.map(s => [s.userId, s.score])))
    setProfComments(Object.fromEntries(subs.map(s => [s.userId, s.comments ?? []])))
  }

  async function doCommit() {
    setSaving(true)
    const commentsOn = !!courseSetup?.settings?.sendDeductionReasonsAsComment
    let done = 0, failed = 0
    for (const s of roster) {
      const st = section.students[s.userId]
      try {
        if (st?.present === false) {
          await commitAbsent(courseId, entry, s.userId, {
            excused: st.excused,
            zeroJournalWhenAbsent: courseSetup.settings.zeroJournalWhenAbsent,
            userName: s.userName,
          })
        } else {
          const value = deriveStudentScore(section, s.userId)
          const fields = { posted_grade: String(value) }
          // Flag summary (gated on the course setting) plus any free-text comment,
          // as one body. Skip posting if that exact text is already on the
          // submission, so re-committing unchanged work does not duplicate it.
          const comment = buildComment(section, s.userId, value, commentsOn)
          if (comment && !(profComments[s.userId] ?? []).includes(comment)) fields.text_comment = comment
          await updateSubmissionGrade(courseId, entry.professionalismAssignmentId, s.userId, fields)
        }
      } catch { failed++ }
      done++
      setProgress(`${done} of ${roster.length} saved…`)
    }
    await commitLabGrading(labId, sectionId, section)
    await refreshScores()
    setSaving(false); setConfirming(false); setProgress('')
    if (failed) toast(`Committed ${roster.length - failed} of ${roster.length} — ${failed} failed`, 'warning')
    else toast(`Committed ${roster.length} student${roster.length === 1 ? '' : 's'} for ${entry.name}`, 'success')
    onChanged?.()
  }

  async function handleCommit() {
    await requirePin(
      { action: 'commit_lab_period', summary: `Commit ${roster.length} student${roster.length === 1 ? '' : 's'} for ${entry.name} in ${courseName}`, courseId, courseName },
      doCommit,
    )
  }

  // --- gating / empty states ---
  if (loading || loadingCourse) {
    return <div className="space-y-3"><Skeleton height="4rem" /><Skeleton height="16rem" /></div>
  }
  if (!courseId) return <EmptyState title="Select a course" body="Choose a course above to grade a lab." />
  if (!ready) {
    return (
      <EmptyState
        title="Finish setup first"
        body="Enable this course and create the Professionalism assignment group before grading."
        actions={<Button onClick={onGoToSetup}>Set Up Course</Button>}
      />
    )
  }
  if (!entries.length) {
    return (
      <EmptyState
        title="Nothing to grade yet"
        body="Create a Professionalism assignment first — a pairing with a lab journal, or a standalone."
        actions={<Button onClick={onGoToLabs}>Go to Professionalism</Button>}
      />
    )
  }

  const pairedEntries = entries.filter(e => !isStandalone(e))
  const standaloneEntries = entries.filter(isStandalone)
  const overrideSectionIds = profOverrides
    ? new Set(profOverrides.filter(o => o.courseSectionId).map(o => o.courseSectionId))
    : null
  const gradeableSections = overrideSectionIds && overrideSectionIds.size > 0
    ? sections.filter(s => overrideSectionIds.has(s.id))
    : sections
  const overridesLoading = !!entry && profOverrides === null

  const scores = deriveSectionScores(section)
  const commentsOn = !!courseSetup?.settings?.sendDeductionReasonsAsComment
  const presentUnassigned = roster.filter(s => {
    const st = section.students[s.userId]
    return st?.present !== false && st?.kitchen == null
  })
  const kitchenNumbers = Array.from({ length: kitchenCount }, (_, i) => i + 1)
  const unassigned = roster.filter(s => section.students[s.userId]?.kitchen == null)

  return (
    <div className="space-y-6">
      {/* Working context: pick the lab + period ONCE; both persist across tabs. */}
      <Card className="space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <FieldLabel htmlFor="lab">Lab</FieldLabel>
            <Select id="lab" value={labId ?? ''} onChange={id => onSelect(id, '')}>
              <option value="">Select a lab</option>
              {pairedEntries.length > 0 && (
                <optgroup label="Pairings">
                  {pairedEntries.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </optgroup>
              )}
              {standaloneEntries.length > 0 && (
                <optgroup label="Standalone">
                  {standaloneEntries.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </optgroup>
              )}
            </Select>
          </div>
          <div className="sm:col-span-1">
            <FieldLabel htmlFor="period">Period</FieldLabel>
            <Select id="period" value={sectionId ?? ''} onChange={sid => onSelect(labId, sid)} disabled={!labId || overridesLoading}
              options={[
                { value: '', label: overridesLoading ? 'Loading…' : 'Select a period' },
                ...gradeableSections.map(s => ({ value: s.id, label: s.name })),
              ]} />
          </div>
          <div className="sm:col-span-1">
            <FieldLabel htmlFor="kcount">Kitchens</FieldLabel>
            <Select id="kcount" value={String(kitchenCount)} onChange={v => setKitchenCount(Number(v))}
              options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
          </div>
        </div>
      </Card>

      {/* Resume/discard prompt: local work exists that is newer than Canvas. */}
      {pendingDraft && (
        <Card className="border-2 border-[var(--color-warning)] bg-[var(--color-bg-hover)]">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-[var(--color-warning)] mt-0.5 shrink-0" />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-[var(--color-text-body)]">
                There is saved work from {fmtWhen(pendingDraft.updatedAt)} on this period.
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Resume your unsaved draft, or discard it and load the current scores from Canvas.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={resumeDraft}>Resume draft</Button>
                <Button size="sm" variant="secondary" onClick={discardAndUseCanvas}>Discard &amp; use Canvas</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {rosterLoading && <Skeleton height="20rem" />}

      {!rosterLoading && entry && sectionId && roster.length === 0 && (
        <EmptyState title="No students in this period" body="This section has no enrolled students." />
      )}

      {!rosterLoading && entry && sectionId && roster.length > 0 && (
        <>
          {kitchenNumbers.map(k => {
            const members = roster.filter(s => section.students[s.userId]?.kitchen === k)
            const kflags = section.kitchens[k]?.flagIds ?? []
            const exceeded = section.kitchens[k]?.exceeded ?? false
            return (
              <Card key={k} padding="none" className="overflow-hidden border-2 border-[var(--color-border-strong)]">
                {/* Bauhaus: a bold numbered header block. */}
                <div className="flex items-center justify-between gap-3 px-4 py-2 bg-[var(--color-bg-hover)] border-b-2 border-[var(--color-border-strong)]">
                  <h3 className="text-sm font-bold text-[var(--color-text-body)]">Kitchen {k}</h3>
                  <Chip tone="exceeded" active={exceeded} onClick={() => applySection(setKitchenExceeded(section, k, !exceeded))}>
                    Exceeded (4)
                  </Chip>
                </div>
                <div className="px-4 py-3 space-y-3">
                  {/* Kitchen flags apply to everyone in this kitchen. */}
                  <FlagPicker
                    label="Add kitchen flag…"
                    options={KITCHEN_FLAGS}
                    selectedIds={kflags}
                    toneFor={kitchenTone}
                    onToggle={id => applySection(toggleKitchenFlag(section, k, id))}
                  />

                  {/* Roster for this kitchen. */}
                  <div className="divide-y divide-[var(--color-border-subtle)]">
                    {members.length === 0 && (
                      <p className="text-xs text-[var(--color-text-muted)] py-2">No students assigned. Use the kitchen picker below.</p>
                    )}
                    {members.map(s => (
                      <StudentRow key={s.userId} student={s} section={section} score={scores[s.userId]}
                        kitchenCount={kitchenCount} onApply={applySection} />
                    ))}
                  </div>
                </div>
              </Card>
            )
          })}

          {/* Unassigned students — place each into a kitchen. */}
          {unassigned.length > 0 && (
            <Card padding="none" className="overflow-hidden border-2 border-dashed border-[var(--color-border-strong)]">
              <div className="px-4 py-2 bg-[var(--color-bg-hover)] border-b-2 border-[var(--color-border-strong)]">
                <h3 className="text-sm font-bold text-[var(--color-text-body)]">Unassigned ({unassigned.length})</h3>
              </div>
              <div className="px-4 py-2 divide-y divide-[var(--color-border-subtle)]">
                {unassigned.map(s => (
                  <StudentRow key={s.userId} student={s} section={section} score={scores[s.userId]}
                    kitchenCount={kitchenCount} onApply={applySection} />
                ))}
              </div>
            </Card>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              Edits autosave on this device. Nothing posts to Canvas until you commit.
            </p>
            <Button onClick={() => setConfirming(true)}>Commit Period</Button>
          </div>
        </>
      )}

      {confirming && (
        <Modal
          title="Commit this period to Canvas"
          onClose={() => !saving && setConfirming(false)}
          footer={<>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCommit} disabled={saving}>
              <span className="flex items-center gap-1.5">{saving && <Loader size={13} className="animate-spin" />}Commit</span>
            </Button>
          </>}
        >
          <div className="text-sm text-[var(--color-text-secondary)] space-y-2">
            {presentUnassigned.length > 0 && (
              <p className="flex items-start gap-1.5 text-[var(--color-warning)]">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                {presentUnassigned.length} present student{presentUnassigned.length === 1 ? '' : 's'} {presentUnassigned.length === 1 ? 'has' : 'have'} no kitchen assigned — they will score as a clean kitchen. You can still commit.
              </p>
            )}
            <p>Post professionalism scores for {roster.length} student{roster.length === 1 ? '' : 's'} on &quot;{entry.name}&quot;, and zero absent students{entry?.journalAssignmentId ? ' (locking their journal)' : ''}?</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {commentsOn
                ? 'Flag summaries and your typed comments post as submission comments (an identical comment is not posted twice).'
                : 'Your typed comments post as submission comments. Flag summaries are off — turn on "Send deduction reasons as a submission comment" in Course Settings to include them.'}
            </p>
            <p>This changes real grades in Canvas.</p>
          </div>
          {saving && progress && <p className="text-xs text-[var(--color-text-muted)] mt-2">{progress}</p>}
        </Modal>
      )}
    </div>
  )
}

// One student line: name, score, present/absent, kitchen picker, individual flags.
function StudentRow({ student, section, score, kitchenCount, onApply }) {
  const st = section.students[student.userId] ?? { kitchen: null, flagIds: [], present: true, excused: false }
  const absent = st.present === false
  return (
    <div className="py-2 space-y-1.5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="w-40 shrink-0 text-sm font-medium text-[var(--color-text-body)]">{student.userName}</span>
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)] text-sm font-bold border-2 border-[var(--color-border-strong)] ${
          absent ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-body)]'
        }`}>{absent ? '0' : score}</span>
        <Button size="sm" variant={absent ? 'danger' : 'success'}
          onClick={() => onApply(setPresent(section, student.userId, absent))}>
          {absent ? 'Absent' : 'Present'}
        </Button>
        {absent && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <input type="checkbox" checked={!!st.excused}
              onChange={() => onApply({ ...section, students: { ...section.students, [student.userId]: { ...st, excused: !st.excused } } })} />
            Excused
          </label>
        )}
        <Select
          value={st.kitchen == null ? '' : String(st.kitchen)}
          onChange={v => onApply(setStudentKitchen(section, student.userId, v === '' ? null : Number(v)))}
          className="w-32"
          options={[
            { value: '', label: 'No kitchen' },
            ...Array.from({ length: kitchenCount }, (_, i) => ({ value: String(i + 1), label: `Kitchen ${i + 1}` })),
          ]}
        />
      </div>
      {!absent && (
        <div className="pl-40 space-y-1.5">
          <FlagPicker
            label="Add individual flag…"
            options={INDIVIDUAL_FLAGS}
            selectedIds={st.flagIds}
            toneFor={() => 'individual'}
            onToggle={id => onApply(toggleStudentFlag(section, student.userId, id))}
          />
          <input
            type="text"
            value={st.comment ?? ''}
            onChange={e => onApply(setStudentComment(section, student.userId, e.target.value))}
            placeholder="Comment to student (optional)"
            aria-label={`Comment for ${student.userName}`}
            className="w-full max-w-md text-sm px-2 py-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-page)]"
          />
        </div>
      )}
    </div>
  )
}

// Add-from-dropdown flag picker: the full list stays collapsed in a Select; the
// chosen flags show below as removable, severity-colored tags. Replaces the old
// always-visible chip wall to cut visual complexity.
function FlagPicker({ label, options, selectedIds, toneFor, onToggle }) {
  const available = options.filter(o => !selectedIds.includes(o.id))
  return (
    <div className="space-y-1.5">
      <Select
        value=""
        onChange={id => { if (id) onToggle(id) }}
        className="w-64"
        options={[{ value: '', label }, ...available.map(o => ({ value: o.id, label: o.label }))]}
      />
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedIds.map(id => (
            <Chip key={id} tone={toneFor(id)} active onClick={() => onToggle(id)} title="Remove">
              {FLAG_BY_ID[id]?.label ?? id} ✕
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

// One submission comment body: the flag summary (only when the course setting is
// on) plus any free-text comment. Deterministic, so an unchanged commit produces
// the same string and can be skipped as a duplicate.
function buildComment(section, studentId, score, includeFlags) {
  const st = section.students[studentId]
  if (!st) return ''
  const parts = []
  if (includeFlags) {
    const kitchen = st.kitchen != null ? section.kitchens[st.kitchen] : null
    const kitchenLabels = (kitchen?.flagIds ?? []).map(id => FLAG_BY_ID[id]?.label).filter(Boolean)
    const indivLabels = (st.flagIds ?? []).map(id => FLAG_BY_ID[id]?.label).filter(Boolean)
    if (kitchenLabels.length || indivLabels.length) {
      const lines = [`Professionalism: ${score}/4`]
      if (kitchenLabels.length) lines.push(`Kitchen: ${kitchenLabels.join(', ')}`)
      if (indivLabels.length) lines.push(`Individual: ${indivLabels.join(', ')}`)
      parts.push(lines.join('\n'))
    }
  }
  const free = (st.comment ?? '').trim()
  if (free) parts.push(free)
  return parts.join('\n\n')
}

// Highest kitchen number referenced by either stored slot, floored at the default
// so a fresh lab shows the full set of kitchen cards.
function maxKitchen(...sectionsMaybe) {
  let max = DEFAULT_KITCHENS
  for (const sec of sectionsMaybe) {
    for (const st of Object.values(sec?.students ?? {})) {
      if (typeof st.kitchen === 'number' && st.kitchen > max) max = st.kitchen
    }
    for (const k of Object.keys(sec?.kitchens ?? {})) {
      const n = Number(k)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return max
}

function fmtWhen(iso) {
  if (!iso) return 'earlier'
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return 'earlier'
  }
}
