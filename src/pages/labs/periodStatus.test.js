import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uncommittedPeriods } from './periodStatus.js'

const sections = [{ id: 's1', name: '1A' }, { id: 's2', name: '2A' }, { id: 's3', name: '2B' }]

test('lists periods whose lab day has come but are not committed', () => {
  const entries = [{ id: 'L', name: 'Thickener Activity Professionalism', dates: { s1: '2026-11-02', s2: '2026-11-02', s3: '2026-11-03' } }]
  const states = { L: { s1: { committed: { students: {} }, draft: null }, s2: { committed: null, draft: { students: {} } } } }
  const due = uncommittedPeriods(entries, states, sections, '2026-11-02')
  assert.deepEqual(due.map(d => [d.sectionName, d.status]), [['2A', 'draft']], '1A is committed; 2B is tomorrow')
})

test('a commit with edits since still counts as not committed', () => {
  const entries = [{ id: 'L', name: 'X', dates: { s1: '2026-11-01' } }]
  const states = { L: { s1: { committed: { students: { a: { present: true } } }, draft: { students: { a: { present: false } } } } } }
  assert.equal(uncommittedPeriods(entries, states, sections, '2026-11-02').length, 1)
})

test('lab days older than a week, and periods with no lab date, are left out', () => {
  const entries = [{ id: 'L', name: 'X', dates: { s1: '2026-10-20' } }, { id: 'M', name: 'Y', dates: {} }]
  assert.deepEqual(uncommittedPeriods(entries, {}, sections, '2026-11-02'), [])
})
