import { useState, useEffect, useMemo } from 'react'
import { Loader, Send, Copy, Check } from 'lucide-react'
import Card from '../../components/Card.jsx'
import Button from '../../components/Button.jsx'
import Callout from '../../components/Callout.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import Select from '../../components/Select.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import { Tabs, TabPanel } from '../../components/Tabs.jsx'
import { useToast } from '../../components/Toast.jsx'
import { usePinGate } from '../../security/usePinGate.jsx'
import { getAssignments, createAssignment } from '../../api/assignments.js'
import { getCourseSubmissions, updateSubmissionGrade } from '../../api/submissions.js'
import { getSections } from '../../api/sections.js'
import { getEnrollments } from '../../api/enrollments.js'
import { getModules } from '../../api/modules.js'
import { getCourseSetup, getLabs, getTerms } from '../../storage/setup.js'
import { scoreUnit, units as groupNames, columnText, fmt, isProfessionalismAssignment, isUnitScore } from './scoring.js'

function Confirm({ message, onConfirm, onCancel, busy, progress }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <Card padding="lg" className="max-w-sm w-full space-y-4">
        <p className="text-sm text-[var(--color-text-secondary)]">{message}</p>
        {busy && progress && <p className="text-xs text-[var(--color-text-muted)]">{progress}</p>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            <span className="flex items-center gap-1.5">
              {busy && <Loader size={13} className="animate-spin" />}
              Push Grades
            </span>
          </Button>
        </div>
      </Card>
    </div>
  )
}

