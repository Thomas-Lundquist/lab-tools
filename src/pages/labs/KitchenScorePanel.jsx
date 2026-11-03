import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { Loader, AlertTriangle, ChevronRight, ChevronDown, Flag, Maximize2, Plus, Undo2, XCircle } from 'lucide-react'
import Card from '../../components/Card.jsx'
import Button from '../../components/Button.jsx'
import Select from '../../components/Select.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import Modal from '../../components/Modal.jsx'
import Chip from '../../components/Chip.jsx'
import { useToast } from '../../components/Toast.jsx'
import ChangedInCanvas from '../../components/ChangedInCanvas.jsx'
import { usePinGate } from '../../security/usePinGate.jsx'
import { getSections } from '../../api/sections.js'
import { getEnrollments } from '../../api/enrollments.js'
import { getAssignmentSubmissions } from '../../api/submissions.js'
import { getOverrides } from '../../api/overrides.js'
import { getCourseSetup, getLabs, isStandalone, getFlags, getCommentBank } from '../../storage/setup.js'
import { resolveFlags, flagIndex, FLAG_BY_ID } from '../../config/labFlags.js'
import {
  getLabGrading, getAllLabGrading, saveDraft, commitLabGrading, discardDraft, isUnsavedDraft, revertLabGrading, periodStatus,
  deriveSectionScores, emptySection,
  toggleKitchenFlag, setKitchenExceeded, toggleStudentFlag, setStudentKitchen, setPresent, setStudentComment, setStudentExceeded, toggleStudentLibraryComment,
} from '../../storage/labGrading.js'
import { seedStandingKitchens, saveStandingKitchen, isLatestLab, newestFirst, todaysLab, labDateFor, localToday } from '../../storage/kitchens.js'
import { uncommittedPeriods } from './periodStatus.js'
import { planCommit, buildSection } from './commitPlan.js'
import { runCommit, runRevert, planRevert } from './commitRun.js'

// Every lab room has eight kitchens. A lab saved when the count was adjustable
// may reference more, so the screen shows up to the highest one in use.
const KITCHEN_COUNT = 8


