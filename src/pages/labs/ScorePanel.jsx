import { useState, useEffect } from 'react'
import { Loader } from 'lucide-react'
import Card from '../../components/Card.jsx'
import Button from '../../components/Button.jsx'
import Select from '../../components/Select.jsx'
import TextField from '../../components/TextField.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import Modal from '../../components/Modal.jsx'
import { useToast } from '../../components/Toast.jsx'
import { usePinGate } from '../../security/usePinGate.jsx'
import { getSections } from '../../api/sections.js'
import { getEnrollments } from '../../api/enrollments.js'
import { getAssignmentSubmissions, updateSubmissionGrade } from '../../api/submissions.js'
import { getOverrides } from '../../api/overrides.js'
import { getCourseSetup, getLabs, isStandalone } from '../../storage/setup.js'
import { scoreFromDeductions } from './scoring.js'

// Absence convention: a professionalism score of exactly 0 is what Attendance
// writes for an absent student. Those rows are read-only here.
const WRITTEN_ZERO = 0

// Joins the three comment sources into one Canvas submission comment.
function buildComment({ deductions, libraryComments, additional }) {
  return [...deductions, ...libraryComments, additional.trim()].filter(Boolean).join('\n')
}

// A small toggle chip. `tone` colors the active state — 'deduct' (it lowers the
// score) vs 'note' (comment only).
function Chip({ active, tone = 'note', onClick, children }) {
  const activeClass = tone === 'deduct'
    ? 'border-[var(--color-danger-fill)] text-white bg-[var(--color-danger-fill)]'
    : 'border-[var(--color-info)] text-white bg-[var(--color-info)]'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-2 py-0.5 rounded-full border text-xs transition-colors duration-75 ${
        active ? activeClass : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
      }`}
    >
      {children}
    </button>
  )
}

export default function ScorePanel({ courseId, courseName, loadingCourse, ready, setupVersion, onGoToSetup, onGoToLabs }) {
  const toast = useToast()
  const { requirePin } = usePinGate()

  const [loading, setLoading]         = useState(false)
  const [entries, setEntries]         = useState([])
  const [sections, setSections]       = useState([])
  const [courseSetup, setCourseSetup] = useState(null)
  const [entryId, setEntryId]         = useState('')
  const [sectionId, setSectionId]     = useState('')
  const [profOverrides, setProfOverrides] = useState(null)

  const [rosterLoading, setRosterLoading] = useState(false)
  const [roster, setRoster]           = useState([])     // [{ userId, userName }]
  const [profScores, setProfScores]   = useState({})     // userId -> score|null (current Canvas score)
  const [rows, setRows]               = useState({})     // userId -> { deductions, libraryComments, additional, score, scoreTouched }
  const [confirming, setConfirming]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [progress, setProgress]       = useState('')

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

  useEffect(() => {
    if (!entry) { setProfOverrides(null); return }
    let cancelled = false
    getOverrides(courseId, entry.professionalismAssignmentId)
      .then(o => { if (!cancelled) setProfOverrides(o) })
      .catch(() => { if (!cancelled) setProfOverrides([]) })
    return () => { cancelled = true }
  }, [entry, courseId])

  useEffect(() => {
    if (!sectionId || !profOverrides) return
    const ids = new Set(profOverrides.filter(o => o.courseSectionId).map(o => o.courseSectionId))
    if (ids.size > 0 && !ids.has(sectionId)) setSectionId('')
  }, [profOverrides, sectionId])

  const deductionOpts = {
    pointsPerStep: courseSetup?.settings?.deductionPointsPerStep ?? 1,
    marksPerStep: courseSetup?.settings?.deductionMarksPerStep ?? 2,
  }
  const reasons = courseSetup?.settings?.deductionReasons ?? []
  const library = courseSetup?.settings?.commentLibrary ?? []
  const fullMarks = scoreFromDeductions(0, deductionOpts)

  // Load the roster + current scores, and seed one editable row per student.
  useEffect(() => {
    if (!entry || !sectionId) { setRoster([]); setProfScores({}); setRows({}); return }
    setRosterLoading(true)
    Promise.all([
      getEnrollments(courseId),
      getAssignmentSubmissions(courseId, entry.professionalismAssignmentId),
    ])
      .then(([enrollments, profSubs]) => {
        const section = sections.find(s => s.id === sectionId)
        const idsInSection = new Set(section?.studentIds ?? [])
        const inSection = enrollments.filter(e => idsInSection.has(e.userId))
        inSection.sort((a, b) => (a.userSortableName ?? '').localeCompare(b.userSortableName ?? ''))
        setRoster(inSection.map(e => ({ userId: e.userId, userName: e.userName })))
        setProfScores(Object.fromEntries(profSubs.map(s => [s.userId, s.score])))
        const seeded = {}
        for (const e of inSection) seeded[e.userId] = { deductions: [], libraryComments: [], additional: '', score: String(fullMarks), scoreTouched: false }
        setRows(seeded)
      })
      .finally(() => setRosterLoading(false))
  }, [entry, sectionId, courseId, sections])

  function updateRow(userId, patch) {
    setRows(prev => ({ ...prev, [userId]: { ...prev[userId], ...patch } }))
  }

  function toggleDeduction(userId, reason) {
    setRows(prev => {
      const row = prev[userId]
      const deductions = row.deductions.includes(reason) ? row.deductions.filter(r => r !== reason) : [...row.deductions, reason]
      const score = row.scoreTouched ? row.score : String(scoreFromDeductions(deductions.length, deductionOpts))
      return { ...prev, [userId]: { ...row, deductions, score } }
    })
  }

  function toggleLibrary(userId, comment) {
    setRows(prev => {
      const row = prev[userId]
      const libraryComments = row.libraryComments.includes(comment) ? row.libraryComments.filter(c => c !== comment) : [...row.libraryComments, comment]
      return { ...prev, [userId]: { ...row, libraryComments } }
    })
  }

  // Present = not already marked absent (score 0). Those are the rows we push.
  const presentStudents = roster.filter(s => profScores[s.userId] !== WRITTEN_ZERO)

  async function refreshScores() {
    const profSubs = await getAssignmentSubmissions(courseId, entry.professionalismAssignmentId)
    setProfScores(Object.fromEntries(profSubs.map(s => [s.userId, s.score])))
  }

  async function doConfirm() {
    setSaving(true)
    let done = 0, failed = 0
    for (const student of presentStudents) {
      const row = rows[student.userId]
      const score = Math.max(0, Math.min(fullMarks, Number.isFinite(parseFloat(row.score)) ? parseFloat(row.score) : 0))
      const comment = buildComment(row)
      try {
        await updateSubmissionGrade(courseId, entry.professionalismAssignmentId, student.userId, {
          posted_grade: String(score),
          ...(comment ? { text_comment: comment } : {}),
        })
      } catch {
        failed++
      }
      done++
      setProgress(`${done} of ${presentStudents.length} saved…`)
    }
    await refreshScores()
    setSaving(false)
    setConfirming(false)
    setProgress('')
    if (failed) toast(`Saved ${presentStudents.length - failed} of ${presentStudents.length} — ${failed} failed`, 'warning')
    else toast(`Saved ${presentStudents.length} score${presentStudents.length === 1 ? '' : 's'}`, 'success')
  }

  async function handleConfirm() {
    await requirePin(
      { action: 'score_professionalism', summary: `Score ${presentStudents.length} present student${presentStudents.length === 1 ? '' : 's'} for ${entry.name} in ${courseName}`, courseId, courseName },
      doConfirm,
    )
  }

  if (loading || loadingCourse) {
    return <div className="space-y-3"><Skeleton height="4rem" /><Skeleton height="16rem" /></div>
  }

  if (!courseId) return <EmptyState title="Select a course" body="Choose a course above to score present students." />

  if (!ready) {
    return (
      <EmptyState
        title="Finish setup first"
        body="Enable this course and create the Professionalism assignment group before scoring."
        actions={<Button onClick={onGoToSetup}>Set Up Course</Button>}
      />
    )
  }

  if (!entries.length) {
    return (
      <EmptyState
        title="Nothing to score yet"
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
  const filteringSections = gradeableSections.length < sections.length

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
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">Only sections this lab is assigned to are shown.</p>
            )}
          </div>
        </div>
        {entry && sectionId && !rosterLoading && roster.length > 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Everyone defaults to {fullMarks}/4. Toggle deductions to lower a score, add comments, or type a score directly. Absent students are scored in Attendance.
          </p>
        )}
      </Card>

      {rosterLoading && <Skeleton height="16rem" />}

      {!rosterLoading && entry && sectionId && (
        <Card padding="none" className="overflow-hidden">
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {roster.map(student => {
              const absent = profScores[student.userId] === WRITTEN_ZERO
              const row = rows[student.userId]
              if (absent || !row) {
                return (
                  <div key={student.userId} className="flex items-center justify-between gap-3 px-4 py-2 bg-[var(--color-bg-hover)]">
                    <span className="text-sm font-medium text-[var(--color-text-muted)]">{student.userName}</span>
                    <span className="text-xs text-[var(--color-error)]">Absent — scored in Attendance</span>
                  </div>
                )
              }
              return (
                <div key={student.userId} className="flex items-start gap-3 px-4 py-2 flex-wrap">
                  <span className="w-40 shrink-0 text-sm font-medium text-[var(--color-text-body)] pt-1">{student.userName}</span>
                  <div className="flex flex-wrap gap-1 items-center">
                    {reasons.map(r => (
                      <Chip key={r} tone="deduct" active={row.deductions.includes(r)} onClick={() => toggleDeduction(student.userId, r)}>{r}</Chip>
                    ))}
                  </div>
                  {library.length > 0 && (
                    <div className="flex flex-wrap gap-1 items-center">
                      {library.map(c => (
                        <Chip key={c} tone="note" active={row.libraryComments.includes(c)} onClick={() => toggleLibrary(student.userId, c)}>{c}</Chip>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    value={row.additional}
                    onChange={e => updateRow(student.userId, { additional: e.target.value })}
                    placeholder="Comment"
                    aria-label={`Additional comment for ${student.userName}`}
                    className="flex-1 min-w-[8rem] text-sm px-2 py-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-page)]"
                  />
                  <TextField
                    type="number"
                    value={row.score}
                    onChange={v => updateRow(student.userId, { score: v, scoreTouched: true })}
                    className="w-16"
                    aria-label={`Score for ${student.userName}`}
                  />
                </div>
              )
            })}
            {roster.length === 0 && <p className="text-sm text-[var(--color-text-muted)] px-4 py-6 text-center">No students in this section.</p>}
          </div>
        </Card>
      )}

      {!rosterLoading && entry && sectionId && presentStudents.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => setConfirming(true)}>Push {presentStudents.length} Score{presentStudents.length === 1 ? '' : 's'}</Button>
        </div>
      )}

      {confirming && (
        <Modal
          title="Confirm scores"
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
            <p>Push a professionalism score for {presentStudents.length} present student{presentStudents.length === 1 ? '' : 's'} on &quot;{entry.name}&quot;? Comments post to each submission.</p>
            <p>This changes real grades in Canvas.</p>
          </div>
          {saving && progress && <p className="text-xs text-[var(--color-text-muted)] mt-2">{progress}</p>}
        </Modal>
      )}
    </div>
  )
}
