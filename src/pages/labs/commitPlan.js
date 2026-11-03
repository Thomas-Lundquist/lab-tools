// Commit planner for the Lab tab (DECISIONS.md, 2026-11-02). Pure: given the
// working section, the last committed section, and what Canvas holds right now,
// it decides exactly which writes each student needs. The commit preview shows
// this plan, and the commit runs it (commitRun.js) — so what the teacher
// approves is what gets sent.
//
// Every write is computed against Canvas's current state, so a recommit only
// sends what changed: an absent student already zeroed and locked is left
// alone, an identical comment is never posted twice, and an unchanged score
// isn't re-sent.
//
// Per student:
//   present  — post the derived score (+ comment). If they were committed as
//              absent last time, also undo the absence: clear the journal zero
//              (or un-excuse it) and remove the journal lock.
//   absent   — professionalism 0, journal 0 (if the course setting is on), and a
//              single-student lock on the journal so it can't be submitted.
//   excused  — Canvas's own "excused" on professionalism and the journal (it
//              doesn't count against the grade); any old journal lock is removed.
// Absent and excused students never get the kitchen's flag summary — only the
// teacher's own typed or library comments.
//
// Scores changed in Canvas are held, not overwritten (DECISIONS.md, 2026-11-02).
// A makeup score typed into the gradebook, or any other hand edit, means Canvas
// no longer holds what Lab Tools last posted. Such a student's writes are held
// back: their ops move to `heldOps`, the preview lists them, and they're sent
// only if the teacher turns on Overwrite for that student (`overwrite`). The
// journal and its lock are held with the score, so a made-up lab isn't
// re-zeroed or re-locked.

import { deriveStudentScore } from '../../storage/labGrading.js'
import { FLAG_BY_ID } from '../../config/labFlags.js'
import { checkGradeWrite } from '../../debug/checks.js'

