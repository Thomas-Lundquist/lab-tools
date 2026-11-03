import { useState, useEffect, useMemo, useCallback } from 'react'
import { Loader, Send, Copy, Check, Undo2, ChevronDown, ChevronRight, X, Pencil } from 'lucide-react'
import Card from '../../components/Card.jsx'
import Button from '../../components/Button.jsx'
import Callout from '../../components/Callout.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import Select from '../../components/Select.jsx'
import TextField from '../../components/TextField.jsx'
import Modal from '../../components/Modal.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import ChangedInCanvas from '../../components/ChangedInCanvas.jsx'
import { useToast } from '../../components/Toast.jsx'
import { usePinGate } from '../../security/usePinGate.jsx'
import { getAssignments, createAssignment } from '../../api/assignments.js'
import { getCourseSubmissions, getAssignmentSubmissions } from '../../api/submissions.js'
import { getSections } from '../../api/sections.js'
import { getEnrollments } from '../../api/enrollments.js'
import { getModules, ensureModuleItem } from '../../api/modules.js'
import { getCourseSetup, getLabs, getTerms, saveTerm, deleteTerm } from '../../storage/setup.js'
import { getRollups, recordPush, recordPushRevert } from '../../storage/rollups.js'
import { scoreGroup, columnText, fmt, isProfessionalismAssignment, isScoreAssignment } from './scoring.js'
import { planPush, groupStatus, planPushRevert, runPush, runPushRevert, postedAfterPush } from './rollupPush.js'

// Scoring tab: Unit scores (each Module's labs) and Term scores (every lab in
// the Term's Modules), both a plain average with nothing dropped (scoring.js).
// Each Unit/Term shows whether Canvas is up to date, and pushes the way Commit
// Period does: a preview of exactly what changes, scores changed in Canvas
// held unless overwritten, and Revert for the last push (rollupPush.js).

const UNIT_SUFFIX = 'Professionalism (Unit Score)'
const TERM_SUFFIX = 'Professionalism (Term Score)'
const norm = s => (s ?? '').trim().toLowerCase()
const toMap = subs => Object.fromEntries(subs.map(s => [s.userId, { score: s.score, excused: !!s.excused }]))

