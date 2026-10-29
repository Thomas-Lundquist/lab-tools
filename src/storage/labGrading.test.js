import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyState, isUnsavedDraft, activeSection, deriveStudentScore, deriveSectionScores,
  toggleKitchenFlag, setKitchenExceeded, toggleStudentFlag, setStudentKitchen, setPresent, setStudentExceeded,
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

// --- isUnsavedDraft / activeSection (two-slot: committed vs draft) ---

test('fresh empty state is not an unsaved draft', () => {
  assert.equal(isUnsavedDraft(emptyState()), false)
})

test('a populated draft slot is an unsaved draft', () => {
  assert.equal(isUnsavedDraft({ committed: null, draft: { kitchens: {}, students: {} } }), true)
})

test('committed with no draft is NOT a draft', () => {
  assert.equal(isUnsavedDraft({ committed: { kitchens: {}, students: {} }, committedAt: 't', draft: null }), false)
})

test('activeSection prefers the draft, then committed, then empty', () => {
  const committed = { kitchens: { 1: { flagIds: [], exceeded: true } }, students: {} }
  const draft = { kitchens: { 1: { flagIds: ['floor-not-swept'], exceeded: false } }, students: {} }
  assert.equal(activeSection({ draft, committed }), draft)
  assert.equal(activeSection({ draft: null, committed }), committed)
  assert.deepEqual(activeSection(emptyState()), { kitchens: {}, students: {} })
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

test('individual exceeded lifts one student to 4 even when the kitchen is not', () => {
  let section = sampleSection() // s1 is in kitchen 1 (2 minor -> kitchen score 2)
  // Clear s1's individual flag first, then mark them exceeded.
  section = toggleStudentFlag(section, 's1', 'phone-out') // remove the flag
  section = setStudentExceeded(section, 's1', true)
  assert.equal(deriveStudentScore(section, 's1'), 4)
})

test('individual exceeded is ignored when the student has an individual flag', () => {
  let section = sampleSection() // s1 has one individual flag (phone-out)
  section = setStudentExceeded(section, 's1', true)
  assert.equal(deriveStudentScore(section, 's1'), 1) // flag wins: kitchen 2 minus 1 flag
})

test('individual exceeded does not change other students in the kitchen', () => {
  let section = sampleSection()
  section = toggleStudentFlag(section, 's1', 'phone-out')
  section = setStudentExceeded(section, 's1', true)
  // s2 shares kitchen 1 but is absent -> still 0; nobody else is lifted.
  assert.equal(deriveStudentScore(section, 's2'), 0)
})

test('marking present/absent flips the score to and from zero', () => {
  let section = sampleSection()
  section = setPresent(section, 's3', false)
  assert.equal(deriveStudentScore(section, 's3'), 0)
  section = setPresent(section, 's3', true)
  assert.equal(deriveStudentScore(section, 's3'), 4)
})
