import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.window = { location: { origin: 'https://canvas.test', protocol: 'about:' } }
globalThis.document = { cookie: '_csrf_token=tok' }

const { planPush, groupStatus, planPushRevert, postedAfterPush } = await import('./rollupPush.js')

const students = [{ userId: 'a', userName: 'Ana' }, { userId: 'b', userName: 'Ben' }, { userId: 'c', userName: 'Cy' }]
const results = values => values.map(value => ({ value }))
const byId = (s, id) => s.students.find(r => r.userId === id)

test('first push: everyone with a score is posted, students with none are skipped', () => {
  const p = planPush({ students, results: results([3.5, 2, null]), canvas: {}, posted: null })
  assert.deepEqual(byId(p, 'a').write, { posted_grade: '3.5' })
  assert.equal(byId(p, 'c').write, null)
  assert.deepEqual([p.summary.posts, p.summary.noScore, p.summary.held], [2, 1, 0])
})

test('a repeat push sends only what changed', () => {
  const canvas = { a: { score: 3.5, excused: false }, b: { score: 2, excused: false } }
  const posted = { a: 3.5, b: 2 }
  const p = planPush({ students, results: results([3.5, 2.75, null]), canvas, posted })
  assert.equal(byId(p, 'a').write, null)
  assert.deepEqual(byId(p, 'b').write, { posted_grade: '2.75' })
  assert.equal(p.summary.unchanged, 1)
})

test('a score adjusted by hand in Canvas is held until Overwrite', () => {
  const canvas = { a: { score: 4, excused: false } }
  const posted = { a: 3 }
  const held = planPush({ students: students.slice(0, 1), results: results([3.25]), canvas, posted })
  assert.equal(byId(held, 'a').held, true)
  assert.equal(byId(held, 'a').write, null)
  assert.ok(byId(held, 'a').outside[0].includes('Canvas has 4'))
  const over = planPush({ students: students.slice(0, 1), results: results([3.25]), canvas, posted, overwrite: new Set(['a']) })
  assert.deepEqual(byId(over, 'a').write, { posted_grade: '3.25' })
})

test('scores already in Canvas before Lab Tools tracked pushes are held', () => {
  const p = planPush({ students: students.slice(0, 1), results: results([3]), canvas: { a: { score: 2.5, excused: false } }, posted: null })
  assert.equal(byId(p, 'a').held, true)
})

test('a score Lab Tools pushed is cleared once no labs are graded; a hand score is not', () => {
  const canvas = { a: { score: 3, excused: false }, b: { score: 3, excused: false } }
  const p = planPush({ students: students.slice(0, 2), results: results([null, null]), canvas, posted: { a: 3 } })
  assert.deepEqual(byId(p, 'a').write, { posted_grade: '' })
  assert.equal(byId(p, 'b').write, null)
})

test('an excused score assignment is never touched', () => {
  const p = planPush({ students: students.slice(0, 1), results: results([2]), canvas: { a: { score: null, excused: true } }, posted: null })
  assert.equal(byId(p, 'a').write, null)
  assert.equal(p.summary.excused, 1)
})

test('status: not pushed, up to date, out of date', () => {
  assert.equal(groupStatus({ exists: false, students, results: results([3, 3, 3]), canvas: {} }).state, 'none')
  const canvas = { a: { score: 3 }, b: { score: 3 }, c: { score: 2 } }
  assert.equal(groupStatus({ exists: true, students, results: results([3, 3, null]), canvas }).state, 'current')
  assert.deepEqual(groupStatus({ exists: true, students, results: results([3, 3.5, 2]), canvas }), { state: 'stale', count: 1 })
})

test('revert skips scores changed in Canvas after the push', () => {
  const lastPush = { before: { a: { score: null }, b: { score: 2 } }, after: { a: 3, b: 2.5 } }
  const { changed } = planPushRevert(lastPush, { a: { score: 4, excused: false }, b: { score: 2.5, excused: false } })
  assert.deepEqual(changed.map(c => c.userId), ['a'])
})

test('posted after a push covers written and already-matching students, not held ones', () => {
  const plan = planPush({ students, results: results([3, 2, 1]), canvas: { b: { score: 2, excused: false }, c: { score: 4, excused: false } }, posted: { b: 2, c: 1 } })
  const record = { after: { a: 3 } }
  assert.deepEqual(postedAfterPush(plan, record), { a: 3, b: 2 })
})