// One submission comment body: the flag summary (only when includeFlags) plus
// library comments and the free-text comment. Deterministic, so an unchanged
// commit produces the same string and can be skipped as a duplicate.
export function buildComment(section, studentId, score, includeFlags, byId = FLAG_BY_ID) {
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

// An absence writes a professionalism score of exactly 0.
// Build the working section from the roster, seeding each student from the prior
// (committed or draft) state and, with no prior state, from Canvas for
// present/absent: Canvas "excused" means an excused absence, a score of 0 means
// already-absent, and anything else means present. Every stored field is kept —
// Exceeds, comments, and library comments too — so resuming a draft or
// reopening a committed period never drops them.
export function buildSection(roster, prior, profState, standing = null) {
  const students = {}
  for (const s of roster) {
    const was = prior?.students?.[s.userId]
    const canvas = profState[s.userId] ?? {}
    students[s.userId] = was
      ? { kitchen: null, flagIds: [], excused: false, ...was }
      : {
          // A student this lab hasn't seen yet starts in their usual kitchen
          // (storage/kitchens.js), if they have one.
          kitchen: standing?.students?.[s.userId] ?? null,
          flagIds: [],
          present: !(canvas.excused || canvas.score === 0),
          excused: !!canvas.excused,
        }
  }
  return { kitchens: prior?.kitchens ?? {}, students }
}

const sameScore = (a, b) => a != null && b != null && Number(a) === Number(b)

// What Canvas should hold on the professionalism assignment if nobody touched it
// since Lab Tools' last commit. `posted` (stored at each commit) is exact. Periods
// committed before it existed fall back to the last committed flags.
function expectedProf(postedProf, prior, userId, maxScore, byId) {
  if (postedProf) return postedProf
  const p = prior?.students?.[userId]
  if (!p) return { score: null, excused: false }
  if (p.present === false) return p.excused ? { score: null, excused: true } : { score: 0, excused: false }
  return { score: deriveStudentScore(prior, userId, maxScore, byId), excused: false }
}

export function matchesExpected(canvas, exp) {
  if (exp.excused) return !!canvas.excused
  if (canvas.excused) return false
  return exp.score == null ? canvas.score == null : sameScore(canvas.score, exp.score)
}

export const showCanvasScore = st => (st.excused ? 'Excused' : st.score == null ? 'blank' : String(st.score))
const touchesGrade = op => !!op.fields && ('posted_grade' in op.fields || 'excuse' in op.fields)

/**
 * @param roster   [{ userId, userName }]
 * @param section  the working section (what the teacher sees)
 * @param prior    the last committed section, or null
 * @param canvas   {
 *   prof:    { [userId]: { score, excused, comments: [text] } },
 *   journal: { [userId]: { score, excused } } | null   (null = no journal),
 *   locks:   { [userId]: { id, lockAt } }               (single-student journal overrides)
 * }
 * @param ids      { courseId, profId, journalId }
 * @param settings { commentsOn, maxScore, zeroJournalWhenAbsent }
 * @param posted   { [userId]: { prof: { score, excused } } }: what Lab Tools last
 *                 put on Canvas for each student (storage/labGrading.js), or {}
 * @param overwrite Set of userIds whose Canvas changes the teacher chose to overwrite
 */
export function planCommit({ roster, section, prior, canvas, ids, settings, byId = FLAG_BY_ID, posted = {}, overwrite = new Set() }) {
  const { commentsOn = false, maxScore = 4, zeroJournalWhenAbsent = true } = settings
  const hasJournal = !!ids.journalId && !!canvas.journal
  const students = []

  for (const { userId, userName } of roster) {
    const st = section.students[userId]
    const prof = canvas.prof[userId] ?? { score: null, excused: false, comments: [] }
    const journal = canvas.journal?.[userId] ?? { score: null, excused: false }
    const lock = canvas.locks?.[userId] ?? null
    const wasAbsent = prior?.students?.[userId]?.present === false
    const status = st?.present === false ? (st.excused ? 'excused' : 'absent') : 'present'
    let ops = []
    let score = null
    let comment = null

    const addComment = (fields, text) => {
      if (text && !(prof.comments ?? []).includes(text)) { fields.text_comment = text; comment = text }
    }

    if (status === 'present') {
      score = deriveStudentScore(section, userId, maxScore, byId)
      const fields = {}
      if (prof.excused) fields.excuse = false
      if (prof.excused || !sameScore(prof.score, score)) fields.posted_grade = String(score)
      addComment(fields, buildComment(section, userId, score, commentsOn, byId))
      if (Object.keys(fields).length) ops.push({ target: 'prof', fields })
      // Back from absent: undo what the absence wrote to the journal.
      if (wasAbsent && hasJournal) {
        if (journal.excused) ops.push({ target: 'journal', fields: { excuse: false } })
        else if (sameScore(journal.score, 0)) ops.push({ target: 'journal', fields: { posted_grade: '' } })
        if (lock) ops.push({ target: 'lock', action: 'delete', lock })
      }
    } else if (status === 'absent') {
      score = 0
      const fields = {}
      if (prof.excused) fields.excuse = false
      if (prof.excused || !sameScore(prof.score, 0)) fields.posted_grade = '0'
      addComment(fields, buildComment(section, userId, 0, false, byId))
      if (Object.keys(fields).length) ops.push({ target: 'prof', fields })
      if (hasJournal) {
        if (zeroJournalWhenAbsent && (journal.excused || !sameScore(journal.score, 0))) {
          ops.push({ target: 'journal', fields: { ...(journal.excused ? { excuse: false } : {}), posted_grade: '0' } })
        }
        if (!lock) ops.push({ target: 'lock', action: 'create' })
      }
    } else {
      const fields = {}
      if (!prof.excused) fields.excuse = true
      addComment(fields, buildComment(section, userId, null, false, byId))
      if (Object.keys(fields).length) ops.push({ target: 'prof', fields })
      if (hasJournal) {
        if (!journal.excused) ops.push({ target: 'journal', fields: { excuse: true } })
        if (lock) ops.push({ target: 'lock', action: 'delete', lock })
      }
    }

    // Changed in Canvas since the last commit? Only matters for a write that
    // would replace it: a comment alone never conflicts.
    const outside = []
    const exp = expectedProf(posted[userId]?.prof, prior, userId, maxScore, byId)
    if (ops.some(op => op.target === 'prof' && touchesGrade(op)) && !matchesExpected(prof, exp)) {
      outside.push(`Canvas has ${showCanvasScore(prof)}; Lab Tools last posted ${showCanvasScore(exp)}`)
    }
    if (ops.some(op => op.target === 'journal' && touchesGrade(op)) && journal.score != null && !sameScore(journal.score, 0)) {
      outside.push(`Journal has ${journal.score}`)
    }
    const priorSt = prior?.students?.[userId]
    if (ops.some(op => op.target === 'lock' && op.action === 'create') && priorSt?.present === false && !priorSt.excused) {
      outside.push('Journal lock was removed in Canvas')
    }
    const held = outside.length > 0 && !overwrite.has(userId)
    const heldOps = held ? ops : []
    if (held) { ops = []; comment = null }

    // What the professionalism assignment holds once this plan runs (stored as
    // `posted` after a commit). Unknown while held: Canvas keeps its own value.
    const after = held ? null
      : status === 'excused' ? { score: prof.score ?? null, excused: true }
        : { score, excused: false }

    // The same safety checks the writes will run, so the preview shows blocks.
    const checks = ops
      .filter(op => op.fields)
      .flatMap(op => checkGradeWrite({
        courseId: ids.courseId,
        assignmentId: op.target === 'prof' ? ids.profId : ids.journalId,
        userId,
        fields: op.fields,
        context: { kind: op.target === 'prof' ? 'professionalism' : 'journal', existingComments: op.target === 'prof' ? prof.comments : [] },
      }))

    students.push({
      userId, userName, status, score, comment, ops, checks, outside, held, heldOps, after,
      overwriting: outside.length > 0 && !held,
      returning: status === 'present' && wasAbsent,
      blocked: checks.some(c => c.level === 'block'),
      before: { prof: { score: prof.score, excused: !!prof.excused }, journal: { score: journal.score, excused: !!journal.excused }, lock },
    })
  }

  return { students, summary: summarize(students) }
}

export function summarize(students) {
  const scoreCounts = {}
  for (const s of students) {
    if (s.status === 'present' && s.ops.some(op => op.target === 'prof' && 'posted_grade' in op.fields)) {
      const k = String(s.score)
      scoreCounts[k] = (scoreCounts[k] ?? 0) + 1
    }
  }
  const count = pred => students.filter(pred).length
  return {
    total: students.length,
    scoresPosted: Object.values(scoreCounts).reduce((a, b) => a + b, 0),
    scoreCounts,
    comments: count(s => s.comment),
    absent: count(s => s.status === 'absent'),
    excused: count(s => s.status === 'excused'),
    returning: count(s => s.returning),
    unchanged: count(s => s.ops.length === 0 && !s.held),
    held: count(s => s.held),
    overwriting: count(s => s.overwriting),
    blocked: count(s => s.blocked),
    writes: students.reduce((n, s) => n + s.ops.length, 0),
  }
}