// Stable empty list for the comment bank before it loads, so memoized rows
// don't see a new array every render.
const EMPTY = []

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
  const [commentLibrary, setCommentLibrary] = useState(EMPTY) // global comment bank (Settings › Grading)
  const [profOverrides, setProfOverrides] = useState(null)

  const [rosterLoading, setRosterLoading] = useState(false)
  const [roster, setRoster]           = useState([])   // [{ userId, userName }]
  const [profScores, setProfScores]   = useState({})   // userId -> score|null
  const [profState, setProfState]     = useState({})   // userId -> { score, excused, comments }
  const [loadError, setLoadError]     = useState(null)
  const [stored, setStored]           = useState(null) // this period's stored grading state (for Revert)
  const [statuses, setStatuses]       = useState({})   // sectionId -> 'done' | 'draft' (period checkmarks)
  const [committedAt, setCommittedAt] = useState({})   // sectionId -> when this lab was last committed there
  const [due, setDue]                 = useState([])   // periods from recent lab days not committed yet
  const [dismissed, setDismissed]     = useState(() => new Set()) // "labId:sectionId" hidden until next launch
  const [section, setSection]         = useState(emptySection())
  const [standing, setStanding]       = useState(null) // this period's usual kitchens (storage/kitchens.js)

  const [pendingDraft, setPendingDraft] = useState(null) // the stored state when an unsaved draft exists
  const [confirming, setConfirming]   = useState(false)
  const [preview, setPreview]         = useState(null) // { plan, canvas } | { error } while confirming
  const [overwrite, setOverwrite]     = useState(() => new Set()) // students changed in Canvas to overwrite anyway
  const [revertPreview, setRevertPreview] = useState(null) // { changed } | { error } while the revert confirm is open
  const [reverting, setReverting]     = useState(false) // revert confirm open
  const [saving, setSaving]           = useState(false)
  const [progress, setProgress]       = useState('')

  const autosaveTimer = useRef(null)
  const autoPicked = useRef(false) // today's lab is picked once per launch, not on every reload
  const [reloadTick, setReloadTick]   = useState(0) // bumped by "Try again" after a failed load

  const entry = entries.find(e => e.id === labId) ?? null

  // --- course-level loads ---
  useEffect(() => {
    if (!courseId) { setEntries([]); setSections([]); setCourseSetup(null); return }
    setLoading(true)
    // getFlags is global (not course-scoped) but is cheap and lives here so the
    // picker/scoring always see the teacher's latest edits on a course switch.
    Promise.all([getLabs(courseId), getSections(courseId), getCourseSetup(courseId), getFlags(), getCommentBank()])
      .then(([labs, secs, setup, f, bank]) => { setEntries(labs); setSections(secs); setCourseSetup(setup); setFlags(f); setCommentLibrary(bank) })
      .finally(() => setLoading(false))
  }, [courseId, setupVersion])

  // --- open on today's lab ---
  // Once the course's labs load: if a lab is dated today and the remembered
  // one isn't it, switch to today's lab (keeping the period when the lab covers
  // it). With nothing remembered and nothing today, open the newest lab.
  useEffect(() => { autoPicked.current = false }, [courseId])
  useEffect(() => {
    // entries may still be the previous course's for a moment after a switch.
    if (autoPicked.current || !entries.length || entries[0].courseId !== courseId) return
    autoPicked.current = true
    const today = todaysLab(entries, sectionId)
    if (today && today.id !== labId) {
      onSelect(today.id, sectionId && today.dates?.[sectionId] ? sectionId : '')
    } else if (!labId || !entries.some(e => e.id === labId)) {
      onSelect(newestFirst(entries)[0].id, '')
    }
  }, [entries, courseId, labId, sectionId, onSelect])

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
    setLoadError(null)
    if (!entry || !sectionId) { setRoster([]); setProfScores({}); setProfState({}); setStored(null); setStanding(null); setSection(emptySection()); return }
    // A slower response for a period the teacher already left must not land on
    // the screen (it would show — and then autosave — the wrong period).
    let cancelled = false
    setRosterLoading(true)
    Promise.all([
      getEnrollments(courseId),
      getAssignmentSubmissions(courseId, entry.professionalismAssignmentId, { includeComments: true }),
      getLabGrading(labId, sectionId),
      seedStandingKitchens(courseId, sectionId, entries.map(e => e.id)), // never rejects
    ])
      .then(([enrollments, profSubs, storedState, standingKitchens]) => {
        if (cancelled) return
        const sec = sections.find(s => s.id === sectionId)
        const idsInSection = new Set(sec?.studentIds ?? [])
        const inSection = enrollments
          .filter(e => idsInSection.has(e.userId))
          .sort((a, b) => (a.userSortableName ?? '').localeCompare(b.userSortableName ?? ''))
        const r = inSection.map(e => ({ userId: e.userId, userName: e.userName }))
        const state = profStateFrom(profSubs)
        setRoster(r)
        setProfScores(Object.fromEntries(profSubs.map(s => [s.userId, s.score])))
        setProfState(state)
        setStored(storedState)
        setStanding(standingKitchens)
        // Baseline from the committed set; a draft, if any, is offered via prompt.
        // Students the lab hasn't placed yet start in their usual kitchen.
        setSection(buildSection(r, storedState.committed, state, standingKitchens))
        if (isUnsavedDraft(storedState)) setPendingDraft(storedState)
      })
      .catch(err => { if (!cancelled) { setRoster([]); setLoadError(err.message) } })
      .finally(() => { if (!cancelled) setRosterLoading(false) })
    return () => { cancelled = true }
  // entries (read only for the one-time seed) loads alongside sections, so it's covered.
  }, [entry, sectionId, courseId, sections, labId, reloadTick])

  // --- period status: which periods of this lab are committed / have drafts ---
  useEffect(() => {
    if (!labId) { setStatuses({}); setCommittedAt({}); return }
    let cancelled = false
    getAllLabGrading(labId).then(lab => {
      if (cancelled) return
      setStatuses(Object.fromEntries(Object.entries(lab).map(([sid, st]) => [sid, periodStatus(st)])))
      setCommittedAt(Object.fromEntries(Object.entries(lab).map(([sid, st]) => [sid, st?.committedAt ?? null])))
    })
    return () => { cancelled = true }
  }, [labId, stored])

  // --- periods from the last week's lab days that still aren't committed ---
  // Re-checked after every commit, revert, or first edit of a period.
  const draftKey = statuses[sectionId]
  useEffect(() => {
    if (!entries.length) { setDue([]); return }
    let cancelled = false
    const today = localToday()
    const recent = entries.filter(e => Object.values(e.dates ?? {}).some(d => d && d <= today))
    Promise.all(recent.map(e => getAllLabGrading(e.id).then(st => [e.id, st])))
      .then(pairs => { if (!cancelled) setDue(uncommittedPeriods(recent, Object.fromEntries(pairs), sections, today)) })
      .catch(() => { if (!cancelled) setDue([]) })
    return () => { cancelled = true }
  }, [entries, sections, stored, draftKey])

  // Every edit goes through here: update state AND debounce-save a draft. Load and
  // Resume call setSection directly, so a draft is only ever written by a real edit.
  // useCallback keeps this reference stable across re-renders so memoized
  // StudentRows do not all re-render on every keystroke (the onApply prop would
  // otherwise change identity each render and defeat the memo).
  //
  // Takes an UPDATER (section => newSection), applied to the latest state. A
  // memoized row only re-renders when its own student changes, so the `section`
  // it last saw is stale; building the new section from that snapshot silently
  // erased every other student's edits since (kitchen assignments vanishing).
  const applySection = useCallback((update) => {
    setSection(prev => {
      const next = update(prev)
      clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(() => { saveDraft(labId, sectionId, next) }, 600)
      return next
    })
    setStatuses(prev => (prev[sectionId] === 'draft' ? prev : { ...prev, [sectionId]: 'draft' }))
  }, [labId, sectionId])

  // Moving a student also moves their usual kitchen, so the next lab for this
  // period starts with the latest arrangement. A fix to an older lab doesn't.
  const latestLab = !!entry && isLatestLab(entry, entries, sectionId)
  const assignKitchen = useCallback((studentId, kitchen) => {
    applySection(s => setStudentKitchen(s, studentId, kitchen))
    if (latestLab) {
      saveStandingKitchen(courseId, sectionId, studentId, kitchen)
        .catch(err => toast(`Couldn't save the usual kitchen: ${err.message}`, 'warning'))
    }
  }, [applySection, courseId, sectionId, latestLab, toast])

  function resumeDraft() {
    const draft = buildSection(roster, pendingDraft.draft, profState, standing)
    setSection(draft)
    setPendingDraft(null)
  }

  async function discardAndUseCanvas() {
    setStored(await discardDraft(labId, sectionId))
    setPendingDraft(null) // section already shows the committed baseline
  }

  async function refreshScores() {
    const subs = await getAssignmentSubmissions(courseId, entry.professionalismAssignmentId, { includeComments: true })
    setProfScores(Object.fromEntries(subs.map(s => [s.userId, s.score])))
    setProfState(profStateFrom(subs))
  }

  // What Canvas holds right now for this period — professionalism scores,
  // excused states and comments, the journal's, and existing journal locks —
  // read fresh when the preview opens so the plan matches Canvas exactly.
  async function loadCanvasSnapshot() {
    const journalId = entry.journalAssignmentId
    const [profSubs, journalSubs, journalOverrides] = await Promise.all([
      getAssignmentSubmissions(courseId, entry.professionalismAssignmentId, { includeComments: true }),
      journalId ? getAssignmentSubmissions(courseId, journalId) : null,
      journalId ? getOverrides(courseId, journalId) : null,
    ])
    const locks = {}
    for (const o of journalOverrides ?? []) {
      if (o.studentIds?.length === 1) locks[o.studentIds[0]] = { id: o.id, lockAt: o.lockAt }
    }
    return {
      prof: profStateFrom(profSubs),
      journal: journalSubs ? Object.fromEntries(journalSubs.map(s => [s.userId, { score: s.score, excused: !!s.excused }])) : null,
      locks,
    }
  }

  function buildPlan(canvas, overwriteIds = overwrite) {
    return planCommit({
      posted: stored?.posted ?? {},
      overwrite: overwriteIds,
      roster, section, prior: stored?.committed ?? null, canvas,
      ids: { courseId, profId: entry.professionalismAssignmentId, journalId: entry.journalAssignmentId ?? null },
      settings: {
        commentsOn: !!courseSetup?.settings?.sendDeductionReasonsAsComment,
        maxScore: courseSetup?.settings?.maxScore ?? 4,
        zeroJournalWhenAbsent: courseSetup?.settings?.zeroJournalWhenAbsent ?? true,
      },
      byId,
    })
  }

  async function openPreview() {
    setConfirming(true)
    setPreview(null)
    const none = new Set()
    setOverwrite(none)
    try {
      const canvas = await loadCanvasSnapshot()
      setPreview({ plan: buildPlan(canvas, none), canvas })
    } catch (err) {
      setPreview({ error: err.message })
    }
  }

  // Overwrite toggle on a student changed in Canvas: re-plan from the same snapshot.
  function toggleOverwrite(userId) {
    const next = new Set(overwrite)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    setOverwrite(next)
    if (preview?.canvas) setPreview({ ...preview, plan: buildPlan(preview.canvas, next) })
  }

  async function doCommit() {
    // A pending autosave must not land after the commit and resurrect a draft.
    clearTimeout(autosaveTimer.current)
    setSaving(true)
    try {
      // Re-read Canvas right before writing: the plan acts on the latest state.
      const plan = buildPlan(await loadCanvasSnapshot())
      const { failures, record } = await runCommit(plan, {
        courseId, entry,
        onProgress: (done, total) => setProgress(`${done} of ${total} students saved…`),
      })
      // A partly failed commit keeps the draft, so the period still reads as
      // unsaved and the resume prompt offers a retry for the students that failed.
      // What Canvas now holds for each student this commit confirmed: the next
      // commit compares against it to spot changes made in Canvas.
      const failed = new Set(failures.map(f => f.userId))
      const posted = Object.fromEntries(plan.students
        .filter(s => s.after && !failed.has(s.userId))
        .map(s => [s.userId, { prof: s.after }]))
      const nextStored = await commitLabGrading(labId, sectionId, section, { record, keepDraft: failures.length > 0, posted })
      setStored(nextStored)
      setPendingDraft(null)
      await refreshScores()
      setConfirming(false)
      if (failures.length) {
        const names = failures.slice(0, 3).map(f => f.userName ?? 'a student').join(', ')
        toast(`${failures.length} of ${plan.students.length} didn't save (${names}${failures.length > 3 ? '…' : ''}). Your work is kept — commit again to retry. Details: Settings › Testing › Diagnostics`, 'warning')
      } else {
        const held = plan.summary.held
        toast(`Committed ${entry.name}${held ? `. ${held} student${held === 1 ? '' : 's'} changed in Canvas left as is` : ''}`, 'success')
      }
      onChanged?.()
    } catch (err) {
      toast(`Could not commit: ${err.message}`, 'error')
    } finally {
      setSaving(false)
      setProgress('')
    }
  }

  // What Canvas holds now, to spot scores changed there since the commit.
  async function loadRevertCheck() {
    const journalId = entry.journalAssignmentId
    const [profSubs, journalSubs] = await Promise.all([
      getAssignmentSubmissions(courseId, entry.professionalismAssignmentId),
      journalId ? getAssignmentSubmissions(courseId, journalId) : null,
    ])
    const toMap = subs => Object.fromEntries(subs.map(s => [s.userId, { score: s.score, excused: !!s.excused }]))
    return planRevert(stored.lastCommit.record, { prof: toMap(profSubs), journal: journalSubs ? toMap(journalSubs) : null })
  }

  async function openRevert() {
    setReverting(true)
    setRevertPreview(null)
    setOverwrite(new Set())
    try {
      setRevertPreview({ changed: (await loadRevertCheck()).changed })
    } catch (err) {
      setRevertPreview({ error: err.message })
    }
  }

  async function doRevert() {
    clearTimeout(autosaveTimer.current)
    setSaving(true)
    try {
      const names = Object.fromEntries(roster.map(r => [r.userId, r.userName]))
      // Re-check right before writing; skip changed students not set to Overwrite.
      const { changed } = await loadRevertCheck()
      const skip = new Set(changed.map(c => c.userId).filter(id => !overwrite.has(id)))
      const { failures } = await runRevert(stored.lastCommit.record, {
        courseId, entry, names, skip,
        onProgress: (done, total) => setProgress(`${done} of ${total} students restored…`),
      })
      const nextStored = await revertLabGrading(labId, sectionId, { skipped: skip })
      setStored(nextStored)
      // The reverted work is now a draft — offer it like any saved work.
      setSection(buildSection(roster, nextStored.committed, profState, standing))
      if (nextStored.draft) setPendingDraft(nextStored)
      await refreshScores()
      setReverting(false)
      if (failures.length) toast(`Reverted, but ${failures.length} student${failures.length === 1 ? '' : 's'} could not be restored. Details: Settings › Testing › Diagnostics`, 'warning')
      else toast(`Reverted the last commit for ${entry.name}${skip.size ? `, leaving ${skip.size} changed in Canvas as is` : ''}. Your grading is kept as a draft.`, 'success')
      onChanged?.()
    } catch (err) {
      toast(`Could not revert: ${err.message}`, 'error')
    } finally {
      setSaving(false)
      setProgress('')
    }
  }

  async function handleRevert() {
    await requirePin(
      { action: 'revert_lab_period', summary: `Revert the last commit for ${entry.name} in ${courseName}`, courseId, courseName },
      doRevert,
    )
  }

  async function handleCommit() {
    await requirePin(
      { action: 'commit_lab_period', summary: `Commit ${roster.length} student${roster.length === 1 ? '' : 's'} for ${entry.name} in ${courseName}`, courseId, courseName },
      doCommit,
    )
  }

  // Resolved flag config: the teacher's global list (or the built-in defaults
  // until they edit), split into the pickers' option lists plus an id->flag map
  // for labels/severity. MUST stay above the early returns below — a hook called
  // after a conditional return changes the per-render hook count and crashes the
  // component (this is what once blanked the Lab tab).
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
        actions={<Button onClick={onGoToLabs}>Go to Assignments</Button>}
      />
    )
  }

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
  const presentUnassigned = roster.filter(s => {
    const st = section.students[s.userId]
    return st?.present !== false && st?.kitchen == null
  })
  // The open period is already in front of the teacher; the warning lists the rest.
  const visibleDue = due.filter(d => !dismissed.has(`${d.labId}:${d.sectionId}`) && !(d.labId === labId && d.sectionId === sectionId))
  const counts = {
    present: roster.filter(s => section.students[s.userId]?.present !== false).length,
    absent: roster.filter(s => section.students[s.userId]?.present === false).length,
    unplaced: presentUnassigned.length,
  }
  const kitchenCount = highestKitchen(section)
  const kitchenNumbers = Array.from({ length: kitchenCount }, (_, i) => i + 1)
  const unassigned = roster.filter(s => section.students[s.userId]?.kitchen == null)

  return (
    <div className="space-y-6">
      {/* Working context: pick the lab + period ONCE; both persist across tabs. */}
      <Card className="space-y-3">
        <div className="max-w-xl">
          <div>
            <FieldLabel htmlFor="lab">Lab</FieldLabel>
            <Select id="lab" value={labId ?? ''} onChange={id => onSelect(id, '')}>
              <option value="">Select a lab</option>
              {newestFirst(entries).map(e => (
                <option key={e.id} value={e.id}>{labOptionLabel(e, sectionId)}</option>
              ))}
            </Select>
          </div>
        </div>

        {/* Periods as buttons, each showing whether it's committed. */}
        {labId && (
          <div>
            <p className="label mb-1.5">Period</p>
            {overridesLoading ? (
              <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
            ) : (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Period">
                {gradeableSections.map(s => {
                  const st = statuses[s.id]
                  const date = entry?.dates?.[s.id]
                  const overdue = st !== 'done' && date && date <= localToday()
                  const on = s.id === sectionId
                  return (
                    <button key={s.id} type="button" role="radio" aria-checked={on} onClick={() => onSelect(labId, s.id)}
                      className={`text-left px-3 py-1.5 rounded-[var(--radius-control)] border-2 min-w-[7.5rem] ${on
                        ? 'border-[var(--color-text-body)] bg-[var(--color-bg-hover)]'
                        : 'border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]'}`}>
                      <span className="block text-sm font-medium text-[var(--color-text-body)]">{s.name}</span>
                      <span className={`block text-xs ${st === 'done' ? 'text-[var(--color-success)]' : overdue ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-muted)]'}`}>
                        {st === 'done' ? `✓ Committed ${fmtWhen(committedAt[s.id])}`
                          : st === 'draft' ? '• Unsaved edits'
                            : date ? `Not started · ${fmtDay(date)}` : 'Not started'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Recent lab days with periods not committed yet. */}
      {visibleDue.length > 0 && (
        <Card className="border-2 border-[var(--color-warning)] space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-start gap-2 text-sm font-medium text-[var(--color-text-body)]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
              Not committed yet: {visibleDue.length} period{visibleDue.length === 1 ? '' : 's'} from recent lab days
            </p>
            <button type="button" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] underline shrink-0"
              onClick={() => setDismissed(prev => new Set([...prev, ...visibleDue.map(d => `${d.labId}:${d.sectionId}`)]))}>
              Hide until next launch
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {visibleDue.map(d => (
              <button key={`${d.labId}:${d.sectionId}`} type="button" onClick={() => onSelect(d.labId, d.sectionId)}
                className="text-left px-2.5 py-1 rounded-[var(--radius-control)] border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]">
                <span className="block text-sm text-[var(--color-text-body)]">{d.sectionName}</span>
                <span className="block text-xs text-[var(--color-text-muted)]">
                  {d.labName.replace(/\s*professionalism\s*$/i, '')} · {fmtDay(d.date)}{d.status === 'draft' ? ' · unsaved edits' : ''}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* What the open period's state means. */}
      {entry && sectionId && !rosterLoading && !pendingDraft && (statuses[sectionId] === 'done' || statuses[sectionId] === 'draft') && (
        <p className={`text-sm ${statuses[sectionId] === 'done' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}`}>
          {statuses[sectionId] === 'done'
            ? `✓ Committed ${fmtWhen(committedAt[sectionId])}. This is what Lab Tools sent to Canvas; change anything and commit again to update it.`
            : '• Unsaved edits on this device. Not in Canvas yet: commit to send them.'}
        </p>
      )}

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

      {!rosterLoading && loadError && (
        <EmptyState title="Couldn't load this period" body={loadError} actions={<Button onClick={() => setReloadTick(t => t + 1)}>Try again</Button>} />
      )}

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
                  <Chip tone="exceeded" active={exceeded} onClick={() => applySection(s => setKitchenExceeded(s, k, !exceeded))}>
                    Exceeded (4)
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
                      onToggle={id => applySection(s => toggleKitchenFlag(s, k, id))}
                    />
                    {kflags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {kflags.map(id => (
                          <Chip key={id} tone={kitchenTone(id)} active onClick={() => applySection(s => toggleKitchenFlag(s, k, id))} title="Remove">
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
                        flagsById={byId} individualFlags={individualFlagOptions} onApply={applySection} onAssignKitchen={assignKitchen} />
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
                    flagsById={byId} individualFlags={individualFlagOptions} onApply={applySection} onAssignKitchen={assignKitchen} />
                ))}
              </div>
            </Card>
          )}

          <p className="text-xs text-[var(--color-text-muted)]">
            Edits autosave on this device. Nothing posts to Canvas until you commit.{' '}
            {latestLab ? 'Kitchen placements carry over to this period’s next lab.' : 'This is an older lab: kitchen changes here stay with this lab.'}
          </p>

          {/* Sticky at the bottom of the screen: the period at a glance and Commit,
              without scrolling past all eight kitchens. */}
          <div className="sticky bottom-0 z-20 -mx-6 px-6 py-3 bg-[var(--color-bg-surface)] border-t-2 border-[var(--color-border-strong)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="flex-1 min-w-[12rem] text-sm text-[var(--color-text-body)]">
                <strong>{counts.present}</strong> present · <strong>{counts.absent}</strong> absent
                {counts.unplaced > 0 && <span className="text-[var(--color-warning)]"> · {counts.unplaced} not in a kitchen</span>}
                {statuses[sectionId] === 'done' && <span className="text-[var(--color-success)]"> · committed</span>}
                {statuses[sectionId] === 'draft' && <span className="text-[var(--color-text-muted)]"> · unsaved edits</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {stored?.lastCommit && (
                  <Button variant="ghost" size="sm" icon={Undo2} onClick={openRevert}>
                    Revert last commit ({fmtWhen(stored.lastCommit.at)})
                  </Button>
                )}
                <Button onClick={openPreview}>Commit Period…</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {confirming && (
        <Modal
          title="Review before committing"
          onClose={() => !saving && setConfirming(false)}
          footer={<>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCommit} disabled={saving || !preview?.plan || preview.plan.summary.writes === 0}>
              <span className="flex items-center gap-1.5">{saving && <Loader size={13} className="animate-spin" />}
                {preview?.plan ? `Commit ${preview.plan.summary.writes} change${preview.plan.summary.writes === 1 ? '' : 's'}` : 'Commit'}
              </span>
            </Button>
          </>}
        >
          <CommitPreview preview={preview} presentUnassigned={presentUnassigned.length} entry={entry} onToggleOverwrite={toggleOverwrite} />
          {saving && progress && <p className="text-xs text-[var(--color-text-muted)] mt-2">{progress}</p>}
        </Modal>
      )}

      {reverting && stored?.lastCommit && (
        <Modal
          title="Revert the last commit?"
          onClose={() => !saving && setReverting(false)}
          footer={<>
            <Button variant="secondary" onClick={() => setReverting(false)} disabled={saving}>Cancel</Button>
            <Button variant="danger" onClick={handleRevert} disabled={saving || !revertPreview || !!revertPreview.error}>
              <span className="flex items-center gap-1.5">{saving && <Loader size={13} className="animate-spin" />}Revert</span>
            </Button>
          </>}
        >
          <div className="text-sm text-[var(--color-text-secondary)] space-y-2">
            <p>
              This puts Canvas back the way it was before your commit at {fmtWhen(stored.lastCommit.at)} for{' '}
              {revertCount(stored)} student{revertCount(stored) === 1 ? '' : 's'}:
              scores and excused marks restored, comments it posted deleted, and journal locks it added removed (or ones it removed put back).
            </p>
            <p>Your grading from that commit comes back as a draft, so you can fix it and commit again.</p>
            {!revertPreview && <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Loader size={12} className="animate-spin" />Checking Canvas for changes since the commit…</p>}
            {revertPreview?.error && <p className="text-xs text-[var(--color-error)]">Couldn't check Canvas: {revertPreview.error}</p>}
            {revertPreview?.changed?.length > 0 && (
              <ChangedInCanvas
                students={revertPreview.changed.map(c => ({ ...c, userName: roster.find(r => r.userId === c.userId)?.userName, overwriting: overwrite.has(c.userId) }))}
                verb="revert"
                onToggle={id => setOverwrite(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })}
              />
            )}
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
function StudentRowBase({ student, section, score, kitchenCount, commentLibrary = [], maxScore = 4, flagsById = FLAG_BY_ID, individualFlags = [], onApply, onAssignKitchen }) {
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
            onClick={() => onApply(s => toggleStudentLibraryComment(s, student.userId, c))}
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
          onClick={() => onApply(s => setPresent(s, student.userId, absent))}>
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
              onClick={() => onApply(s => setStudentExceeded(s, student.userId, !st.exceeded))}
              title="Mark this student as exceeding expectations (a true 4)">Exceeds</Chip>
          )}
          {absent && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <input type="checkbox" checked={!!st.excused}
                onChange={() => onApply(s => ({ ...s, students: { ...s.students, [student.userId]: { ...s.students[student.userId], excused: !st.excused } } }))} />
              Excused
            </label>
          )}
          <Select
            value={st.kitchen == null ? '' : String(st.kitchen)}
            onChange={v => onAssignKitchen(student.userId, v === '' ? null : Number(v))}
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
              onToggle={id => onApply(s => toggleStudentFlag(s, student.userId, id))}
            />
          )}
          <div className="w-full md:flex-1 md:min-w-[14rem] flex items-center gap-1">
            <input
              type="text"
              value={st.comment ?? ''}
              onChange={e => onApply(s => setStudentComment(s, student.userId, e.target.value))}
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
            <Chip key={id} tone="individual" active onClick={() => onApply(s => toggleStudentFlag(s, student.userId, id))} title="Remove">
              {flagsById[id]?.label ?? id}{flagsById[id]?.severity === 'critical' ? ' · Major' : ''} ✕
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
            onChange={e => onApply(s => setStudentComment(s, student.userId, e.target.value))}
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
    && prev.onAssignKitchen === next.onAssignKitchen
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
                  {o.label}{o.scope === 'individual' && o.severity === 'critical' ? ' · Major' : ''}
                </Chip>
              )
            })}
          </div>
        </Modal>
      )}
    </>
  )
}

// "Nov 2 · Thickener Activity Professionalism": the date for this period when
// the lab has one, else its latest date, so the newest-first list reads at a glance.
function labOptionLabel(entry, sectionId) {
  const d = (sectionId && entry.dates?.[sectionId]) || Object.values(entry.dates ?? {}).filter(Boolean).sort().pop() || labDateFor(entry, null)
  const when = d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
  return `${when ? `${when} · ` : ''}${entry.name}${isStandalone(entry) ? ' (standalone)' : ''}`
}

// The kitchens to show: always 8, more only if a stored lab uses a higher one.
function highestKitchen(section) {
  let max = KITCHEN_COUNT
  for (const st of Object.values(section?.students ?? {})) {
    if (typeof st.kitchen === 'number' && st.kitchen > max) max = st.kitchen
  }
  for (const k of Object.keys(section?.kitchens ?? {})) {
    const n = Number(k)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

function fmtDay(ymd) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtWhen(iso) {
  if (!iso) return 'earlier'
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return 'earlier'
  }
}

// Canvas's state for each student's professionalism submission.
function profStateFrom(subs) {
  return Object.fromEntries(subs.map(s => [s.userId, { score: s.score, excused: !!s.excused, comments: s.comments ?? [] }]))
}

const revertCount = stored => Object.keys(stored?.lastCommit?.record?.students ?? {}).length

// The commit preview: exactly what will be sent, from the commit plan.
function CommitPreview({ preview, presentUnassigned, entry, onToggleOverwrite }) {
  if (!preview) {
    return <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><Loader size={14} className="animate-spin" />Checking Canvas…</p>
  }
  if (preview.error) {
    return <p className="text-sm text-[var(--color-error)]">Couldn't read Canvas to build the preview: {preview.error}</p>
  }
  const { students, summary } = preview.plan
  const scoreLine = Object.entries(summary.scoreCounts).sort((a, b) => Number(b[0]) - Number(a[0])).map(([v, n]) => `${v} ×${n}`).join(', ')
  const changing = students.filter(s => s.ops.length && !s.overwriting)
  const changedInCanvas = students.filter(s => s.outside.length)
  const statusText = s => s.status === 'excused' ? 'Excused (Canvas excused)'
    : s.status === 'absent' ? `Absent — 0${entry.journalAssignmentId ? ', journal locked' : ''}`
      : s.returning ? `${s.score} — back from absent (journal reopened)` : String(s.score)

  return (
    <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
      {summary.writes === 0 ? (
        <p className="text-[var(--color-text-body)]">
          {summary.held ? 'Nothing to send unless you choose Overwrite below.' : 'Canvas already matches this period — nothing to send.'}
        </p>
      ) : (
        <ul className="space-y-0.5 text-[var(--color-text-body)]">
          {summary.scoresPosted > 0 && <li><strong>{summary.scoresPosted}</strong> score{summary.scoresPosted === 1 ? '' : 's'}: {scoreLine}</li>}
          {summary.comments > 0 && <li><strong>{summary.comments}</strong> comment{summary.comments === 1 ? '' : 's'}</li>}
          {summary.absent > 0 && <li><strong>{summary.absent}</strong> absent (zero{entry.journalAssignmentId ? ', journal locked' : ''})</li>}
          {summary.excused > 0 && <li><strong>{summary.excused}</strong> excused (Canvas excused — doesn't count against the grade)</li>}
          {summary.returning > 0 && <li><strong>{summary.returning}</strong> back from absent (journal zero cleared, lock removed)</li>}
          {summary.unchanged > 0 && <li className="text-[var(--color-text-muted)]">{summary.unchanged} already up to date — skipped</li>}
        </ul>
      )}
      {changedInCanvas.length > 0 && (
        <ChangedInCanvas students={changedInCanvas} verb="commit" onToggle={onToggleOverwrite} />
      )}
      {summary.blocked > 0 && (
        <p className="flex items-start gap-1.5 text-[var(--color-error)]">
          <XCircle size={15} className="mt-0.5 shrink-0" />
          {summary.blocked} student{summary.blocked === 1 ? '' : 's'} won't be sent — a safety check caught a problem (see the list below).
        </p>
      )}
      {presentUnassigned > 0 && (
        <p className="flex items-start gap-1.5 text-[var(--color-warning)]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {presentUnassigned} present student{presentUnassigned === 1 ? '' : 's'} {presentUnassigned === 1 ? 'has' : 'have'} no kitchen — they score as a clean kitchen.
        </p>
      )}
      {changing.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[var(--color-text-body)]">See each student ({changing.length})</summary>
          <ul className="mt-2 max-h-72 overflow-y-auto divide-y divide-[var(--color-border-subtle)]">
            {changing.map(s => (
              <li key={s.userId} className="py-1.5">
                <div className="flex justify-between gap-3">
                  <span className="text-[var(--color-text-body)]">{s.userName}</span>
                  <span className={s.blocked ? 'text-[var(--color-error)]' : 'text-[var(--color-text-secondary)]'}>{statusText(s)}</span>
                </div>
                {s.comment && <p className="text-xs whitespace-pre-wrap text-[var(--color-text-muted)] mt-0.5">“{s.comment}”</p>}
                {s.checks.map(c => (
                  <p key={c.rule} className={`text-xs ${c.level === 'block' ? 'text-[var(--color-error)]' : 'text-[var(--color-warning)]'}`}>{c.level === 'block' ? 'Not sent' : 'Check'}: {c.message}</p>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p>This changes real grades in Canvas. You can revert this commit afterwards.</p>
    </div>
  )
}
