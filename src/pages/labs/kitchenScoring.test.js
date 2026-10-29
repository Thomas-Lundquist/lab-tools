import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kitchenScore, studentScore, ABSENT_SCORE } from './kitchenScoring.js'
import { countKitchenSeverities } from '../../config/labFlags.js'

// --- kitchenScore thresholds ---

test('clean kitchen scores 3, not 4', () => {
  assert.equal(kitchenScore(0, 0, false), 3)
})

test('exceeded toggle lifts a clean kitchen to 4', () => {
  assert.equal(kitchenScore(0, 0, true), 4)
})

test('two minors drop to 2', () => {
  assert.equal(kitchenScore(2, 0, false), 2)
})

test('one critical drops to 2', () => {
  assert.equal(kitchenScore(0, 1, false), 2)
})

test('four minors drop to 1', () => {
  assert.equal(kitchenScore(4, 0, false), 1)
})

test('two criticals drop to 1', () => {
  assert.equal(kitchenScore(0, 2, false), 1)
})

test('one minor still scores 3 (below the 2-minor floor)', () => {
  assert.equal(kitchenScore(1, 0, false), 3)
})

test('three minors sit at 2 (between the 2 and 4 thresholds)', () => {
  assert.equal(kitchenScore(3, 0, false), 2)
})

test('a crossed threshold overrides the exceeded toggle', () => {
  // A critical crosses the 1-critical threshold, so the 2-band wins even if
  // exceeded was left on.
  assert.equal(kitchenScore(0, 1, true), 2)
})

test('a single minor flag stays in the top band, so exceeded still applies', () => {
  // One minor is below the 2-minor floor, so the else-branch runs: exceeded -> 4.
  assert.equal(kitchenScore(1, 0, true), 4)
  assert.equal(kitchenScore(1, 0, false), 3)
})

// --- studentScore: individual flags drop one tier each, floor at 1 ---

test('no individual flags keeps the kitchen score', () => {
  assert.equal(studentScore(3, 0), 3)
})

test('each individual flag drops one tier', () => {
  assert.equal(studentScore(3, 1), 2)
  assert.equal(studentScore(4, 2), 2)
})

test('student score never drops below 1', () => {
  assert.equal(studentScore(1, 3), 1)
  assert.equal(studentScore(2, 5), 1)
})

test('absent is a separate zero, outside studentScore', () => {
  assert.equal(ABSENT_SCORE, 0)
})

// --- countKitchenSeverities bridges stored flag ids to the score inputs ---

test('counts minor and critical kitchen flags by id', () => {
  const { minor, critical } = countKitchenSeverities([
    'floor-not-swept',          // minor
    'dishes-left-unwashed',     // minor
    'equipment-on-unattended',  // critical
  ])
  assert.equal(minor, 2)
  assert.equal(critical, 1)
})

test('unknown or individual ids are ignored, not counted as kitchen flags', () => {
  const { minor, critical } = countKitchenSeverities([
    'phone-out',        // individual scope — not a kitchen flag
    'removed-long-ago', // unknown id from an old saved lab
    'floor-not-swept',  // minor
  ])
  assert.equal(minor, 1)
  assert.equal(critical, 0)
})

// --- end-to-end: stored ids -> derived student score ---

test('derives a student score from stored kitchen + individual flags', () => {
  const { minor, critical } = countKitchenSeverities(['floor-not-swept', 'burners-left-on']) // 2 minor -> 2
  const ks = kitchenScore(minor, critical, false)
  assert.equal(ks, 2)
  assert.equal(studentScore(ks, 1), 1) // one individual flag -> 1
})
