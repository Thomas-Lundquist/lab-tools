// "Copy for Claude": plain-text reports the teacher pastes into a chat with
// Claude. Pasting sends the text to Anthropic, so student records are
// stripped first. Kept: codes, generalised operations, check results, Canvas
// messages, course/assignment ids, build, page, time. Replaced: student
// names (→ student-1, student-2… consistently within one report), student ids,
// scores (a well-formed score → <score>; a broken one is kept, since it's the
// bug, not a grade), and comment text (→ its length, plus any broken token
// like "undefined"). Pure, so it's unit-tested.

import { COVERAGE, describeWrite } from './describe.js'

const SCORE = /^\d+(\.\d+)?$/
const GARBAGE = /\[object Object\]|\bundefined\b|\bnull\b|\bNaN\b/
const LONG_NUMBER = /\b\d{5,}\b/g

function studentAliases() {
  const map = new Map()
  return name => {
    if (!name) return null
    if (!map.has(name)) map.set(name, `student-${map.size + 1}`)
    return map.get(name)
  }
}

function scrubScore(v) {
  if (v === '') return '<cleared>'
  return typeof v === 'string' && SCORE.test(v) ? '<score>' : v
}

function scrubComment(c) {
  if (typeof c !== 'string') return c
  const bad = c.match(GARBAGE)
  return `<comment, ${c.length} chars${bad ? `, contains "${bad[0]}"` : ''}>`
}

// Walk a request body, replacing student data. Unknown keys pass through:
// assignment names, dates, and points are the teacher's content, not records.
export function scrubBody(body) {
  if (Array.isArray(body)) return body.map(scrubBody)
  if (!body || typeof body !== 'object') return body
  const out = {}
  for (const [k, v] of Object.entries(body)) {
    if (k === 'posted_grade') out[k] = scrubScore(v)
    else if (k === 'text_comment') out[k] = scrubComment(v)
    else if (k === 'student_ids') out[k] = Array.isArray(v) ? v.map(() => '<student id>') : '<student ids>'
    else if (k === 'title' && body.student_ids) out[k] = '<title>' // per-student lock titles carry the name
    else if (k === 'data' && typeof v === 'string') out[k] = `<synced data, ${v.length} chars>`
    else out[k] = scrubBody(v)
  }
  return out
}

// Free text (action labels, Canvas messages): known names and long ids out.
function scrubText(text, names, alias) {
  if (!text) return text
  let t = String(text)
  for (const name of names) if (name) t = t.split(name).join(alias(name))
  return t.replace(LONG_NUMBER, '<id>')
}

const time = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

export function debugReportText(entries, { build = 'unknown', now = new Date() } = {}) {
  const alias = studentAliases()
  const names = [...new Set(entries.map(e => e.context?.studentName).filter(Boolean))]
  names.forEach(alias)
  const done = new Set(entries.filter(e => !e.blocked).flatMap(e => e.categories))
  const lines = [
    `Lab Tools debug report — build ${build} — ${now.toISOString()}`,
    `Nothing below was sent to Canvas. Student names, ids, scores, and comments are replaced.`,
    `Coverage: ${COVERAGE.filter(([k]) => done.has(k)).length} of ${COVERAGE.length}`,
    `  done: ${COVERAGE.filter(([k]) => done.has(k)).map(([, l]) => l).join(', ') || 'none'}`,
    `  not yet: ${COVERAGE.filter(([k]) => !done.has(k)).map(([, l]) => l).join(', ') || 'none'}`,
    `Writes: ${entries.length} (${entries.filter(e => e.blocked).length} blocked, ${entries.filter(e => !e.blocked && e.checks.some(c => c.level === 'warn')).length} with warnings)`,
    '',
  ]
  let lastAction
  for (const e of entries) {
    if (e.action !== lastAction) {
      lines.push(`== ${scrubText(e.action, names, alias) ?? '(no named action)'}`)
      lastAction = e.action
    }
    const body = scrubBody(e.body)
    const context = { ...e.context, studentName: alias(e.context?.studentName) ?? 'student-?' }
    const { text } = describeWrite({ method: e.method, path: e.path, body, context })
    lines.push(`[${e.n}] ${time(e.at)} ${e.blocked ? 'BLOCKED ' : ''}${scrubText(text, names, alias)}`)
    lines.push(`    ${e.operation}`)
    for (const c of e.checks) lines.push(`    ${c.level.toUpperCase()} ${c.rule}: ${c.message}`)
    lines.push(`    body: ${JSON.stringify(body)}`)
  }
  return lines.join('\n')
}

export function diagnosticsText(list, { build = 'unknown', now = new Date() } = {}) {
  const alias = studentAliases()
  const lines = [
    `Lab Tools diagnostics — build ${build} — ${now.toISOString()}`,
    `${list.length} entr${list.length === 1 ? 'y' : 'ies'}, newest first. Long ids are replaced with <id>.`,
    '',
  ]
  for (const d of list) {
    lines.push(`${d.at} ${d.code}${d.count > 1 ? ` ×${d.count}` : ''}${d.debug ? ' [debug mode]' : ''} on page "${d.route ?? '?'}"`)
    if (d.operation) lines.push(`    ${scrubText(d.operation, [], alias)}`)
    lines.push(`    ${scrubText(d.message, [], alias)}`)
    for (const c of d.checks ?? []) lines.push(`    ${scrubText(c, [], alias)}`)
  }
  return lines.join('\n')
}
