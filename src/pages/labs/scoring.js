// Professionalism-by-unit scoring — ported from the standalone
// "professionalism-by-unit.html" tool's `Calc` object. The rules are
// unchanged; only the input shape differs (live Canvas submissions instead
// of parsed CSV cells).
//
// Rules (unchanged from the original tool):
//   - A graded score <= 0 on a lab counts as "missed."
//   - If missed / counted >= 0.5 for a unit, the unit score is 0.
//   - Otherwise each counted score is converted to a 4-point scale via
//     (score / pointsPossible) * 4; with 3+ counted labs the single lowest
//     is dropped; the rest are averaged and rounded to 2 decimals.
//   - Ungraded/unsubmitted labs are "blank" and not counted, but flagged.
//   - Excused labs are not counted, and noted.
//
// One deliberate simplification vs. the CSV tool: the CSV version also
// recognized free-text "N/A" and arbitrary non-numeric cells (since a human
// could type anything into an exported spreadsheet). Canvas's API only ever
// gives us a numeric score, null (ungraded/unsubmitted), or excused=true for
// a points-based assignment, so those two extra states don't occur here —
// both blank and "N/A-ish" collapse into the single "blank" state below.
//
// scoreStudent/scoreUnit are generic over "a list of scored items with an
// id/name/pointsPossible and a submission lookup" — they're reused at both
// the Unit level (items = labs) and the Term level (items = each unit's own
// unit-score assignment) in ScoringPanel.jsx. Nothing here is lab-specific.

export const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100
export const fmt = x => String(round2(x))

// A lab's professionalism assignment has "professionalism" in its name, but
// so do the unit/term score assignments this tool (the Scoring tab)
// creates — e.g. "Safety and Sanitation Professionalism (Unit Score)". Those
// must never be counted as labs themselves, or a unit's own score assignment
// would feed back into its average once created. See PLAN.md Section 3.
const PROFESSIONALISM_RE = /professionalism/i
const SCORE_ASSIGNMENT_RE = /\((unit|term) score\)/i
export const isProfessionalismAssignment = name => PROFESSIONALISM_RE.test(name) && !SCORE_ASSIGNMENT_RE.test(name)

// Picks out a course's unit-score assignments specifically — the *input* to
// Term rollup in ScoringPanel.jsx, as opposed to isProfessionalismAssignment's
// job of excluding them from lab rollup.
export const isUnitScore = name => /\(unit score\)/i.test(name)

const toFour = (score, points) => (points && points > 0 ? (score / points) * 4 : score)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Attendance's deduction scoring: each deduction "mark" is a reason picked
// for a present student. Marks cost a full step immediately, then another
// step every `marksPerStep` marks after that (ceil, not floor) — e.g. with
// the defaults, 1 mark -> 3, 2 marks -> 3, 3 marks -> 2, 4 marks -> 2, ...
// Never goes below 0 regardless of pointsPossible.
export function scoreFromDeductions(markCount, { pointsPossible = 4, pointsPerStep = 1, marksPerStep = 2 } = {}) {
  if (markCount <= 0) return pointsPossible
  const steps = Math.ceil(markCount / marksPerStep)
  return Math.max(0, pointsPossible - steps * pointsPerStep)
}

// Classifies one student's submission on one lab assignment.
//   submission: { score: number|null, excused: boolean } | undefined (no submission row at all)
export function readSubmission(submission) {
  if (!submission || submission.excused) return { state: 'excused' }
  if (submission.score === null || submission.score === undefined) return { state: 'blank' }
  return { state: 'score', value: submission.score }
}

// labs: [{ id, name, pointsPossible }]
// submissionsByAssignmentId: { [assignmentId]: { score, excused } | undefined } for one student
export function scoreStudent(submissionsByAssignmentId, labs) {
  const notes = []
  const pool = []
  let missed = 0

  for (const lab of labs) {
    const c = readSubmission(submissionsByAssignmentId[lab.id])
    if (c.state === 'score') {
      if (c.value <= 0) missed++
      pool.push({ value: c.value > 0 ? toFour(c.value, lab.pointsPossible) : 0, from: lab.name })
    } else if (c.state === 'blank') {
      notes.push(`${lab.name} is blank and wasn't counted`)
    } else if (c.state === 'excused') {
      notes.push(`Excused from ${lab.name}`)
    }
  }

  const counted = pool.length
  const base = { missed, counted, dropped: null, zero: false }
  if (counted === 0) return { ...base, value: null, notes: ['No lab scores in this unit yet', ...notes] }
  if (missed) notes.unshift(`Missed ${missed} of ${plural(counted, 'lab')}`)
  if (missed / counted >= 0.5) return { ...base, value: 0, zero: true, notes }

  let dropped = null
  if (pool.length >= 3) {
    let low = 0
    pool.forEach((p, i) => { if (p.value < pool[low].value) low = i })
    dropped = pool.splice(low, 1)[0]
    notes.push(`Dropped ${fmt(dropped.value)} from ${dropped.from}`)
  }
  const avg = pool.reduce((a, p) => a + p.value, 0) / pool.length
  return { ...base, value: round2(avg), dropped, notes }
}

// Distinct unit names, in the order labs were first assigned to them.
// assign: { [assignmentId]: unitName }
export function units(labs, assign) {
  const out = []
  for (const lab of labs) {
    const u = (assign[lab.id] || '').trim()
    if (u && !out.includes(u)) out.push(u)
  }
  return out
}

// students: [{ userId, userName, sectionName }]
// submissionsByStudent: { [userId]: { [assignmentId]: { score, excused } } }
export function scoreUnit(students, labs, assign, unit, submissionsByStudent) {
  const unitLabs = labs.filter(l => (assign[l.id] || '').trim() === unit)
  const results = students.map(s => scoreStudent(submissionsByStudent[s.userId] ?? {}, unitLabs))
  return { unit, labs: unitLabs, results }
}

// Fallback "copy as spreadsheet column" export (students in the same order
// passed to scoreUnit).
export function columnText(students, scored, title, withHeader) {
  const lines = []
  if (withHeader) lines.push(title)
  students.forEach((s, i) => {
    const r = scored.results[i]
    lines.push(r && r.value !== null ? String(r.value) : '')
  })
  return lines.join('\n')
}
