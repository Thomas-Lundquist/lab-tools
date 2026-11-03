// Deleting a lab's Professionalism assignment from Canvas takes its scores with
// it, but not what its commits did to the paired journal: absent students'
// journal zeros and single-student journal locks would stay behind, with no
// Revert left to undo them. These helpers find and undo those.

import { getAssignmentSubmissions, updateSubmissionGrade } from '../../api/submissions.js'
import { getOverrides, deleteOverride } from '../../api/overrides.js'

// Every student committed as absent (or excused) in any period of the lab.
// labState: { [sectionId]: { committed } } from storage/labGrading.js.
export function absentStudents(labState) {
  const out = {}
  for (const st of Object.values(labState ?? {})) {
    for (const [id, s] of Object.entries(st?.committed?.students ?? {})) {
      if (s.present === false) out[id] = { excused: !!s.excused }
    }
  }
  return out
}

// The journal writes that undo those absences, given Canvas's journal state.
// A journal score other than 0 is left alone: the student made it up, or it
// was graded by hand. Pure.
export function planJournalUndo(absent, journal, overrides) {
  const ops = []
  for (const [userId, a] of Object.entries(absent)) {
    const sub = journal[userId] ?? { score: null, excused: false }
    let fields = null
    if (a.excused && sub.excused) fields = { excuse: false }
    else if (!sub.excused && sub.score != null && Number(sub.score) === 0) fields = { posted_grade: '' }
    const lock = overrides.find(o => o.studentIds?.length === 1 && o.studentIds[0] === userId) ?? null
    if (fields || lock) ops.push({ userId, fields, lock })
  }
  return ops
}

export async function loadJournalUndo(courseId, journalId, labState) {
  const absent = absentStudents(labState)
  if (!journalId || Object.keys(absent).length === 0) return []
  const [subs, overrides] = await Promise.all([getAssignmentSubmissions(courseId, journalId), getOverrides(courseId, journalId)])
  const journal = Object.fromEntries(subs.map(s => [s.userId, { score: s.score, excused: !!s.excused }]))
  return planJournalUndo(absent, journal, overrides)
}

// Runs the plan. Failures don't stop the loop; the count comes back.
export async function runJournalUndo(courseId, entry, ops) {
  let failed = 0
  for (const op of ops) {
    try {
      if (op.fields) {
        await updateSubmissionGrade(courseId, entry.journalAssignmentId, op.userId, op.fields, {
          assignmentLabel: `${entry.name} — Journal`, kind: 'journal',
        })
      }
      if (op.lock) await deleteOverride(courseId, entry.journalAssignmentId, op.lock.id)
    } catch {
      failed++
    }
  }
  return { failed }
}
