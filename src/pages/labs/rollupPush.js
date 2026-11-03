// Pushing Unit and Term scores to Canvas, the same way Commit Period works for
// a lab (DECISIONS.md, 2026-11-02): a pure plan first, shown as a preview, that
// sends only scores that changed, clears a score Lab Tools posted that no
// longer has labs behind it, and holds any score changed in Canvas since Lab
// Tools last pushed it (a hand adjustment) unless the teacher turns on
// Overwrite. The last push of each score assignment can be reverted.

import { updateSubmissionGrade } from '../../api/submissions.js'
import { showCanvasScore } from './commitPlan.js'

const sameScore = (a, b) => a != null && b != null && Number(a) === Number(b)
const sameOrBothBlank = (a, b) => (a == null ? b == null : sameScore(a, b))

/**
 * @param students  [{ userId, userName }]
 * @param results   scoreGroup() output, same order as students
 * @param canvas    { [userId]: { score, excused } } on the score assignment ({} if it doesn't exist yet)
 * @param posted    { [userId]: score|null } Lab Tools last left there, or null if it never pushed it
 * @param overwrite Set of userIds whose Canvas change the teacher chose to overwrite
 */
export function planPush({ students, results, canvas, posted, overwrite = new Set() }) {
  const rows = students.map((st, i) => {
    const value = results[i]?.value ?? null
    const cur = canvas[st.userId] ?? { score: null, excused: false }
    const base = { userId: st.userId, userName: st.userName, value, current: cur, write: null, held: false, outside: [], overwriting: false }
    // An excused score assignment is the teacher's call; never touched.
    if (cur.excused) return { ...base, excused: true }

    let grade = null
    if (value != null && !sameScore(cur.score, value)) grade = String(value)
    // No labs counted any more: clear the score only if Lab Tools put it there.
    else if (value == null && cur.score != null && posted?.[st.userId] != null) grade = ''
    if (grade == null) return base

    const expected = posted ? (posted[st.userId] ?? null) : null
    const changed = posted ? !sameOrBothBlank(cur.score, expected) : cur.score != null
    const outside = changed ? [`Canvas has ${showCanvasScore(cur)}; ${posted && expected != null ? `Lab Tools last pushed ${expected}` : 'not pushed by Lab Tools'}`] : []
    const held = outside.length > 0 && !overwrite.has(st.userId)
    return { ...base, write: held ? null : { posted_grade: grade }, held, outside, overwriting: outside.length > 0 && !held }
  })
  const count = pred => rows.filter(pred).length
  return {
    students: rows,
    summary: {
      writes: count(r => r.write),
      posts: count(r => r.write && r.write.posted_grade !== ''),
      clears: count(r => r.write && r.write.posted_grade === ''),
      held: count(r => r.held),
      unchanged: count(r => !r.write && !r.held && !r.excused && r.value != null),
      excused: count(r => r.excused),
      noScore: count(r => r.value == null && !r.write),
    },
  }
}

// How a score assignment compares with what the labs add up to now.
//   none:    the assignment doesn't exist yet (never pushed)
//   current: every student's computed score is what Canvas holds
//   stale:   `count` students differ (a lab was regraded or made up since)
export function groupStatus({ exists, students, results, canvas }) {
  if (!exists) return { state: 'none', count: 0 }
  let n = 0
  students.forEach((st, i) => {
    const value = results[i]?.value ?? null
    const cur = canvas[st.userId]
    if (cur?.excused) return
    if (value != null && !sameScore(cur?.score, value)) n++
  })
  return n ? { state: 'stale', count: n } : { state: 'current', count: 0 }
}

// Before reverting a push: students whose score changed in Canvas after it.
export function planPushRevert(lastPush, canvas) {
  const changed = []
  for (const [userId, after] of Object.entries(lastPush?.after ?? {})) {
    const cur = canvas[userId] ?? { score: null, excused: false }
    if (cur.excused || !sameOrBothBlank(cur.score, after)) {
      changed.push({ userId, outside: [`Canvas has ${showCanvasScore(cur)}; the push posted ${after ?? 'blank'}`] })
    }
  }
  return { changed }
}

const ctxFor = (st, label, kind) => ({ studentName: st.userName, assignmentLabel: label, kind })

// Sends the plan. Records each written student's score before and after, for Revert.
export async function runPush(plan, { courseId, assignmentId, label, kind, onProgress }) {
  const failures = []
  const before = {}
  const after = {}
  const toSend = plan.students.filter(r => r.write)
  let done = 0
  for (const r of toSend) {
    try {
      await updateSubmissionGrade(courseId, assignmentId, r.userId, r.write, ctxFor(r, label, kind))
      before[r.userId] = r.current
      after[r.userId] = r.write.posted_grade === '' ? null : Number(r.write.posted_grade)
    } catch (err) {
      failures.push({ userId: r.userId, userName: r.userName, message: err.message })
    }
    onProgress?.(++done, toSend.length)
  }
  return { failures, record: { at: new Date().toISOString(), before, after } }
}

// What Lab Tools now knows it left on the assignment: every student it wrote,
// plus every student whose Canvas score already matched (confirmed, not written).
export function postedAfterPush(plan, record) {
  const out = {}
  for (const r of plan.students) {
    if (Object.hasOwn(record.after, r.userId)) out[r.userId] = record.after[r.userId]
    else if (!r.write && !r.held && !r.excused && r.value != null) out[r.userId] = r.value
  }
  return out
}

export async function runPushRevert(lastPush, { courseId, assignmentId, label, kind, names = {}, skip = new Set(), onProgress }) {
  const failures = []
  const ids = Object.keys(lastPush?.before ?? {}).filter(id => !skip.has(id))
  let done = 0
  for (const userId of ids) {
    const b = lastPush.before[userId]
    const fields = b.excused ? { excuse: true } : { posted_grade: b.score == null ? '' : String(b.score) }
    try {
      await updateSubmissionGrade(courseId, assignmentId, userId, fields, ctxFor({ userName: names[userId] ?? null }, label, kind))
    } catch (err) {
      failures.push({ userId, userName: names[userId] ?? null, message: err.message })
    }
    onProgress?.(++done, ids.length)
  }
  return { failures, reverted: ids }
}
