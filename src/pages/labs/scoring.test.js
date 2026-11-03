import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreStudent, scoreFromDeductions, isUnitScore, isProfessionalismAssignment } from './scoring.js'

// labs: array of { score, points? } — score is a number, null (blank/ungraded),
// or 'EX' (excused). points defaults to 4 (the common case in the table).
function score(labs) {
  const defs = labs.map((l, i) => ({ id: `l${i}`, name: `Lab ${i + 1}`, pointsPossible: l.points ?? 4 }))
  const subs = {}
  labs.forEach((l, i) => {
    if (l.score === 'EX') subs[`l${i}`] = { score: null, excused: true }
    else subs[`l${i}`] = { score: l.score, excused: false }
  })
  return scoreStudent(subs, defs).value
}

// Plain average on a 4-point scale; nothing dropped, no automatic zero (DECISIONS.md, 2026-11-02).
test('two labs average', () => {
  assert.equal(score([{ score: 4 }, { score: 3 }]), 3.5)
})

test('a missed lab counts as 0 in the average, not as a unit zero', () => {
  assert.equal(score([{ score: 4 }, { score: 0 }]), 2)
  assert.equal(score([{ score: 4 }, { score: 4 }, { score: 0 }, { score: 0 }]), 2)
})

test('the lowest lab is not dropped', () => {
  assert.equal(score([{ score: 4 }, { score: 4 }, { score: 1 }]), 3)
})

test('a single missed lab is 0', () => {
  assert.equal(score([{ score: 0 }]), 0)
})

test('excused and blank labs are not counted', () => {
  assert.equal(score([{ score: 3 }, { score: 'EX' }, { score: null }]), 3)
})

test('nothing counted gives no score', () => {
  assert.equal(score([{ score: null }, { score: 'EX' }]), null)
})

test('rounded to 2 decimals', () => {
  assert.equal(score([{ score: 4 }, { score: 3 }, { score: 3 }]), 3.33)
})

test('scaled to 4 points', () => {
  assert.equal(score([{ score: 10, points: 10 }, { score: 5, points: 10 }]), 3)
})

test('a makeup raises the score in an even step (no cliff)', () => {
  const before = score([{ score: 4 }, { score: 0 }, { score: 0 }, { score: 4 }])
  const after = score([{ score: 4 }, { score: 3 }, { score: 0 }, { score: 4 }])
  assert.deepEqual([before, after], [2, 2.75])
})

test('deductions: no marks is full marks', () => {
  assert.equal(scoreFromDeductions(0), 4)
})

test('deductions: default table matches the confirmed staircase', () => {
  assert.equal(scoreFromDeductions(1), 3)
  assert.equal(scoreFromDeductions(2), 3)
  assert.equal(scoreFromDeductions(3), 2)
  assert.equal(scoreFromDeductions(4), 2)
  assert.equal(scoreFromDeductions(5), 1)
  assert.equal(scoreFromDeductions(6), 1)
  assert.equal(scoreFromDeductions(7), 0)
})

test('deductions: never goes below 0', () => {
  assert.equal(scoreFromDeductions(20), 0)
})

test('deductions: custom step sizes', () => {
  assert.equal(scoreFromDeductions(1, { pointsPerStep: 2, marksPerStep: 1 }), 2)
  assert.equal(scoreFromDeductions(2, { pointsPerStep: 2, marksPerStep: 1 }), 0)
})

// isUnitScore / isProfessionalismAssignment — must never both match the same assignment name.
test('isUnitScore matches a unit-score assignment', () => {
  assert.equal(isUnitScore('Safety and Sanitation Professionalism (Unit Score)'), true)
})

test('isUnitScore does not match a plain lab professionalism assignment', () => {
  assert.equal(isUnitScore('Cobb Salad Lab Professionalism'), false)
})

test('isProfessionalismAssignment and isUnitScore are mutually exclusive for a unit-score assignment', () => {
  const name = 'Safety and Sanitation Professionalism (Unit Score)'
  assert.equal(isProfessionalismAssignment(name), false)
  assert.equal(isUnitScore(name), true)
})