// One rollup level (Unit-from-Labs or Term-from-Units): tabs across groups,
// a per-student score table, and a push-to-Canvas action per group. Both
// levels feed the same generic scoreUnit() — only what counts as an "item"
// and what the group names mean (Modules vs Terms) differs.
function RollupSection({
  label, items, assign, students, submissionsByStudent,
  courseId, courseName, postToSis, scoreAssignmentSuffix, existingAssignments, onAssignmentCreated,
}) {
  const toast = useToast()
  const { requirePin } = usePinGate()

  const groups = useMemo(() => groupNames(items, assign), [items, assign])
  const [active, setActive] = useState(null)
  const [section, setSection] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [pushing, setPushing] = useState(false)
  const [progress, setProgress] = useState('')
  const [copied, setCopied] = useState(false)
  const [showCopy, setShowCopy] = useState(false)
  const [withHeader, setWithHeader] = useState(true)

  useEffect(() => {
    if (groups.length && !groups.includes(active)) setActive(groups[0])
    if (!groups.length) setActive(null)
  }, [groups, active])

  const scored = active ? scoreUnit(students, items, assign, active, submissionsByStudent) : null
  const title = active ? `${active} ${scoreAssignmentSuffix}` : ''

  const availableSections = useMemo(() => [...new Set(students.map(s => s.sectionName).filter(Boolean))].sort(), [students])

  const rows = scored ? scored.results.map((r, i) => ({ student: students[i], r })) : []
  const visibleRows = section ? rows.filter(x => x.student.sectionName === section) : rows

  // Unit guard: a unit score must not post until every lab in the unit is graded.
  // "Not in yet" = a lab with no grades at all — detected as a lab for which no
  // student has a non-null score. Checking per-student blanks instead would
  // false-positive, because a student outside a section-scoped lab still has a
  // blank submission row. Term rollups have no such precondition.
  const incompleteLabs = useMemo(() => {
    if (label !== 'Unit' || !scored) return []
    return scored.labs
      .filter(lab => !students.some(st => {
        const sub = submissionsByStudent[st.userId]?.[lab.id]
        return sub && sub.score != null
      }))
      .map(l => l.name)
  }, [label, scored, students, submissionsByStudent])

  const summary = useMemo(() => {
    if (!scored) return ''
    const zeros = rows.filter(x => x.r.zero).length
    const dropped = rows.filter(x => x.r.dropped).length
    const blank = rows.filter(x => x.r.value === null).length
    const flagged = rows.filter(x => x.r.notes.some(n => n.includes('blank'))).length
    const parts = [
      `${scored.labs.length} item${scored.labs.length === 1 ? '' : 's'} in ${active}`,
      `${zeros} zero${zeros === 1 ? '' : 's'}`,
      `${dropped} with a lowest score dropped`,
    ]
    if (blank) parts.push(`${blank} left blank (no scores yet)`)
    if (flagged) parts.push(`${flagged} with a blank cell to check`)
    return parts.join('; ') + '.'
  }, [scored, rows, active])

  async function resolveTargetAssignment() {
    const existing = existingAssignments.find(a => a.name.trim().toLowerCase() === title.trim().toLowerCase())
    if (existing) return existing
    const created = await createAssignment(courseId, {
      name: title,
      pointsPossible: 4,
      gradingType: 'points',
      submissionTypes: ['none'],
      published: true,
      postToSis,
    })
    onAssignmentCreated?.(created)
    return created
  }

  async function doPush() {
    setPushing(true)
    let target
    try {
      target = await resolveTargetAssignment()
    } catch (err) {
      setPushing(false)
      toast(`Could not create/find "${title}": ${err.message}`, 'error')
      return
    }

    const toPush = rows.filter(x => x.r.value !== null)
    let done = 0, failed = 0
    for (const { student, r } of toPush) {
      try {
        await updateSubmissionGrade(courseId, target.id, student.userId, { posted_grade: String(r.value) })
      } catch {
        failed++
      }
      done++
      setProgress(`${done} of ${toPush.length} updated…`)
    }

    setPushing(false)
    setConfirm(null)
    setProgress('')
    if (failed) toast(`Pushed ${toPush.length - failed} of ${toPush.length} grades to "${title}" — ${failed} failed`, 'warning')
    else toast(`Pushed ${toPush.length} grade${toPush.length === 1 ? '' : 's'} to "${title}"`, 'success')
  }

  function openConfirm() {
    if (incompleteLabs.length) {
      toast(`Grade every lab in ${active} first. Not graded yet: ${incompleteLabs.join(', ')}.`, 'warning')
      return
    }
    const count = rows.filter(x => x.r.value !== null).length
    setConfirm({ message: `Push ${count} computed score${count === 1 ? '' : 's'} to "${title}" (out of 4)? This changes real grades in Canvas.` })
  }

  async function handlePush() {
    await requirePin(
      { action: 'push_scoring_grades', summary: `Push ${active} ${label.toLowerCase()} scores in ${courseName}`, courseId, courseName },
      doPush,
    )
  }

  const copyText = scored ? columnText(students, scored, title, withHeader) : ''

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Copy was blocked by the browser. Select the text manually.', 'warning')
    }
  }

  if (!groups.length) {
    return (
      <EmptyState
        title={`No ${label.toLowerCase()}s to score yet`}
        body={label === 'Unit'
          ? 'Assign Professionalism assignments to a Module in the Professionalism tab — each Module becomes a unit here.'
          : 'Group Modules into a Term in Setup — each Term becomes a rollup here.'}
      />
    )
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Tabs tabs={groups.map(g => ({ id: g, label: g }))} activeTab={active} onChange={setActive} />
        <div className="flex items-center gap-2">
          <FieldLabel htmlFor={`section-${label}`} className="mb-0">Section</FieldLabel>
          <Select
            id={`section-${label}`}
            value={section}
            onChange={setSection}
            options={[{ value: '', label: 'All sections' }, ...availableSections.map(s => ({ value: s, label: s }))]}
            className="w-40"
          />
        </div>
      </div>

      {groups.map(g => (
        <TabPanel key={g} tabId={g} activeTab={active}>
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-muted)]">{summary}</p>

            {incompleteLabs.length > 0 && (
              <Callout tone="warning">
                Not graded yet: {incompleteLabs.join(', ')}. Grade every lab in {active} before pushing the unit score.
              </Callout>
            )}

            <div className="flex items-center gap-3">
              <Button icon={Send} onClick={openConfirm} disabled={!rows.length || incompleteLabs.length > 0}>Push Grades to Canvas</Button>
              <Button variant="secondary" icon={Copy} onClick={() => setShowCopy(s => !s)}>
                {showCopy ? 'Hide spreadsheet column' : 'Copy as spreadsheet column instead'}
              </Button>
            </div>

            {showCopy && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={withHeader} onChange={e => setWithHeader(e.target.checked)} />
                  Include the title row
                </label>
                <textarea readOnly value={copyText} className="w-full min-h-[8rem] font-mono text-xs p-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-page)]" />
                <Button size="sm" variant="secondary" icon={copied ? Check : Copy} onClick={handleCopy}>{copied ? 'Copied' : 'Copy'}</Button>
              </div>
            )}

            <div className="border border-[var(--color-border)] rounded-[var(--radius-card)] overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                    <th className="px-3 py-2 font-medium">Student</th>
                    <th className="px-3 py-2 font-medium">Section</th>
                    <th className="px-3 py-2 font-medium text-right" style={{ background: 'var(--color-bg-hover)' }}>{title}</th>
                    {scored.labs.map(l => (
                      <th key={l.id} className="px-3 py-2 font-medium text-right whitespace-nowrap" title={l.name}>{l.name}</th>
                    ))}
                    <th className="px-3 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ student, r }) => (
                    <tr key={student.userId} className="border-b border-[var(--color-border-subtle)] last:border-0">
                      <td className="px-3 py-2">{student.userName}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{student.sectionName}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${r.zero ? 'text-[var(--color-error)]' : ''}`}>
                        {r.value === null ? '' : fmt(r.value)}
                      </td>
                      {scored.labs.map(l => {
                        const sub = submissionsByStudent[student.userId]?.[l.id]
                        const raw = sub && sub.score !== null && sub.score !== undefined ? sub.score : (sub?.excused ? 'EX' : '')
                        const isZero = sub && sub.score !== null && sub.score !== undefined && sub.score <= 0
                        const isDropped = r.dropped && r.dropped.from === l.name
                        return (
                          <td key={l.id} className={`px-3 py-2 text-right whitespace-nowrap ${isZero ? 'text-[var(--color-error)]' : ''} ${isDropped ? 'line-through text-[var(--color-text-muted)]' : ''}`}>
                            {raw}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-xs text-[var(--color-text-muted)] min-w-[12rem]">{r.notes.join('. ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabPanel>
      ))}

      {confirm && (
        <Confirm message={confirm.message} busy={pushing} progress={progress} onConfirm={handlePush} onCancel={() => !pushing && setConfirm(null)} />
      )}
    </Card>
  )
}

export default function ScoringPanel({ courseId, courseName, loadingCourse }) {
  const toast = useToast()
  const [assignments, setAssignments]   = useState([])
  const [students, setStudents]         = useState([])
  const [submissionsByStudent, setSubmissionsByStudent] = useState({})
  const [modules, setModules]           = useState([])
  const [entries, setEntries]         = useState([])
  const [terms, setTerms]               = useState([])
  const [courseSetup, setCourseSetup]   = useState(null)
  const [loading, setLoading]           = useState(false)

  useEffect(() => {
    if (!courseId) {
      setAssignments([]); setStudents([]); setSubmissionsByStudent({})
      setModules([]); setEntries([]); setTerms([]); setCourseSetup(null)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        // Everything except submissions loads in parallel. Submissions then load
        // scoped to just the professionalism + unit-score assignments Scoring
        // actually rolls up — not every submission in the course.
        const [asns, sections, enrollments, mods, entryList, termList, setup] = await Promise.all([
          getAssignments(courseId),
          getSections(courseId),
          getEnrollments(courseId),
          getModules(courseId),
          getLabs(courseId),
          getTerms(courseId),
          getCourseSetup(courseId),
        ])
        const relevantIds = asns.filter(a => isProfessionalismAssignment(a.name) || isUnitScore(a.name)).map(a => a.id)
        const subs = relevantIds.length ? await getCourseSubmissions(courseId, relevantIds) : []
        if (cancelled) return

        const sectionByStudent = {}
        for (const sec of sections) {
          for (const sid of sec.studentIds) sectionByStudent[sid] = sec.name
        }

        const byUser = new Map()
        for (const e of enrollments) {
          if (!byUser.has(e.userId)) byUser.set(e.userId, { userId: e.userId, userName: e.userName, sectionName: sectionByStudent[e.userId] ?? '' })
        }
        const studentList = [...byUser.values()].sort((a, b) => (a.userName ?? '').localeCompare(b.userName ?? ''))

        const byStudent = {}
        for (const s of subs) {
          if (!byStudent[s.userId]) byStudent[s.userId] = {}
          byStudent[s.userId][s.assignmentId] = { score: s.score, excused: s.excused }
        }

        setAssignments(asns)
        setStudents(studentList)
        setSubmissionsByStudent(byStudent)
        setModules(mods)
        setEntries(entryList)
        setTerms(termList)
        setCourseSetup(setup)
      } catch (err) {
        if (!cancelled) toast(`Could not load scoring data: ${err.message}`, 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [courseId])

  const professionalismAssignments = useMemo(() => assignments.filter(a => isProfessionalismAssignment(a.name)), [assignments])
  const unitScoreAssignments = useMemo(() => assignments.filter(a => isUnitScore(a.name)), [assignments])

  const moduleNameById = useMemo(() => Object.fromEntries(modules.map(m => [m.id, m.name])), [modules])
  const entriesByAssignmentId = useMemo(() => Object.fromEntries(entries.map(p => [p.professionalismAssignmentId, p])), [entries])

  // Every professionalism assignment's "unit" is whichever Module it was
  // assigned to back in the Professionalism tab (entry.moduleId) — not a
  // free-typed label. A professionalism assignment with no Module assignment
  // (or no local record at all) lands in "Unassigned" so it's still
  // visible rather than silently dropped.
  const unitAssign = useMemo(() => {
    const map = {}
    for (const a of professionalismAssignments) {
      const entry = entriesByAssignmentId[a.id]
      map[a.id] = (entry?.moduleId && moduleNameById[entry.moduleId]) || 'Unassigned'
    }
    return map
  }, [professionalismAssignments, entriesByAssignmentId, moduleNameById])

  const unassignedCount = useMemo(
    () => professionalismAssignments.filter(a => unitAssign[a.id] === 'Unassigned').length,
    [professionalismAssignments, unitAssign],
  )

  // Each Term's "units" are whichever of its member Modules already have a
  // "<Module> Professionalism (Unit Score)" assignment in Canvas — found by
  // exact name, same as the push-target lookup, rather than cached locally.
  const termAssign = useMemo(() => {
    const map = {}
    for (const term of terms) {
      const expectedNames = new Set(
        term.moduleIds.map(mid => `${moduleNameById[mid]} Professionalism (Unit Score)`.toLowerCase()),
      )
      for (const a of unitScoreAssignments) {
        if (expectedNames.has(a.name.trim().toLowerCase())) map[a.id] = term.name
      }
    }
    return map
  }, [terms, moduleNameById, unitScoreAssignments])

  function handleAssignmentCreated(created) {
    setAssignments(prev => [...prev, created])
  }

  if (loading || loadingCourse) {
    return <div className="space-y-3"><Skeleton height="1.5rem" width="16rem" /><Skeleton height="8rem" /></div>
  }

  if (!courseId) {
    return <EmptyState title="Select a course" body="Choose a course above to score Professionalism assignments." />
  }

  if (!professionalismAssignments.length) {
    return (
      <EmptyState
        title="No professionalism assignments found"
        body='No assignment in this course has "professionalism" in its name. Create one in the Professionalism tab first.'
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-body)]">Scoring</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Unit scores roll up each Module's labs; Term scores roll up the Modules in each Term (set those up in Setup).
        </p>
      </div>

      {unassignedCount > 0 && (
        <Callout tone="warning">
          {unassignedCount} Professionalism assignment{unassignedCount === 1 ? '' : 's'} with no Module assigned — go to the Professionalism tab to assign
          {unassignedCount === 1 ? ' it' : ' them'}, or it{unassignedCount === 1 ? '' : "'ll"} only show up under "Unassigned" here.
        </Callout>
      )}

      <div>
        <h2 className="text-base font-semibold text-[var(--color-text-body)] mb-3">By Unit (Module)</h2>
        <RollupSection
          label="Unit"
          items={professionalismAssignments}
          assign={unitAssign}
          students={students}
          submissionsByStudent={submissionsByStudent}
          courseId={courseId}
          courseName={courseName}
          postToSis={courseSetup?.settings?.syncUnitTermToFocus}
          scoreAssignmentSuffix="Professionalism (Unit Score)"
          existingAssignments={assignments}
          onAssignmentCreated={handleAssignmentCreated}
        />
      </div>

      <div>
        <h2 className="text-base font-semibold text-[var(--color-text-body)] mb-3">By Term</h2>
        <RollupSection
          label="Term"
          items={unitScoreAssignments}
          assign={termAssign}
          students={students}
          submissionsByStudent={submissionsByStudent}
          courseId={courseId}
          courseName={courseName}
          postToSis={courseSetup?.settings?.syncUnitTermToFocus}
          scoreAssignmentSuffix="Professionalism (Term Score)"
          existingAssignments={assignments}
          onAssignmentCreated={handleAssignmentCreated}
        />
      </div>
    </div>
  )
}
