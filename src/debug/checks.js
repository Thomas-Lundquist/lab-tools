// Safety checks on grade and comment writes, run before anything is sent —
// in live mode and in debug mode alike. Pure: no storage, no network.
//
// Each result is { level, rule, message }:
//   'block' — the write is refused (request.js throws CheckError, LT-CHECK).
//             Reserved for values that can only be a bug: a score of "null",
//             a comment reading "[object Object]", an id that isn't an id.
//   'warn'  — sent (or, in debug mode, shown amber in the report) but worth a look.
// Messages describe the value, never the student, so they are safe to log.

const CANVAS_ID = /^\d+$/
const DEBUG_ID = /^debug-\d+$/ // a fake id from debug mode; request.js blocks it from reaching live Canvas
const SCORE = /^\d+(\.\d+)?$/
const GARBAGE = /\[object Object\]|\bundefined\b|\bnull\b|\bNaN\b/

const show = v => (typeof v === 'string' ? `"${v}"` : String(v))

export function checkGradeWrite({ courseId, assignmentId, userId, fields = {}, context = {} }) {
  const out = []
  const block = (rule, message) => out.push({ level: 'block', rule, message })
  const warn = (rule, message) => out.push({ level: 'warn', rule, message })

  for (const [label, id] of [['course', courseId], ['assignment', assignmentId], ['student', userId]]) {
    const s = String(id)
    if (!CANVAS_ID.test(s) && !DEBUG_ID.test(s)) block('bad-id', `the ${label} id ${show(id)} isn't a Canvas id`)
  }

  const hasGrade = Object.hasOwn(fields, 'posted_grade')
  const hasComment = Object.hasOwn(fields, 'text_comment')
  const hasExcuse = Object.hasOwn(fields, 'excuse')
  if (!hasGrade && !hasComment && !hasExcuse) block('empty-write', 'there is nothing to send — no score, comment, or excuse')

  if (hasGrade) {
    const g = fields.posted_grade
    if (g !== '' && !(typeof g === 'string' && SCORE.test(g))) {
      block('bad-score', `the score is ${show(g)}, not a number`)
    } else if (g !== '') {
      const n = Number(g)
      if (context.kind === 'professionalism' && n > 4) warn('score-above-4', `the score ${n} is above 4 on a Professionalism assignment`)
      if (context.pointsPossible != null && n > context.pointsPossible) warn('score-above-max', `the score ${n} is above the ${context.pointsPossible} points possible`)
    }
  }

  if (hasExcuse && typeof fields.excuse !== 'boolean') block('bad-excuse', `excuse is ${show(fields.excuse)}, not true/false`)

  if (hasComment) {
    const c = fields.text_comment
    if (typeof c !== 'string' || c.trim() === '') {
      block('blank-comment', typeof c === 'string' ? 'the comment is blank' : `the comment is ${show(c)}, not text`)
    } else {
      const m = c.match(GARBAGE)
      if (m) block('garbage-comment', `the comment contains "${m[0]}" — a sign it was built from missing data`)
      if ((context.existingComments ?? []).includes(c)) warn('duplicate-comment', 'this exact comment is already on the submission')
    }
  }

  return out
}

export const isBlocked = checks => checks.some(c => c.level === 'block')
