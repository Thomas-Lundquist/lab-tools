import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptySection, isUnsavedDraft, deriveStudentScore, deriveSectionScores,
  toggleKitchenFlag, setKitchenExceeded, toggleStudentFlag, setStudentKitchen, setPresent,
} from './labGrading.js'

// A small section: kitchen 1 has two minor flags (-> kitchenScore 2); two
// students, one of them absent.
function sampleSection() {
  return {
    kitchens: {
      1: { flagIds: ['floor-not-swept', 'burners-left-on'], exceeded: false }, // 2 minor -> 2
      2: { flagIds: [], exceeded: true },                                       // clean + exceeded -> 4
    },
    students: {
      s1: { kitchen: 1, flagIds: ['phone-out'], present: true }, // kitchen 2 minus 1 individual -> 1
      s2: { kitchen: 1, flagIds: [], present: false },           // absent -> 0
      s3: { kitchen: 2, flagIds: [], present: true },            // exceeded kitchen -> 4
    },
    updatedAt: null,
    committedAt: null,
  }
}

// --- deriveStudentScore ---

test('present student: kitchen score minus individual flags', () => {
  assert.equal(deriveStudentScore(sampleSection(), 's1'), 1)
})

test('absent student scores 0 regardless of kitchen flags', () => {
  assert.equal(deriveStudentScore(sampleSection(), 's2'), 0)
})

test('exceeded kitchen flows through to the student', () => {
  assert.equal(deriveStudentScore(sampleSection(), 's3'), 4)
})

test('unknown student derives null', () => {
  assert.equal(deriveStudentScore(sampleSection(), 'nope'), null)
})

test('deriveSectionScores returns every student', () => {
  assert.deepEqual(deriveSectionScores(sampleSection()), { s1: 1, s2: 0, s3: 4 })
})

// --- isUnsavedDraft ---

test('fresh empty section is not an unsaved draft', () => {
  assert.equal(isUnsavedDraft(emptySection()), false)
})

test('edited-but-never-committed is an unsaved draft', () => {
  assert.equal(isUnsavedDraft({ updatedAt: '2026-10-28T10:00:00.000Z', committedAt: null }), true)
})

test('committed with no later edit is NOT a draft', () => {
  const t = '2026-10-28T10:00:00.000Z'
  assert.equal(isUnsavedDraft({ updatedAt: t, committedAt: t }), false)
})

test('edit after a commit is an unsaved draft', () => {
  assert.equal(isUnsavedDraft({
    updatedAt: '2026-10-28T10:05:00.000Z',
    committedAt: '2026-10-28T10:00:00.000Z',
  }), true)
})

// --- pure transforms: moving a student between kitchens (absence swap) ---

test('moving a student to a new kitchen rescoreds them', () => {
  let section = sampleSection()
  // s1 was in kitchen 1 (-> 1 after their individual flag). Move to kitchen 2 (exceeded).
  section = setStudentKitchen(section, 's1', 2)
  assert.equal(deriveStudentScore(section, 's1'), 3) // kitchen 4, minus one individual flag
})

test('toggling a kitchen flag updates every present student in it', () => {
  let section = sampleSection()
  // A critical crosses the 1-critical threshold, so the kitchen drops to 2 and
  // the exceeded toggle no longer applies.
  section = toggleKitchenFlag(section, 2, 'equipment-on-unattended')
  assert.equal(deriveStudentScore(section, 's3'), 2)
})

test('a single minor flag does not cancel exceeded (below the threshold)', () => {
  let section = sampleSection()
  section = toggleKitchenFlag(section, 2, 'dishes-left-unwashed') // 1 minor, below the 2-minor floor
  assert.equal(deriveStudentScore(section, 's3'), 4) // still exceeded -> 4
})

test('clearing exceeded drops a clean kitchen from 4 to 3', () => {
  let section = sampleSection()
  section = setKitchenExceeded(section, 2, false)
  assert.equal(deriveStudentScore(section, 's3'), 3)
})

test('toggling an individual flag is reversible', () => {
  let section = sampleSection()
  section = toggleStudentFlag(section, 's3', 'ignored-correction') // 4 -> 3
  assert.equal(deriveStudentScore(section, 's3'), 3)
  section = toggleStudentFlag(section, 's3', 'ignored-correction') // back to 4
  assert.equal(deriveStudentScore(section, 's3'), 4)
})

test('marking present/absent flips the score to and from zero', () => {
  let section = sampleSection()
  section = setPresent(section, 's3', false)
  assert.equal(deriveStudentScore(section, 's3'), 0)
  section = setPresent(section, 's3', true)
  assert.equal(deriveStudentScore(section, 's3'), 4)
})
