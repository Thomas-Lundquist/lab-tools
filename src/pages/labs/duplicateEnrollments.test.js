import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDuplicateEnrollments } from './duplicateEnrollments.js'

const sections = [
  { id: 's1', name: '1A', studentIds: ['a', 'b'] },
  { id: 's2', name: '2A', studentIds: ['b', 'c'] },
  { id: 's3', name: '2B', studentIds: ['c'] },
]

test('a student in two sections is a duplicate; one in one section is not', () => {
  const dupes = findDuplicateEnrollments(sections)
  assert.deepEqual(dupes.map(d => d.studentId).sort(), ['b', 'c'])
})

test('a student already excluded down to one active section stays listed, reversibly', () => {
  const dupes = findDuplicateEnrollments(sections, { s1: ['b'] })
  const b = dupes.find(d => d.studentId === 'b')
  assert.deepEqual(b.sectionIds.sort(), ['s1', 's2'])
  assert.deepEqual(b.activeSectionIds, ['s2'])
})

test('a student excluded from neither section stays a duplicate, with both as active', () => {
  const dupes = findDuplicateEnrollments(sections, { s3: ['someone-else'] })
  const b = dupes.find(d => d.studentId === 'b')
  assert.deepEqual(b.activeSectionIds.sort(), ['s1', 's2'])
})

test('no sections, no duplicates', () => {
  assert.deepEqual(findDuplicateEnrollments([]), [])
})
