import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { Loader, AlertTriangle, ChevronRight, ChevronDown, Flag, Maximize2, Plus } from 'lucide-react'
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
import { getCourseSetup, getLabs, isStandalone, getFlags } from '../../storage/setup.js'
import { resolveFlags, flagIndex, FLAG_BY_ID } from '../../config/labFlags.js'
import {
  getLabGrading, saveDraft, commitLabGrading, discardDraft, isUnsavedDraft,
  deriveSectionScores, deriveStudentScore, emptySection,
  toggleKitchenFlag, setKitchenExceeded, toggleStudentFlag, setStudentKitchen, setPresent, setStudentComment, setStudentExceeded, toggleStudentLibraryComment,
} from '../../storage/labGrading.js'
import { commitAbsent } from './absentCommit.js'

// Absence convention, unchanged from the old tabs: a professionalism score of
// exactly 0 is what an absence writes, so "currently 0" means "already absent".
const WRITTEN_ZERO = 0
const DEFAULT_KITCHENS = 8

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
  const [flags, setFlags]             = useState(null) // global flag definitions; null -> built-in defaults
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
    // getFlags is global (not course-scoped) but is cheap and lives here so the
    // picker/scoring always see the teacher's latest edits on a course switch.
    Promise.all([getLabs(courseId), getSections(courseId), getCourseSetup(courseId), getFlags()])
      .then(([labs, secs, setup, f]) => { setEntries(labs); setSections(secs); setCourseSetup(setup); setFlags(f) })
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
  // useCallback keeps this reference stable across re-renders so memoized
  // StudentRows do not all re-render on every keystroke (the onApply prop would
  // otherwise change identity each render and defeat the memo).
  const applySection = useCallback((next) => {
    setSection(next)
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => { saveDraft(labId, sectionId, next) }, 600)
  }, [labId, sectionId])

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
    const maxScore = courseSetup?.settings?.maxScore ?? 4
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
          // A free-text note on an absent student still posts (timely feedback),
          // deduped like the present path. Absent students carry no flag summary.
          const note = buildComment(section, s.userId, 0, commentsOn, byId)
          if (note && !(profComments[s.userId] ?? []).includes(note)) {
            await updateSubmissionGrade(courseId, entry.professionalismAssignmentId, s.userId, { text_comment: note })
          }
        } else {
          const value = deriveStudentScore(section, s.userId, maxScore, byId)
          const fields = { posted_grade: String(value) }
          // Flag summary (gated on the course setting) plus any free-text comment,
          // as one body. Skip posting if that exact text is already on the
          // submission, so re-committing unchanged work does not duplicate it.
          const comment = buildComment(section, s.userId, value, commentsOn, byId)
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

  // Reference-stable comment library (an inline `?? []` mints a new array each
  // render and re-renders every memoized StudentRow). MUST stay above the early
  // returns below — a hook called after a conditional return changes the per-render
  // hook count and crashes the component (this is what blanked the Lab tab).
  const commentLibrary = useMemo(() => courseSetup?.settings?.commentLibrary ?? [], [courseSetup])

  // Resolved flag config: the teacher's global list (or the built-in defaults
  // until they edit), split into the pickers' option lists plus an id->flag map
  // for labels/severity. MUST stay above the early returns below (same reason as
  // commentLibrary) — a hook after a conditional return blanks the component.
  const { byId, kitchen: kitchenFlagOptions, individual: individualFlagOptions } =
    useMemo(() => flagIndex(resolveFlags(flags)), [flags])

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

  const maxScore = courseSetup?.settings?.maxScore ?? 4
  const scores = deriveSectionScores(section, maxScore, byId)
  const kitchenTone = id => (byId[id]?.severity === 'critical' ? 'critical' : 'minor')
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
                    Exceeded ({maxScore})
                  </Chip>
                </div>
                <div className="px-4 py-3 space-y-3">
                  {/* Kitchen flags apply to everyone in this kitchen. */}
                  <div className="space-y-1.5">
                    <FlagModalPicker
                      title={`Kitchen ${k} — add flags`}
                      options={kitchenFlagOptions}
                      selectedIds={kflags}
                      toneFor={kitchenTone}
                      onToggle={id => applySection(toggleKitchenFlag(section, k, id))}
                    />
                    {kflags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {kflags.map(id => (
                          <Chip key={id} tone={kitchenTone(id)} active onClick={() => applySection(toggleKitchenFlag(section, k, id))} title="Remove">
                            {byId[id]?.label ?? id} ✕
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Roster for this kitchen. */}
                  <div className="divide-y divide-[var(--color-border-subtle)]">
                    {members.length === 0 && (
                      <p className="text-xs text-[var(--color-text-muted)] py-2">No students assigned. Use the kitchen picker below.</p>
                    )}
                    {members.map(s => (
                      <StudentRow key={s.userId} student={s} section={section} score={scores[s.userId]}
                        kitchenCount={kitchenCount} commentLibrary={commentLibrary} maxScore={maxScore}
                        flagsById={byId} individualFlags={individualFlagOptions} onApply={applySection} />
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
                    kitchenCount={kitchenCount} commentLibrary={commentLibrary} maxScore={maxScore}
                    flagsById={byId} individualFlags={individualFlagOptions} onApply={applySection} />
                ))}
              </div>
            </Card>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
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

// One student line. On md+ it is a single inline row. On phone it collapses to a
// tappable summary (name · score · Present) with a flag-count hint; the chevron
// expands the controls, so a long roster stays clean until a student needs edits.
// The controls live in a display:contents wrapper so they lay out inline in the
// row on md+ (md:contents) and only hide on a collapsed phone — no duplicate markup.
function StudentRowBase({ student, section, score, kitchenCount, commentLibrary = [], maxScore = 4, flagsById = FLAG_BY_ID, individualFlags = [], onApply }) {
  const st = section.students[student.userId] ?? { kitchen: null, flagIds: [], present: true, excused: false }
  const absent = st.present === false
  const [open, setOpen] = useState(false)
  const [commentOpen, setCommentOpen] = useState(false)   // big write modal (Apple Pencil / large screen)
  const [libraryOpen, setLibraryOpen] = useState(false)   // comment-library picker modal

  // Library chips shared by the "+" picker and the enlarge modal. Toggles attach
  // or remove a saved comment on this student.
  const libraryChips = (
    <div className="flex flex-wrap gap-1.5">
      {commentLibrary.map(c => {
        const on = (st.libraryComments ?? []).includes(c)
        return (
          <Chip key={c} tone="note" active={on}
            onClick={() => onApply(toggleStudentLibraryComment(section, student.userId, c))}
            title={on ? 'Remove this comment' : 'Add this comment'}>
            {c}
          </Chip>
        )
      })}
    </div>
  )
  const attachedCount = (st.libraryComments ?? []).length
  return (
    <div className="py-2 md:py-1.5 space-y-1.5 md:space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse student' : 'Expand student'}
          className="md:hidden shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-body)]"
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <span className="shrink-0 text-sm font-medium text-[var(--color-text-body)] truncate max-w-[8rem] md:max-w-none md:w-36" title={student.userName}>{student.userName}</span>
        <span className={`inline-flex items-center justify-center w-10 h-7 shrink-0 rounded-[var(--radius-control)] text-sm font-bold border-2 border-[var(--color-border-strong)] ${
          absent ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-body)]'
        }`}>{absent ? '0' : score}</span>
        <Button size="sm" variant={absent ? 'danger' : 'success'}
          onClick={() => onApply(setPresent(section, student.userId, absent))}>
          {absent ? 'Absent' : 'Present'}
        </Button>
        {/* Collapsed-on-phone hint that flags exist underneath. */}
        {!open && !absent && st.flagIds.length > 0 && (
          <span className="md:hidden text-xs font-medium text-[var(--color-info)]">{st.flagIds.length} flag{st.flagIds.length === 1 ? '' : 's'}</span>
        )}
        {/* Controls — inline on md+, collapsible on phone. display:contents lets the
            children join the row's flex layout directly, so there is one markup. */}
        <div className={`${open ? 'contents' : 'hidden'} md:contents`}>
          {!absent && (
            <Chip tone="exceeded" active={!!st.exceeded}
              onClick={() => onApply(setStudentExceeded(section, student.userId, !st.exceeded))}
              title={`Mark this student as exceeding expectations (${maxScore})`}>Exceeds</Chip>
          )}
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
            className={`${st.kitchen == null ? 'w-36' : 'w-24'} shrink-0`}
            options={[
              { value: '', label: 'No kitchen' },
              ...Array.from({ length: kitchenCount }, (_, i) => ({ value: String(i + 1), label: `K${i + 1}` })),
            ]}
          />
          {!absent && (
            <FlagModalPicker
              title={`${student.userName} — add flags`}
              options={individualFlags}
              selectedIds={st.flagIds}
              onToggle={id => onApply(toggleStudentFlag(section, student.userId, id))}
            />
          )}
          <div className="w-full md:flex-1 md:min-w-[14rem] flex items-center gap-1">
            <input
              type="text"
              value={st.comment ?? ''}
              onChange={e => onApply(setStudentComment(section, student.userId, e.target.value))}
              placeholder="Comment (optional)"
              aria-label={`Comment for ${student.userName}`}
              className="flex-1 min-w-0 text-sm px-2 py-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-page)]"
            />
            {commentLibrary.length > 0 && (
              <button type="button" onClick={() => setLibraryOpen(true)}
                aria-label={`Insert a saved comment for ${student.userName}`}
                title="Insert a saved comment"
                className="shrink-0 relative p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-body)]">
                <Plus size={16} />
                {attachedCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 text-[0.6rem] font-bold text-[var(--color-info)]">{attachedCount}</span>
                )}
              </button>
            )}
            <button type="button" onClick={() => setCommentOpen(true)}
              aria-label={`Write a longer comment for ${student.userName}`}
              title="Enlarge the comment box"
              className="shrink-0 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-body)]">
              <Maximize2 size={16} />
            </button>
          </div>
        </div>
      </div>
      {!absent && st.flagIds.length > 0 && (
        <div className={`${open ? 'flex' : 'hidden'} md:flex flex-wrap gap-1 md:pl-36`}>
          {st.flagIds.map(id => (
            <Chip key={id} tone="individual" active onClick={() => onApply(toggleStudentFlag(section, student.userId, id))} title="Remove">
              {flagsById[id]?.label ?? id} ✕
            </Chip>
          ))}
        </div>
      )}
      {commentOpen && (
        <Modal
          title={`Comment — ${student.userName}`}
          onClose={() => setCommentOpen(false)}
          footer={<Button onClick={() => setCommentOpen(false)}>Done</Button>}
        >
          <textarea
            autoFocus
            value={st.comment ?? ''}
            onChange={e => onApply(setStudentComment(section, student.userId, e.target.value))}
            placeholder="Write a comment for this student"
            className="w-full h-48 text-sm px-3 py-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-page)] text-[var(--color-text-body)]"
          />
          {commentLibrary.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-[var(--color-text-muted)]">Saved comments — tap to add or remove</p>
              {libraryChips}
            </div>
          )}
        </Modal>
      )}
      {libraryOpen && (
        <Modal
          title={`Saved comments — ${student.userName}`}
          onClose={() => setLibraryOpen(false)}
          footer={<Button onClick={() => setLibraryOpen(false)}>Done</Button>}
        >
          <p className="text-xs text-[var(--color-text-muted)] mb-2">Tap to add or remove. These post as submission comments on commit.</p>
          {libraryChips}
        </Modal>
      )}
    </div>
  )
}

// Re-render a row only when its own inputs change. applySection replaces just the
// edited student's object (every other student keeps its reference), and onApply /
// commentLibrary are stabilized in the parent — so typing in one comment or
// reassigning one kitchen no longer re-renders the whole roster. `score` already
// reflects this student's kitchen flags, so comparing it covers kitchen changes.
function studentRowEqual(prev, next) {
  return prev.score === next.score
    && prev.kitchenCount === next.kitchenCount
    && prev.maxScore === next.maxScore
    && prev.commentLibrary === next.commentLibrary
    && prev.flagsById === next.flagsById
    && prev.individualFlags === next.individualFlags
    && prev.onApply === next.onApply
    && prev.section.students[prev.student.userId] === next.section.students[next.student.userId]
}
const StudentRow = memo(StudentRowBase, studentRowEqual)

// Compact flag picker: a small "⚑ Flag" button that opens a modal of toggle
// chips. Tapping a chip adds or removes that flag immediately; the selected flags
// still render as removable pills at the call site, so this component is only the
// picker, not the display. Replaces the old flag dropdown — easier to tap on an
// iPad, and it frees row space for the comment controls.
function FlagModalPicker({ title, options, selectedIds, toneFor, onToggle }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="secondary" icon={Flag} onClick={() => setOpen(true)}>Flag</Button>
      {open && (
        <Modal
          title={title}
          onClose={() => setOpen(false)}
          footer={<Button onClick={() => setOpen(false)}>Done</Button>}
        >
          <p className="text-xs text-[var(--color-text-muted)] mb-2">Tap to add or remove.</p>
          <div className="flex flex-wrap gap-1.5">
            {options.map(o => {
              const on = selectedIds.includes(o.id)
              return (
                <Chip key={o.id} tone={toneFor ? toneFor(o.id) : 'individual'} active={on}
                  onClick={() => onToggle(o.id)} title={on ? 'Remove' : 'Add'}>
                  {o.label}
                </Chip>
              )
            })}
          </div>
        </Modal>
      )}
    </>
  )
}

// One submission comment body: the flag summary (only when the course setting is
// on) plus any free-text comment. Deterministic, so an unchanged commit produces
// the same string and can be skipped as a duplicate.
function buildComment(section, studentId, score, includeFlags, byId = FLAG_BY_ID) {
  const st = section.students[studentId]
  if (!st) return ''
  const parts = []
  if (includeFlags) {
    const kitchen = st.kitchen != null ? section.kitchens[st.kitchen] : null
    const kitchenLabels = (kitchen?.flagIds ?? []).map(id => byId[id]?.label).filter(Boolean)
    const indivLabels = (st.flagIds ?? []).map(id => byId[id]?.label).filter(Boolean)
    if (st.exceeded && indivLabels.length === 0) {
      parts.push(`Professionalism: ${score}/4 — Exceeded expectations`)
    } else if (kitchenLabels.length || indivLabels.length) {
      const lines = [`Professionalism: ${score}/4`]
      if (kitchenLabels.length) lines.push(`Kitchen: ${kitchenLabels.join(', ')}`)
      if (indivLabels.length) lines.push(`Individual: ${indivLabels.join(', ')}`)
      parts.push(lines.join('\n'))
    }
  }
  for (const lib of (st.libraryComments ?? [])) {
    const t = lib.trim()
    if (t) parts.push(t)
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
