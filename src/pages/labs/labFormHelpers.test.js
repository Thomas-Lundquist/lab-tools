import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeScope, inferScope } from './labFormHelpers.js'

const sections = [{ id: 's1', name: 'A1' }, { id: 's2', name: 'A2' }, { id: 's5', name: 'B1' }, { id: 's6', name: 'B2' }]
const setup = { sections: { s1: { dayType: 'A' }, s2: { dayType: 'A' }, s5: { dayType: 'B' }, s6: { dayType: 'B' } } }
const scoped = ids => ({ onlyVisibleToOverrides: true, overrides: ids.map(id => ({ courseSectionId: id })) })

test('visible to everyone, or covering every period, reads as All periods', () => {
  assert.equal(describeScope({ onlyVisibleToOverrides: false }, setup, sections).label, 'All periods')
  assert.equal(describeScope(scoped(['s1', 's2', 's5', 's6']), setup, sections).label, 'All periods')
})

test('one day type reads as A day or B day', () => {
  assert.equal(describeScope(scoped(['s1']), setup, sections).label, 'A day')
  assert.equal(describeScope(scoped(['s5', 's6']), setup, sections).label, 'B day')
})

test('a lab run on both A and B days lists its periods instead of "Custom"', () => {
  const a = scoped(['s5', 's1', 's2'])
  assert.equal(inferScope(a, setup), 'custom')
  const d = describeScope(a, setup, sections)
  assert.equal(d.label, 'A1, A2, B1', 'in section order')
  assert.equal(d.kind, 'periods')
  assert.deepEqual(d.noDayType, [])
})

test('a period with no A/B day set is listed and flagged', () => {
  const d = describeScope(scoped(['s1', 's9']), setup, [...sections, { id: 's9', name: 'Period 9' }])
  assert.equal(d.label, 'A1, Period 9')
  assert.deepEqual(d.noDayType, ['Period 9'])
})

test('student-only or empty overrides say so', () => {
  assert.equal(describeScope({ onlyVisibleToOverrides: true, overrides: [{ studentIds: ['u1'] }] }, setup, sections).label, 'Individual students')
  assert.equal(describeScope({ onlyVisibleToOverrides: true, overrides: [] }, setup, sections).label, 'No periods')
  assert.equal(describeScope(null, setup, sections), null)
})