export default function ScoringPanel({ courseId, courseName, loadingCourse }) {
  const toast = useToast()
  const [assignments, setAssignments]   = useState([])
  const [students, setStudents]         = useState([])
  const [sections, setSections]         = useState([])
  const [submissionsByStudent, setSubmissionsByStudent] = useState({})
  const [modules, setModules]           = useState([])
  const [entries, setEntries]           = useState([])
  const [terms, setTerms]               = useState([])
  const [courseSetup, setCourseSetup]   = useState(null)
  const [rollups, setRollups]           = useState({})
  const [loading, setLoading]           = useState(false)

  useEffect(() => {
    if (!courseId) {
      setAssignments([]); setStudents([]); setSections([]); setSubmissionsByStudent({})
      setModules([]); setEntries([]); setTerms([]); setCourseSetup(null); setRollups({})
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const [asns, secs, enrollments, mods, entryList, termList, setup, roll] = await Promise.all([
          getAssignments(courseId),
          getSections(courseId),
          getEnrollments(courseId),
          getModules(courseId),
          getLabs(courseId),
          getTerms(courseId),
          getCourseSetup(courseId),
          getRollups(courseId),
        ])
        // Submissions only for the labs and the Unit/Term score assignments.
        const relevantIds = asns.filter(a => isProfessionalismAssignment(a.name) || isScoreAssignment(a.name)).map(a => a.id)
        const subs = relevantIds.length ? await getCourseSubmissions(courseId, relevantIds) : []
        if (cancelled) return

        const sectionByStudent = {}
        for (const sec of secs) for (const sid of sec.studentIds) sectionByStudent[sid] = sec
        const byUser = new Map()
        for (const e of enrollments) {
          if (!byUser.has(e.userId)) {
            const sec = sectionByStudent[e.userId]
            byUser.set(e.userId, { userId: e.userId, userName: e.userName, sortName: e.userSortableName ?? e.userName ?? '', sectionName: sec?.name ?? '', sectionId: sec?.id ?? null })
          }
        }
        const byStudent = {}
        for (const s of subs) {
          if (!byStudent[s.userId]) byStudent[s.userId] = {}
          byStudent[s.userId][s.assignmentId] = { score: s.score, excused: s.excused }
        }
        setAssignments(asns)
        setStudents([...byUser.values()].sort((a, b) => a.sortName.localeCompare(b.sortName)))
        setSections(secs)
        setSubmissionsByStudent(byStudent)
        setModules(mods)
        setEntries(entryList)
        setTerms(termList)
        setCourseSetup(setup)
        setRollups(roll)
      } catch (err) {
        if (!cancelled) toast(`Could not load scoring data: ${err.message}`, 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [courseId])

  // Each lab is a professionalism assignment; its Unit is the Module chosen for
  // it in the Professionalism tab. Labs with no Module (or not tracked) can't
  // be rolled up and are called out instead.
  const entryByAssignment = useMemo(() => Object.fromEntries(entries.map(e => [e.professionalismAssignmentId, e])), [entries])
  const labs = useMemo(() => assignments
    .filter(a => isProfessionalismAssignment(a.name))
    .map(a => ({ id: a.id, name: a.name, pointsPossible: a.pointsPossible, entry: entryByAssignment[a.id] ?? null, moduleId: entryByAssignment[a.id]?.moduleId ?? null })),
  [assignments, entryByAssignment])
  const unassignedLabs = labs.filter(l => !l.moduleId || !modules.some(m => m.id === l.moduleId))

  const findAssignment = useCallback(title => assignments.find(a => norm(a.name) === norm(title)) ?? null, [assignments])

  const units = useMemo(() => modules
    .map(m => ({ key: m.id, name: m.name, moduleId: m.id, labs: labs.filter(l => l.moduleId === m.id), title: `${m.name} ${UNIT_SUFFIX}` }))
    .filter(u => u.labs.length > 0),
  [modules, labs])

  const termGroups = useMemo(() => terms.map(t => ({
    key: t.id, name: t.name, moduleId: null,
    labs: labs.filter(l => l.moduleId && t.moduleIds.includes(l.moduleId)),
    title: `${t.name} ${TERM_SUFFIX}`,
  })), [terms, labs])

  function handleAssignmentCreated(created) {
    setAssignments(prev => [...prev, created])
  }

  // Re-read one score assignment's submissions after a push or revert.
  async function refreshAssignment(assignmentId) {
    const subs = await getAssignmentSubmissions(courseId, assignmentId)
    setSubmissionsByStudent(prev => {
      const next = { ...prev }
      for (const s of subs) next[s.userId] = { ...next[s.userId], [assignmentId]: { score: s.score, excused: !!s.excused } }
      return next
    })
  }

  if (loading || loadingCourse) {
    return <div className="space-y-3"><Skeleton height="1.5rem" width="16rem" /><Skeleton height="8rem" /></div>
  }
  if (!courseId) return <EmptyState title="Select a course" body="Choose a course above to score Professionalism assignments." />
  if (!labs.length) {
    return (
      <EmptyState
        title="No professionalism assignments found"
        body='No assignment in this course has "professionalism" in its name. Create one in the Professionalism tab first.'
      />
    )
  }

  const shared = {
    students, sections, submissionsByStudent, rollups, setRollups, courseId, courseName,
    postToSis: courseSetup?.settings?.syncUnitTermToFocus, findAssignment,
    onAssignmentCreated: handleAssignmentCreated, refreshAssignment,
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-body)]">Scoring</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          A Unit score is the average of its labs; a Term score is the average of every lab in its Units, so each lab counts the same.
          Nothing is dropped. Excused labs don&rsquo;t count, and blank ones are noted.
        </p>
      </div>

      {unassignedLabs.length > 0 && (
        <Callout tone="warning">
          {unassignedLabs.length} lab{unassignedLabs.length === 1 ? ' has' : 's have'} no Module, so {unassignedLabs.length === 1 ? 'it isn’t' : 'they aren’t'} in any Unit or Term:{' '}
          {unassignedLabs.slice(0, 4).map(l => l.name).join(', ')}{unassignedLabs.length > 4 ? '…' : ''}. Choose a Module for {unassignedLabs.length === 1 ? 'it' : 'them'} in the Professionalism tab.
        </Callout>
      )}

      <RollupLevel level="Unit" groups={units} {...shared}
        empty="Choose a Module for each Professionalism assignment in the Professionalism tab. Each Module becomes a Unit here." />

      <div className="space-y-3">
        <RollupLevel level="Term" groups={termGroups} {...shared}
          empty="Add a Term below and choose its Modules. Its score averages every lab in those Units." />
        <TermsEditor courseId={courseId} terms={terms} setTerms={setTerms} modules={modules} />
      </div>
    </div>
  )
}

// ---- one level (Units or Terms): overview list + the selected group's detail ----

const STATUS_STYLE = {
  none:    'text-[var(--color-text-muted)]',
  current: 'text-[var(--color-success)]',
  stale:   'text-[var(--color-warning)]',
}
function statusText(st) {
  if (st.state === 'none') return 'Not pushed'
  if (st.state === 'current') return 'Up to date'
  return `Out of date (${st.count})`
}

function RollupLevel({ level, groups, empty, students, submissionsByStudent, findAssignment, ...rest }) {
  const [activeKey, setActiveKey] = useState(null)

  const computed = useMemo(() => groups.map(g => {
    const results = scoreGroup(students, g.labs, submissionsByStudent)
    const target = findAssignment(g.title)
    const canvas = target ? Object.fromEntries(students.map(s => [s.userId, submissionsByStudent[s.userId]?.[target.id]]).filter(([, v]) => v)) : {}
    return { ...g, results, target, canvas, status: groupStatus({ exists: !!target, students, results, canvas }) }
  }), [groups, students, submissionsByStudent, findAssignment])

  const active = computed.find(g => g.key === activeKey) ?? null

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-[var(--color-text-body)]">{level}s</h2>
      {computed.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{empty}</p>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {computed.map(g => {
              const open = g.key === activeKey
              return (
                <li key={g.key}>
                  <button type="button" onClick={() => setActiveKey(open ? null : g.key)} aria-expanded={open}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-bg-hover)]">
                    {open ? <ChevronDown size={16} className="shrink-0 text-[var(--color-text-muted)]" /> : <ChevronRight size={16} className="shrink-0 text-[var(--color-text-muted)]" />}
                    <span className="flex-1 min-w-0 text-sm font-medium text-[var(--color-text-body)] truncate">{g.name}</span>
                    <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{g.labs.length} lab{g.labs.length === 1 ? '' : 's'}</span>
                    <span className={`text-xs font-medium whitespace-nowrap w-28 text-right ${STATUS_STYLE[g.status.state]}`}>{statusText(g.status)}</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-4 pt-1 border-t border-[var(--color-border-subtle)]">
                      <GroupDetail level={level} group={active} students={students} submissionsByStudent={submissionsByStudent} {...rest} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </section>
  )
}

// Which periods have grades on a lab: a period counts once any of its students
// has a score (or excused). Periods come from the lab's dates when it has them
// (it was created here), otherwise every period with students.
function labProgress(lab, sections, submissionsByStudent) {
  const dated = Object.keys(lab.entry?.dates ?? {}).filter(id => lab.entry.dates[id])
  const relevant = sections.filter(s => s.studentIds.length && (dated.length ? dated.includes(s.id) : true))
  return relevant.map(sec => ({
    id: sec.id,
    name: sec.name,
    graded: sec.studentIds.some(uid => {
      const sub = submissionsByStudent[uid]?.[lab.id]
      return sub && (sub.score != null || sub.excused)
    }),
  }))
}

function GroupDetail({ level, group, students, sections, submissionsByStudent, rollups, setRollups, courseId, courseName, postToSis, onAssignmentCreated, refreshAssignment }) {
  const toast = useToast()
  const { requirePin } = usePinGate()
  const [sectionFilter, setSectionFilter] = useState('')
  const [showCopy, setShowCopy] = useState(false)
  const [withHeader, setWithHeader] = useState(true)
  const [copied, setCopied] = useState(false)
  const [pushing, setPushing] = useState(null)   // { plan, canvas } | { error } | {} while loading
  const [reverting, setReverting] = useState(null) // { changed } | { error } | {}
  const [overwrite, setOverwrite] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const { results, target, title } = group
  const kind = level === 'Unit' ? 'unit' : 'term'
  const tracked = target ? rollups[target.id] : null
  const lastPush = tracked?.lastPush ?? null

  const progressByLab = useMemo(() => Object.fromEntries(group.labs.map(l => [l.id, labProgress(l, sections, submissionsByStudent)])), [group.labs, sections, submissionsByStudent])
  // A Unit can't be pushed while one of its labs has no grades at all. Labs
  // graded in some periods but not others are only a warning: those students'
  // averages just leave that lab out for now.
  const ungraded = group.labs.filter(l => !progressByLab[l.id].some(p => p.graded))
  const partly = group.labs.filter(l => progressByLab[l.id].some(p => p.graded) && progressByLab[l.id].some(p => !p.graded))
  const blocked = level === 'Unit' && ungraded.length > 0

  const rows = students.map((student, i) => ({ student, r: results[i] }))
  const visibleRows = sectionFilter ? rows.filter(x => x.student.sectionId === sectionFilter) : rows
  const sectionOptions = sections.filter(s => s.studentIds.length).map(s => ({ value: s.id, label: s.name }))
  const scoredCount = rows.filter(x => x.r.value != null).length
  const names = Object.fromEntries(students.map(s => [s.userId, s.userName]))

  const buildPlan = (canvas, ow) => planPush({ students, results, canvas, posted: tracked?.posted ?? null, overwrite: ow })

  async function readCanvas(t) {
    return t ? toMap(await getAssignmentSubmissions(courseId, t.id)) : {}
  }

  async function openPush() {
    const none = new Set()
    setOverwrite(none)
    setPushing({})
    try {
      const canvas = await readCanvas(target)
      setPushing({ plan: buildPlan(canvas, none), canvas })
    } catch (err) {
      setPushing({ error: err.message })
    }
  }

  function toggle(ids, on) {
    const next = new Set(overwrite)
    for (const id of ids) { if (on ?? !next.has(id)) next.add(id); else next.delete(id) }
    setOverwrite(next)
    if (pushing?.canvas) setPushing({ ...pushing, plan: buildPlan(pushing.canvas, next) })
  }

  async function doPush() {
    setBusy(true)
    try {
      let t = target
      if (!t) {
        t = await createAssignment(courseId, {
          name: title, pointsPossible: 4, gradingType: 'points', submissionTypes: ['none'], published: true, postToSis,
        })
        onAssignmentCreated(t)
        // A Unit score sits in its own Module, next to the labs it averages.
        if (group.moduleId) {
          try { await ensureModuleItem(courseId, group.moduleId, t.id) }
          catch (err) { toast(`Created "${title}", but couldn't add it to the Module: ${err.message}`, 'warning') }
        }
      }
      // Re-read right before writing, so the plan acts on Canvas as it is now.
      const plan = buildPlan(await readCanvas(t), overwrite)
      const { failures, record } = await runPush(plan, {
        courseId, assignmentId: t.id, label: title, kind,
        onProgress: (d, n) => setProgress(`${d} of ${n} sent…`),
      })
      const nextTracked = await recordPush(courseId, t.id, { posted: postedAfterPush(plan, record), record })
      setRollups(prev => ({ ...prev, [t.id]: nextTracked }))
      await refreshAssignment(t.id)
      setPushing(null)
      if (failures.length) toast(`Pushed ${plan.summary.writes - failures.length} of ${plan.summary.writes} to "${title}"; ${failures.length} failed. Details: Settings › Testing › Diagnostics`, 'warning')
      else toast(`Pushed ${plan.summary.writes} score${plan.summary.writes === 1 ? '' : 's'} to "${title}"${plan.summary.held ? `; ${plan.summary.held} changed in Canvas left as is` : ''}`, 'success')
    } catch (err) {
      toast(`Could not push "${title}": ${err.message}`, 'error')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function confirmPush() {
    const n = pushing?.plan?.summary.writes ?? 0
    await requirePin(
      { action: 'push_scoring_grades', summary: `Push ${n} ${level.toLowerCase()} score${n === 1 ? '' : 's'} to "${title}" in ${courseName}`, courseId, courseName },
      doPush,
    )
  }

  async function openRevert() {
    setOverwrite(new Set())
    setReverting({})
    try {
      setReverting(planPushRevert(lastPush, await readCanvas(target)))
    } catch (err) {
      setReverting({ error: err.message })
    }
  }

  async function doRevert() {
    setBusy(true)
    try {
      const { changed } = planPushRevert(lastPush, await readCanvas(target))
      const skip = new Set(changed.map(c => c.userId).filter(id => !overwrite.has(id)))
      const { failures, reverted } = await runPushRevert(lastPush, {
        courseId, assignmentId: target.id, label: title, kind, names, skip,
        onProgress: (d, n) => setProgress(`${d} of ${n} restored…`),
      })
      const failed = new Set(failures.map(f => f.userId))
      const nextTracked = await recordPushRevert(courseId, target.id, reverted.filter(id => !failed.has(id)))
      setRollups(prev => ({ ...prev, [target.id]: nextTracked }))
      await refreshAssignment(target.id)
      setReverting(null)
      if (failures.length) toast(`Reverted, but ${failures.length} score${failures.length === 1 ? '' : 's'} could not be restored. Details: Settings › Testing › Diagnostics`, 'warning')
      else toast(`Reverted the last push to "${title}"${skip.size ? `, leaving ${skip.size} changed in Canvas as is` : ''}`, 'success')
    } catch (err) {
      toast(`Could not revert: ${err.message}`, 'error')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function confirmRevert() {
    await requirePin(
      { action: 'revert_scoring_push', summary: `Revert the last push to "${title}" in ${courseName}`, courseId, courseName },
      doRevert,
    )
  }

  const copyText = columnText(students, results, title, withHeader)
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Copy was blocked by the browser. Select the text manually.', 'warning')
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        Pushes to <span className="text-[var(--color-text-body)]">&ldquo;{title}&rdquo;</span>
        {target ? '' : ' (created on first push)'}. {scoredCount} of {students.length} students have a score.
        {tracked?.pushedAt && <> Last pushed {fmtWhen(tracked.pushedAt)}.</>}
      </p>

      {/* Grading progress: which periods have grades on each lab. */}
      <div className="space-y-1.5">
        {group.labs.map(l => (
          <div key={l.id} className="flex items-start gap-3 text-xs">
            <span className="w-48 shrink-0 truncate text-[var(--color-text-body)]" title={l.name}>{l.name}</span>
            <span className="flex flex-wrap gap-1">
              {progressByLab[l.id].map(p => (
                <span key={p.id} className={`px-1.5 py-0.5 rounded-[var(--radius-control)] border ${p.graded
                  ? 'border-[var(--color-success)] text-[var(--color-success)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>
                  {p.graded ? '✓' : '–'} {p.name}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      {blocked && (
        <Callout tone="warning">Not graded in any period yet: {ungraded.map(l => l.name).join(', ')}. Grade every lab in this Unit before pushing it.</Callout>
      )}
      {!blocked && partly.length > 0 && (
        <p className="text-xs text-[var(--color-warning)]">
          {partly.length} lab{partly.length === 1 ? ' isn’t' : 's aren’t'} graded in every period yet. Students in those periods are averaged without {partly.length === 1 ? 'it' : 'them'} for now.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Send} onClick={openPush} disabled={!scoredCount || blocked}>Push to Canvas…</Button>
        {lastPush && target && (
          <Button variant="ghost" icon={Undo2} onClick={openRevert}>Revert last push ({fmtWhen(lastPush.at)})</Button>
        )}
        <Button variant="secondary" icon={Copy} onClick={() => setShowCopy(s => !s)}>
          {showCopy ? 'Hide spreadsheet column' : 'Copy as spreadsheet column'}
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          <FieldLabel htmlFor={`sec-${group.key}`} className="mb-0">Period</FieldLabel>
          <Select id={`sec-${group.key}`} value={sectionFilter} onChange={setSectionFilter} className="w-44"
            options={[{ value: '', label: 'All periods' }, ...sectionOptions]} />
        </div>
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
              <th className="px-3 py-2 font-medium">Period</th>
              <th className="px-3 py-2 font-medium text-right bg-[var(--color-bg-hover)]">{level}</th>
              <th className="px-3 py-2 font-medium text-right">In Canvas</th>
              {group.labs.map(l => (
                <th key={l.id} className="px-3 py-2 font-medium text-right whitespace-nowrap max-w-[8rem] truncate" title={l.name}>{l.name}</th>
              ))}
              <th className="px-3 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ student, r }) => {
              const inCanvas = target ? submissionsByStudent[student.userId]?.[target.id] : null
              const shown = inCanvas ? (inCanvas.excused ? 'EX' : inCanvas.score ?? '') : ''
              const differs = r.value != null && !inCanvas?.excused && (inCanvas?.score == null || Number(inCanvas.score) !== r.value)
              return (
                <tr key={student.userId} className="border-b border-[var(--color-border-subtle)] last:border-0">
                  <td className="px-3 py-2">{student.userName}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{student.sectionName}</td>
                  <td className="px-3 py-2 text-right font-semibold">{r.value == null ? '' : fmt(r.value)}</td>
                  <td className={`px-3 py-2 text-right ${differs && target ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-muted)]'}`}>{shown}</td>
                  {group.labs.map(l => {
                    const sub = submissionsByStudent[student.userId]?.[l.id]
                    const has = sub && sub.score != null
                    return (
                      <td key={l.id} className={`px-3 py-2 text-right whitespace-nowrap ${has && sub.score <= 0 ? 'text-[var(--color-error)]' : ''}`}>
                        {has ? sub.score : sub?.excused ? 'EX' : ''}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-xs text-[var(--color-text-muted)] min-w-[12rem]">{r.notes.join('. ')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pushing && (
        <Modal
          title={`Push to "${title}"`}
          onClose={() => !busy && setPushing(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setPushing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={confirmPush} disabled={busy || !pushing.plan || pushing.plan.summary.writes === 0}>
              <span className="flex items-center gap-1.5">{busy && <Loader size={13} className="animate-spin" />}
                {pushing.plan ? `Push ${pushing.plan.summary.writes} change${pushing.plan.summary.writes === 1 ? '' : 's'}` : 'Push'}
              </span>
            </Button>
          </>}
        >
          <PushPreview pushing={pushing} target={target} title={title} group={group}
            onToggle={id => toggle([id])} onToggleAll={on => toggle(pushing.plan.students.filter(r => r.outside.length).map(r => r.userId), on)} />
          {busy && progress && <p className="text-xs text-[var(--color-text-muted)] mt-2">{progress}</p>}
        </Modal>
      )}

      {reverting && (
        <Modal
          title="Revert the last push?"
          onClose={() => !busy && setReverting(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setReverting(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={confirmRevert} disabled={busy || !reverting.changed}>
              <span className="flex items-center gap-1.5">{busy && <Loader size={13} className="animate-spin" />}Revert</span>
            </Button>
          </>}
        >
          <div className="text-sm text-[var(--color-text-secondary)] space-y-3">
            <p>
              This puts back the {Object.keys(lastPush?.before ?? {}).length} score{Object.keys(lastPush?.before ?? {}).length === 1 ? '' : 's'} on &ldquo;{title}&rdquo; that
              the push at {fmtWhen(lastPush?.at)} changed.
            </p>
            {!reverting.changed && !reverting.error && <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Loader size={12} className="animate-spin" />Checking Canvas…</p>}
            {reverting.error && <p className="text-xs text-[var(--color-error)]">Couldn&rsquo;t check Canvas: {reverting.error}</p>}
            {reverting.changed?.length > 0 && (
              <ChangedInCanvas verb="revert"
                students={reverting.changed.map(c => ({ ...c, userName: names[c.userId], overwriting: overwrite.has(c.userId) }))}
                onToggle={id => setOverwrite(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })}
                onToggleAll={on => setOverwrite(on ? new Set(reverting.changed.map(c => c.userId)) : new Set())} />
            )}
          </div>
          {busy && progress && <p className="text-xs text-[var(--color-text-muted)] mt-2">{progress}</p>}
        </Modal>
      )}
    </div>
  )
}

function PushPreview({ pushing, target, title, group, onToggle, onToggleAll }) {
  if (pushing.error) return <p className="text-sm text-[var(--color-error)]">Couldn&rsquo;t read Canvas to build the preview: {pushing.error}</p>
  if (!pushing.plan) return <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><Loader size={14} className="animate-spin" />Checking Canvas…</p>
  const { students, summary } = pushing.plan
  const changed = students.filter(r => r.outside.length)
  return (
    <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
      {!target && (
        <p className="text-[var(--color-text-body)]">
          Creates &ldquo;{title}&rdquo; (4 points){group.moduleId ? ' in this Unit’s Module' : ''} first.
        </p>
      )}
      {summary.writes === 0 ? (
        <p className="text-[var(--color-text-body)]">{summary.held ? 'Nothing to send unless you choose Overwrite below.' : 'Canvas already matches. Nothing to send.'}</p>
      ) : (
        <ul className="space-y-0.5 text-[var(--color-text-body)]">
          {summary.posts > 0 && <li><strong>{summary.posts}</strong> score{summary.posts === 1 ? '' : 's'} to post</li>}
          {summary.clears > 0 && <li><strong>{summary.clears}</strong> score{summary.clears === 1 ? '' : 's'} cleared (no graded labs any more)</li>}
          {summary.unchanged > 0 && <li className="text-[var(--color-text-muted)]">{summary.unchanged} already up to date, skipped</li>}
        </ul>
      )}
      {summary.excused > 0 && <p className="text-xs text-[var(--color-text-muted)]">{summary.excused} excused on &ldquo;{title}&rdquo; in Canvas, left alone.</p>}
      {summary.noScore > 0 && <p className="text-xs text-[var(--color-text-muted)]">{summary.noScore} with no graded labs, skipped.</p>}
      {changed.length > 0 && <ChangedInCanvas students={changed} verb="push" onToggle={onToggle} onToggleAll={onToggleAll} />}
      <p>This changes real grades in Canvas. You can revert this push afterwards.</p>
    </div>
  )
}

// ---- Terms: which Modules each Term rolls up (moved here from Course Settings) ----

function TermsEditor({ courseId, terms, setTerms, modules }) {
  const toast = useToast()
  const [open, setOpen] = useState(terms.length === 0)
  const [newName, setNewName] = useState('')

  async function add() {
    const name = newName.trim()
    if (!name) return
    if (terms.some(t => norm(t.name) === norm(name))) { toast(`There's already a Term named "${name}".`, 'warning'); return }
    const term = await saveTerm({ courseId, name, moduleIds: [] })
    setTerms(prev => [...prev, term])
    setNewName('')
  }
  async function toggleModule(term, moduleId) {
    const moduleIds = term.moduleIds.includes(moduleId) ? term.moduleIds.filter(id => id !== moduleId) : [...term.moduleIds, moduleId]
    const updated = await saveTerm({ ...term, moduleIds })
    setTerms(prev => prev.map(t => (t.id === updated.id ? updated : t)))
  }
  async function remove(term) {
    await deleteTerm(term.id)
    setTerms(prev => prev.filter(t => t.id !== term.id))
  }

  // A Module in two Terms would count its labs in both.
  const termCount = id => terms.filter(t => t.moduleIds.includes(id)).length

  return (
    <div>
      <Button variant="ghost" size="sm" icon={open ? X : Pencil} onClick={() => setOpen(o => !o)}>
        {open ? 'Done editing Terms' : 'Edit Terms'}
      </Button>
      {open && (
        <Card className="mt-2 space-y-4">
          <p className="text-xs text-[var(--color-text-muted)]">
            Choose the Modules in each Term. Changing a Term doesn&rsquo;t touch Canvas until you push its score.
          </p>
          {terms.map(term => (
            <div key={term.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--color-text-body)]">{term.name}</span>
                <button onClick={() => remove(term)} aria-label={`Delete ${term.name}`} className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]">
                  <X size={14} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {modules.map(mod => {
                  const included = term.moduleIds.includes(mod.id)
                  const elsewhere = !included && termCount(mod.id) > 0
                  return (
                    <button key={mod.id} onClick={() => toggleModule(term, mod.id)} aria-pressed={included}
                      title={elsewhere ? 'Already in another Term' : undefined}
                      className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${included
                        ? 'border-[var(--color-text-body)] text-[var(--color-text-body)] font-medium'
                        : elsewhere ? 'border-[var(--color-border-subtle)] text-[var(--color-text-muted)] opacity-60'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>
                      {included ? '✓ ' : ''}{mod.name}
                    </button>
                  )
                })}
                {modules.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No Modules in this course.</p>}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <TextField value={newName} onChange={setNewName} placeholder="Term 1" className="max-w-xs" aria-label="New Term name"
              onKeyDown={e => e.key === 'Enter' && add()} />
            <Button variant="secondary" size="sm" onClick={add}>Add Term</Button>
          </div>
        </Card>
      )}
    </div>
  )
}

function fmtWhen(iso) {
  if (!iso) return 'earlier'
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return 'earlier'
  }
}
