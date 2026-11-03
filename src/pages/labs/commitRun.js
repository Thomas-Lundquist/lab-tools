// Runs a commit plan (commitPlan.js) against Canvas, and undoes one (revert).
//
// runCommit records, per student, what Canvas held before each write it made.
// That record is stored with the period (storage/labGrading.js lastCommit) and
// is what Revert uses to put Canvas back: scores and excused states restored,
// the comment it posted deleted, a journal lock it created removed (or one it
// removed recreated). Only the most recent commit of a period can be reverted.
//
// Failures never stop the loop: each student is tried, and a student whose
// write fails (Canvas error or a blocked safety check) is reported by name.
// A failed student's earlier writes are still recorded, so Revert can undo them.

import { updateSubmissionGrade, getAssignmentSubmissions, deleteSubmissionComment } from '../../api/submissions.js'
import { createOverride, deleteOverride, getOverrides } from '../../api/overrides.js'
import { matchesExpected, showCanvasScore } from './commitPlan.js'

const gradeTouched = fields => 'posted_grade' in fields || 'excuse' in fields
const excusedAfter = (before, fields) => ('excuse' in fields ? fields.excuse : before.excused)
// What the submission holds after `fields` are applied over `before`.
const stateAfter = (before, fields) => ({
  score: 'posted_grade' in fields ? (fields.posted_grade === '' ? null : Number(fields.posted_grade)) : before.score,
  excused: excusedAfter(before, fields),
})

// Before a revert: which students' scores were changed in Canvas after the
// commit (a makeup typed in, say). Reverting them would wipe that change, so
// they're skipped unless the teacher chooses Overwrite. Records from before
// `after` was kept can't be checked and revert as before.
// current: { prof: { [userId]: { score, excused } }, journal: same | null }
export function planRevert(record, current) {
  const students = []
  for (const [userId, r] of Object.entries(record?.students ?? {})) {
    const outside = []
    for (const target of ['prof', 'journal']) {
      const g = r[target]
      const now = current[target]?.[userId]
      if (!g?.after || !now) continue
      if (!matchesExpected(now, g.after)) {
        outside.push(`${target === 'prof' ? 'Canvas' : 'Journal'} has ${showCanvasScore(now)}; the commit posted ${showCanvasScore(g.after)}`)
      }
    }
    students.push({ userId, outside })
  }
  return { students, changed: students.filter(s => s.outside.length) }
}

export async function runCommit(plan, { courseId, entry, onProgress }) {
  const failures = []
  const students = {}
  let done = 0
  const total = plan.students.filter(s => s.ops.length).length

  for (const s of plan.students) {
    if (!s.ops.length) continue
    const rec = {}
    const ctx = target => ({
      studentName: s.userName,
      assignmentLabel: target === 'prof' ? entry.name : `${entry.name} — Journal`,
      kind: target === 'prof' ? 'professionalism' : 'journal',
      absent: s.status !== 'present',
    })
    try {
      for (const op of s.ops) {
        if (op.target === 'lock' && op.action === 'create') {
          await createOverride(courseId, entry.journalAssignmentId, {
            studentIds: [s.userId],
            lockAt: new Date().toISOString(),
            title: `${s.userName ?? 'Student'} — absent lock`,
          })
          rec.lockCreated = true
        } else if (op.target === 'lock' && op.action === 'delete') {
          await deleteOverride(courseId, entry.journalAssignmentId, op.lock.id)
          rec.lockDeleted = { lockAt: op.lock.lockAt ?? null }
        } else {
          const assignmentId = op.target === 'prof' ? entry.professionalismAssignmentId : entry.journalAssignmentId
          await updateSubmissionGrade(courseId, assignmentId, s.userId, op.fields, ctx(op.target))
          if (gradeTouched(op.fields)) {
            const before = s.before[op.target]
            rec[op.target] = { before, afterExcused: excusedAfter(before, op.fields), after: stateAfter(before, op.fields) }
          }
          if (op.fields.text_comment) rec.commentPosted = op.fields.text_comment
        }
      }
    } catch (err) {
      failures.push({ userId: s.userId, userName: s.userName, message: err.message })
    }
    if (Object.keys(rec).length) students[s.userId] = rec
    done++
    onProgress?.(done, total)
  }

  return { failures, record: { at: new Date().toISOString(), students } }
}

// `skip`: students to leave alone (changed in Canvas since the commit, and the
// teacher didn't choose Overwrite). Returns them so the caller keeps their state.
export async function runRevert(record, { courseId, entry, names = {}, onProgress, skip = new Set() }) {
  const failures = []
  const entries = Object.entries(record?.students ?? {}).filter(([userId]) => !skip.has(userId))
  const needComments = entries.some(([, r]) => r.commentPosted)
  const needLocks = entries.some(([, r]) => r.lockCreated)
  const [profSubs, journalOverrides] = await Promise.all([
    needComments ? getAssignmentSubmissions(courseId, entry.professionalismAssignmentId, { includeComments: true }) : [],
    needLocks && entry.journalAssignmentId ? getOverrides(courseId, entry.journalAssignmentId) : [],
  ])
  const commentsByUser = Object.fromEntries(profSubs.map(s => [s.userId, s.commentItems ?? []]))

  let done = 0
  for (const [userId, r] of entries) {
    const studentName = names[userId] ?? null
    const ctx = target => ({
      studentName,
      assignmentLabel: target === 'prof' ? entry.name : `${entry.name} — Journal`,
      kind: target === 'prof' ? 'professionalism' : 'journal',
    })
    try {
      for (const target of ['prof', 'journal']) {
        const g = r[target]
        if (!g) continue
        const assignmentId = target === 'prof' ? entry.professionalismAssignmentId : entry.journalAssignmentId
        const fields = g.before.excused
          ? { excuse: true }
          : { ...(g.afterExcused ? { excuse: false } : {}), posted_grade: g.before.score == null ? '' : String(g.before.score) }
        await updateSubmissionGrade(courseId, assignmentId, userId, fields, ctx(target))
      }
      if (r.commentPosted) {
        // The most recent comment with exactly the text the commit posted.
        const item = [...(commentsByUser[userId] ?? [])].reverse().find(c => c.comment === r.commentPosted)
        if (item) await deleteSubmissionComment(courseId, entry.professionalismAssignmentId, userId, item.id, ctx('prof'))
      }
      if (r.lockCreated && entry.journalAssignmentId) {
        const lock = journalOverrides.find(o => o.studentIds?.length === 1 && o.studentIds[0] === userId)
        if (lock) await deleteOverride(courseId, entry.journalAssignmentId, lock.id)
      }
      if (r.lockDeleted && entry.journalAssignmentId) {
        await createOverride(courseId, entry.journalAssignmentId, {
          studentIds: [userId],
          lockAt: r.lockDeleted.lockAt ?? new Date().toISOString(),
          title: `${studentName ?? 'Student'} — absent lock`,
        })
      }
    } catch (err) {
      failures.push({ userId, userName: studentName, message: err.message })
    }
    done++
    onProgress?.(done, entries.length)
  }
  return { failures }
}
