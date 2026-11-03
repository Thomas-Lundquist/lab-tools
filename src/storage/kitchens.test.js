import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withKitchen, standingFromLatestLab } from './kitchens.js'
import { buildSection } from '../pages/labs/commitPlan.js'
import { isSyncedKey } from './sync.js'

test('withKitchen sets, moves, and clears a student', () => {
  let s = withKitchen({}, 'a', 3)
  assert.deepEqual(s, { a: 3 })
  s = withKitchen(s, 'a', 5)
  assert.deepEqual(s, { a: 5 })
  assert.deepEqual(withKitchen(s, 'a', null), {})
})

test('standing kitchens seed from the most recently touched lab', () => {
  const older = { committed: { students: { a: { kitchen: 1 }, b: { kitchen: 2 } } }, committedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
  const newer = { committed: null, draft: { students: { a: { kitchen: 4 }, b: { kitchen: null } } }, updatedAt: '2026-10-20T00:00:00Z' }
  assert.deepEqual(standingFromLatestLab([older, newer]), { students: { a: 4 } })
  assert.equal(standingFromLatestLab([{}, { committed: null, draft: null }]), null)
})

test('a lab with no stored state starts students in their usual kitchen', () => {
  const roster = [{ userId: 'a' }, { userId: 'b' }]
  const sec = buildSection(roster, null, {}, { students: { a: 6 } })
  assert.equal(sec.students.a.kitchen, 6)
  assert.equal(sec.students.b.kitchen, null)
})

test('a lab that already placed a student keeps that placement over the usual one', () => {
  const roster = [{ userId: 'a' }]
  const prior = { kitchens: {}, students: { a: { kitchen: 2, flagIds: [], present: true } } }
  assert.equal(buildSection(roster, prior, {}, { students: { a: 6 } }).students.a.kitchen, 2)
})

test('standing kitchens sync across devices', () => {
  assert.ok(isSyncedKey('kitchens/123'))
})
