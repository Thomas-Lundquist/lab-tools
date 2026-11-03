import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.window = { location: { origin: 'https://canvas.test', protocol: 'about:' } }
globalThis.document = { cookie: '_csrf_token=tok' }

const { absentStudents, planJournalUndo } = await import('./labRemoval.js')
const { planRevert } = await import('./commitRun.js')
const { isLatestLab, standingFromLatestLab } = await import('../../storage/kitchens.js')

test('absentStudents gathers absences from every committed period', () => {
  const lab = {
    s1: { committed: { students: { a: { present: false }, b: { present: true } } } },
    s2: { committed: { students: { c: { present: false, excused: true } } }, draft: { students: { d: { present: false } } } },
  }
  assert.deepEqual(absentStudents(lab), { a: { excused: false }, c: { excused: true } })
})

test('journal undo clears zeros and locks but leaves a made-up journal alone', () => {
  const absent = { a: { excused: false }, b: { excused: false }, c: { excused: true } }
  const journal = { a: { score: 0, excused: false }, b: { score: 7, excused: false }, c: { score: null, excused: true } }
  const overrides = [{ id: 'o1', studentIds: ['a'] }, { id: 'o9', studentIds: ['a', 'b'] }]
  assert.deepEqual(planJournalUndo(absent, journal, overrides), [
    { userId: 'a', fields: { posted_grade: '' }, lock: { id: 'o1', studentIds: ['a'] } },
    { userId: 'c', fields: { excuse: false }, lock: null },
  ])
})

test('revert skips a student whose score changed in Canvas after the commit', () => {
  const record = { students: {
    1: { prof: { before: { score: null, excused: false }, after: { score: 0, excused: false } } },
    2: { prof: { before: { score: 3, excused: false }, after: { score: 2, excused: false } } },
    3: { prof: { before: { score: 1, excused: false } } }, // old record without `after`: can't check
  } }
  const current = { prof: { 1: { score: 3, excused: false }, 2: { score: 2, excused: false }, 3: { score: 4, excused: false } }, journal: null }
  const { changed } = planRevert(record, current)
  assert.deepEqual(changed.map(c => c.userId), ['1'])
  assert.ok(changed[0].outside[0].includes('Canvas has 3'))
})

test('kitchen moves count as the usual kitchens only in the latest lab', () => {
  const sep = { id: 'lab_1', dates: { s: '2026-09-10' } }
  const oct = { id: 'lab_2', dates: { s: '2026-10-20' } }
  const future = { id: 'lab_3', dates: { s: '2026-12-01' } }
  const all = [sep, oct, future]
  assert.equal(isLatestLab(sep, all, 's', '2026-11-02'), false)
  assert.equal(isLatestLab(oct, all, 's', '2026-11-02'), true, 'a lab set up ahead of time does not count')
})

test('a discarded draft does not outrank a newer commit when seeding', () => {
  const a = { committed: { students: { x: { kitchen: 1 } } }, committedAt: '2026-10-01', draft: null, updatedAt: '2026-10-20' }
  const b = { committed: { students: { x: { kitchen: 5 } } }, committedAt: '2026-10-15', draft: null, updatedAt: '2026-10-15' }
  assert.deepEqual(standingFromLatestLab([a, b]), { students: { x: 5 } })
})

const { todaysLab, newestFirst, localToday } = await import('../../storage/kitchens.js')

test('today’s lab: prefers one dated today for this period, else any dated today', () => {
  const a = { id: 'lab_1', dates: { p1: '2026-11-02', p2: '2026-11-03' } }
  const b = { id: 'lab_2', dates: { p2: '2026-11-02' } }
  assert.equal(todaysLab([a, b], 'p2', '2026-11-02').id, 'lab_2')
  assert.equal(todaysLab([a, b], 'p1', '2026-11-02').id, 'lab_1')
  assert.equal(todaysLab([a, b], 'p1', '2026-12-25'), null)
})

test('labs list newest first by their latest date', () => {
  const old = { id: 'lab_1', dates: { p: '2026-09-01' } }
  const mid = { id: 'lab_2', dates: { p: '2026-10-01', q: '2026-10-02' } }
  const linked = { id: `lab_${Date.UTC(2026, 10, 1)}`, dates: {} }
  assert.deepEqual(newestFirst([old, mid, linked]).map(e => e.id), [linked.id, 'lab_2', 'lab_1'])
})

test('localToday uses the local calendar date', () => {
  assert.equal(localToday(new Date(2026, 10, 2, 21, 30)), '2026-11-02')
})
