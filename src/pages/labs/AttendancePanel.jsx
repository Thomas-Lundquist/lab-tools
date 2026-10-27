import { useState, useEffect } from 'react'
import { UserX, UserCheck, Loader } from 'lucide-react'
import Card from '../../components/Card.jsx'
import Button from '../../components/Button.jsx'
import Select from '../../components/Select.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import Modal from '../../components/Modal.jsx'
import { useToast } from '../../components/Toast.jsx'
import { usePinGate } from '../../security/usePinGate.jsx'
import { getSections } from '../../api/sections.js'
import { getEnrollments } from '../../api/enrollments.js'
import { getAssignmentSubmissions, updateSubmissionGrade } from '../../api/submissions.js'
import { createOverride, findStudentOverride, deleteOverride, getOverrides } from '../../api/overrides.js'
import { getCourseSetup, getLabs, isStandalone } from '../../storage/setup.js'

// A student's professionalism score of exactly 0 is what this tool writes for
// an absence — so "currently 0" doubles as both "already marked absent" (no
// extra local bookkeeping needed) and the safety check Mark Present uses
// before clearing anything a teacher may have since entered by hand. Scoring
// present students lives in the Score tab; this tab is presence only.
const WRITTEN_ZERO = 0

export default function AttendancePanel({ courseId, courseName, loadingCourse, ready, setupVersion, onGoToSetup, onGoToLabs }) {
  const toast = useToast()
  const { requirePin } = usePinGate()

  const [loading, setLoading]         = useState(false)
  const [entries, setEntries]       = useState([])
  const [sections, setSections]       = useState([])
  const [courseSetup, setCourseSetup] = useState(null)
  const [entryId, setEntryId]     = useState('')
  const [sectionId, setSectionId]     = useState('')
  const [profOverrides, setProfOverrides] = useState(null)   // section overrides on the chosen entry; null = not loaded

  const [rosterLoading, setRosterLoading] = useState(false)
  const [roster, setRoster]           = useState([])        // [{ userId, userName }]
  const [profScores, setProfScores]   = useState({})        // userId -> score|null
  const [journalScores, setJournalScores] = useState({})    // userId -> score|null
  const [marks, setMarks]             = useState({})        // userId -> { excused } — newly-marked absent this session
  const [confirming, setConfirming]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [progress, setProgress]       = useState('')
  const [undoing, setUndoing]         = useState(null)       // userId currently being undone

  useEffect(() => {
    if (!courseId) { setEntries([]); setSections([]); setCourseSetup(null); return }
    setLoading(true)
    Promise.all([getLabs(courseId), getSections(courseId), getCourseSetup(courseId)])
      .then(([fetchedEntries, secs, setup]) => {
        setEntries(fetchedEntries)
        setSections(secs)
        setCourseSetup(setup)
      })
      .finally(() => setLoading(false))
  }, [courseId, setupVersion])

  useEffect(() => { setEntryId(''); setSectionId('') }, [courseId])

  const entry = entries.find(p => p.id === entryId) ?? null

  // Which sections actually have this lab assigned — read live from Canvas, not
  // the tool's stored dates (which "Add a section" doesn't update). A section
  // with an override has a date set; those are the only ones worth grading.
  useEffect(() => {
    if (!entry) { setProfOverrides(null); return }
    let cancelled = false
    getOverrides(courseId, entry.professionalismAssignmentId)
      .then(o => { if (!cancelled) setProfOverrides(o) })
      .catch(() => { if (!cancelled) setProfOverrides([]) })
    return () => { cancelled = true }
  }, [entry, courseId])

  // If the loaded overrides reveal the picked section isn't one this lab is
  // assigned to, drop it so the teacher re-picks from the filtered list.
  useEffect(() => {
    if (!sectionId || !profOverrides) return
    const ids = new Set(profOverrides.filter(o => o.courseSectionId).map(o => o.courseSectionId))
    if (ids.size > 0 && !ids.has(sectionId)) setSectionId('')
  }, [profOverrides, sectionId])

  useEffect(() => {
    setMarks({})
    if (!entry || !sectionId) { setRoster([]); setProfScores({}); setJournalScores({}); return }
    setRosterLoading(true)
    Promise.all([
      getEnrollments(courseId),
      getAssignmentSubmissions(courseId, entry.professionalismAssignmentId),
      entry.journalAssignmentId ? getAssignmentSubmissions(courseId, entry.journalAssignmentId) : Promise.resolve([]),
    ])
      .then(([enrollments, profSubs, journalSubs]) => {
        const section = sections.find(s => s.id === sectionId)
        const idsInSection = new Set(section?.studentIds ?? [])
        const inSection = enrollments.filter(e => idsInSection.has(e.userId))
        inSection.sort((a, b) => (a.userSortableName ?? '').localeCompare(b.userSortableName ?? ''))
        setRoster(inSection.map(e => ({ userId: e.userId, userName: e.userName })))
        setProfScores(Object.fromEntries(profSubs.map(s => [s.userId, s.score])))
        setJournalScores(Object.fromEntries(journalSubs.map(s => [s.userId, s.score])))
      })
      .finally(() => setRosterLoading(false))
  }, [entry, sectionId, courseId, sections])

  function toggleAbsent(userId) {
    setMarks(prev => {
      if (prev[userId]) {
        const next = { ...prev }
        delete next[userId]
        return next
      }
      return { ...prev, [userId]: { excused: false } }
    })
  }

  function toggleExcused(userId) {
    setMarks(prev => ({ ...prev, [userId]: { ...prev[userId], excused: !prev[userId]?.excused } }))
  }

  const newlyAbsentCount = Object.keys(marks).length

  async function refreshScores() {
    const [profSubs, journalSubs] = await Promise.all([
      getAssignmentSubmissions(courseId, entry.professionalismAssignmentId),
      entry.journalAssignmentId ? getAssignmentSubmissions(courseId, entry.journalAssignmentId) : Promise.resolve([]),
    ])
    setProfScores(Object.fromEntries(profSubs.map(s => [s.userId, s.score])))
    setJournalScores(Object.fromEntries(journalSubs.map(s => [s.userId, s.score])))
  }

  async function doConfirm() {
    setSaving(true)
    const absentEntries = Object.entries(marks)
    const total = absentEntries.length
    let done = 0, failed = 0

    for (const [userId, { excused }] of absentEntries) {
      try {
        await updateSubmissionGrade(courseId, entry.professionalismAssignmentId, userId, {
          posted_grade: '0',
          ...(excused ? { text_comment: 'Excused absence — zero until the lab makeup is graded.' } : {}),
        })

        if (entry.journalAssignmentId && courseSetup.settings.zeroJournalWhenAbsent) {
          await updateSubmissionGrade(courseId, entry.journalAssignmentId, userId, { posted_grade: '0' })
        }

        if (entry.journalAssignmentId) {
          const student = roster.find(r => r.userId === userId)
          await createOverride(courseId, entry.journalAssignmentId, {
            studentIds: [userId],
            lockAt: new Date().toISOString(),
            title: `${student?.userName ?? 'Student'} — absent lock`,
          })
        }
      } catch {
        failed++
      }
      done++
      setProgress(`${done} of ${total} updated…`)
    }

    await refreshScores()

    setSaving(false)
    setConfirming(false)
    setProgress('')
    setMarks({})

    if (failed) toast(`Saved ${total - failed} of ${total} updates — ${failed} failed`, 'warning')
    else toast(`Saved ${total} update${total === 1 ? '' : 's'}`, 'success')
  }

  async function handleConfirm() {
    await requirePin(
      { action: 'mark_lab_attendance', summary: `${newlyAbsentCount} absent for ${entry.name} in ${courseName}`, courseId, courseName },
      doConfirm,
    )
  }

  async function handleMarkPresent(userId) {
    setUndoing(userId)
    try {
      const currentProf = profScores[userId]
      if (currentProf === WRITTEN_ZERO) {
        await updateSubmissionGrade(courseId, entry.professionalismAssignmentId, userId, { posted_grade: '' })
      }
      const currentJournal = journalScores[userId]
      if (entry.journalAssignmentId && currentJournal === WRITTEN_ZERO) {
        await updateSubmissionGrade(courseId, entry.journalAssignmentId, userId, { posted_grade: '' })
      }
      if (entry.journalAssignmentId) {
        const override = await findStudentOverride(courseId, entry.journalAssignmentId, userId)
        if (override) await deleteOverride(courseId, entry.journalAssignmentId, override.id)
      }
      setProfScores(prev => ({ ...prev, [userId]: currentProf === WRITTEN_ZERO ? null : currentProf }))
      setJournalScores(prev => ({ ...prev, [userId]: currentJournal === WRITTEN_ZERO ? null : currentJournal }))
      toast('Marked present', 'success')
    } catch (err) {
      toast(`Could not undo: ${err.message}`, 'error')
    } finally {
      setUndoing(null)
    }
  }

  if (loading || loadingCourse) {
    return <div className="space-y-3"><Skeleton height="4rem" /><Skeleton height="16rem" /></div>
  }

  if (!courseId) return <EmptyState title="Select a course" body="Choose a course above to take attendance." />

  if (!ready) {
    return (
      <EmptyState
        title="Finish setup first"
        body="Enable this course and create the Professionalism assignment group before taking attendance."
        actions={<Button onClick={onGoToSetup}>Set Up Course</Button>}
      />
    )
  }

  const pairedEntries = entries.filter(e => !isStandalone(e))
  const standaloneEntries = entries.filter(isStandalone)

  // Sections this lab is actually assigned to. If it has per-section overrides,
  // show only those; if it has none (an all-sections, no-date assignment), fall
  // back to every section so the teacher is never blocked.
  const overrideSectionIds = profOverrides
    ? new Set(profOverrides.filter(o => o.courseSectionId).map(o => o.courseSectionId))
    : null
  const gradeableSections = overrideSectionIds && overrideSectionIds.size > 0
    ? sections.filter(s => overrideSectionIds.has(s.id))
    : sections
  const overridesLoading = !!entry && profOverrides === null
  const filteringSections = gradeableSections.length < sections.length

  if (!entries.length) {
    return (
      <EmptyState
        title="Nothing to take attendance for yet"
        body="Create a Professionalism assignment first — a pairing with a lab journal, or a standalone."
        actions={<Button onClick={onGoToLabs}>Go to Professionalism</Button>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
          <div>
            <FieldLabel htmlFor="entry">Pairing or standalone</FieldLabel>
            <Select id="entry" value={entryId} onChange={id => { setEntryId(id); setSectionId('') }}>
              <option value="">Select one</option>
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
          <div>
            <FieldLabel htmlFor="section">Section</FieldLabel>
            <Select id="section" value={sectionId} onChange={setSectionId} disabled={!entryId || overridesLoading}
              options={[
                { value: '', label: overridesLoading ? 'Loading sections…' : 'Select a section' },
                ...gradeableSections.map(s => ({ value: s.id, label: s.name })),
              ]} />
            {filteringSections && (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Only sections this lab is assigned to are shown.
              </p>
            )}
          </div>
        </div>
        {entry && isStandalone(entry) && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Standalone — no journal to lock. Marking a student absent only zeros Professionalism.
          </p>
        )}
      </Card>

      {rosterLoading && <Skeleton height="16rem" />}

      {!rosterLoading && entry && sectionId && (
        <Card padding="none" className="overflow-hidden">
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {roster.map(student => {
              const alreadyAbsent = profScores[student.userId] === WRITTEN_ZERO
              const mark = marks[student.userId]
              return (
                <div key={student.userId} className={`flex items-center justify-between gap-3 px-4 py-3 ${alreadyAbsent ? 'bg-[var(--color-bg-hover)]' : ''}`}>
                  <span className={`text-sm font-medium ${alreadyAbsent ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-body)]'}`}>{student.userName}</span>
                  {alreadyAbsent ? (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--color-error)]">Absent — 0</span>
                      <Button size="sm" variant="secondary" icon={UserCheck} onClick={() => handleMarkPresent(student.userId)} disabled={undoing === student.userId}>
                        {undoing === student.userId ? 'Undoing…' : 'Mark Present'}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      {mark && (
                        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                          <input type="checkbox" checked={!!mark.excused} onChange={() => toggleExcused(student.userId)} />
                          Excused
                        </label>
                      )}
                      <Button
                        size="sm"
                        variant={mark ? 'danger' : 'success'}
                        icon={mark ? UserX : UserCheck}
                        onClick={() => toggleAbsent(student.userId)}
                      >
                        {mark ? 'Absent' : 'Present'}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
            {roster.length === 0 && <p className="text-sm text-[var(--color-text-muted)] px-4 py-6 text-center">No students in this section.</p>}
          </div>
        </Card>
      )}

      {!rosterLoading && entry && sectionId && roster.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => setConfirming(true)} disabled={!newlyAbsentCount}>
            Mark {newlyAbsentCount || ''} Absent
          </Button>
        </div>
      )}

      {confirming && (
        <Modal
          title="Confirm attendance"
          onClose={() => !saving && setConfirming(false)}
          footer={<>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={saving}>
              <span className="flex items-center gap-1.5">
                {saving && <Loader size={13} className="animate-spin" />}
                Confirm
              </span>
            </Button>
          </>}
        >
          <div className="text-sm text-[var(--color-text-secondary)] space-y-2">
            {newlyAbsentCount > 0 && (
              <p>
                Mark {newlyAbsentCount} student{newlyAbsentCount === 1 ? '' : 's'} absent for &quot;{entry.name}&quot;? This sets their professionalism score
                to 0{entry.journalAssignmentId ? ', locks the journal so they can’t take it, and zeros the journal grade if that setting is on.' : '.'}
              </p>
            )}
            <p>This changes real grades in Canvas.</p>
          </div>
          {saving && progress && <p className="text-xs text-[var(--color-text-muted)] mt-2">{progress}</p>}
        </Modal>
      )}
    </div>
  )
}
