import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileScope } from './scopeDiff.js'

const sections = [
  { id: 's1', name: '1A' },
  { id: 's2', name: '2A' },
  { id: 's3', name: '2B' },
  { id: 's4', name: '3' }, // untagged — no dayType set
]
const courseSetup = { sections: { s1: { dayType: 'A' }, s2: { dayType: 'A' }, s3: { dayType: 'B' } } }

test("'all' never touches overrides, regardless of what's covered", () => {
  const { toAdd, toRemove } = reconcileScope(sections, courseSetup, ['s3'], 'all')
  assert.deepEqual(toAdd, [])
  assert.deepEqual(toRemove, [])
})

test('narrowing to A-day adds every A-day section not yet covered', () => {
  const { toAdd, toRemove } = reconcileScope(sections, courseSetup, [], 'A')
  assert.deepEqual(toAdd.map(s => s.id).sort(), ['s1', 's2'])
  assert.deepEqual(toRemove, [])
})

test('narrowing to A-day removes a covered B-day section', () => {
  const { toAdd, toRemove } = reconcileScope(sections, courseSetup, ['s1', 's2', 's3'], 'A')
  assert.deepEqual(toAdd, []) // s1 and s2 already covered
  assert.deepEqual(toRemove, ['s3'])
})

test('an untagged section is never added by a scoped target', () => {
  const { toAdd } = reconcileScope(sections, courseSetup, [], 'B')
  assert.deepEqual(toAdd.map(s => s.id), ['s3'])
})

test('already-exact coverage needs no change', () => {
  const { toAdd, toRemove } = reconcileScope(sections, courseSetup, ['s1', 's2'], 'A')
  assert.deepEqual(toAdd, [])
  assert.deepEqual(toRemove, [])
})
