import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshState, blankBlock, normalizeState, setAbsent, seatOrder, blockLabel, staffedKitchenIdxs } from './model.js'
import { assignDayDuties, blockDisplay } from './duties.js'
import { advanceBlock, rotateBlocks, snapshotBlocks, applyUndo, saveOriginal, restoreOriginal } from './rotation.js'
import { appendRecords, emptyHistory, removeBatch, participationRows, HISTORY_CAP } from './history.js'
import { computeGroupCount, seatShuffled, placeStudent, nudgeStudent, removeDeparted, unseatedIds, matchSection, displayNames, shortName } from './roster.js'

const TODAY = '2026-11-04'

// A state with blocks on A day: setup({ A1: [['a','b','c','d']], A2: [...] })
function setup(blocks, duties = []) {
  const s = freshState()
  Object.entries(blocks).forEach(([id, kitchens], i) => {
    s.blocks[id] = blankBlock('A')
    kitchens.forEach((students, ki) => { s.blocks[id].kitchens[ki].students = students.slice() })
    s.slots.A[i] = id
  })
  s.duties = duties.map(text => ({ text, apply: Object.fromEntries(Object.keys(blocks).map(id => [id, true])) }))
  return s
}
const students = (s, id, ki = 0) => s.blocks[id].kitchens[ki].students

// --- rotation ---

test('advancing moves everyone down one job and the bottom student to the top', () => {
  const s = setup({ A1: [['a', 'b', 'c', 'd']] })
  advanceBlock(s, 'A1')
  assert.deepEqual(students(s, 'A1'), ['d', 'a', 'b', 'c'])
  advanceBlock(s, 'A1')
  assert.deepEqual(students(s, 'A1'), ['c', 'd', 'a', 'b'])
})

test('a rotation clears attendance and moves the duty and sink cursors', () => {
  const s = setup({ A1: [['a', 'b'], ['c']] }, ['Sweep', 'Mop'])
  setAbsent(s.blocks.A1, 'a', true, TODAY)
  advanceBlock(s, 'A1')
  assert.equal(s.blocks.A1.dutyIndex, 1)
  assert.equal(s.blocks.A1.centerSink, 1)
  assert.deepEqual(s.blocks.A1.absent, {})
})

test('a class with everyone out still turns its seats but keeps its duty', () => {
  const s = setup({ A1: [['a', 'b']] }, ['Sweep', 'Mop'])
  setAbsent(s.blocks.A1, 'a', true, TODAY)
  setAbsent(s.blocks.A1, 'b', true, TODAY)
  advanceBlock(s, 'A1')
  assert.deepEqual(students(s, 'A1'), ['b', 'a'])
  assert.equal(s.blocks.A1.dutyIndex, 0)
  assert.equal(s.blocks.A1.centerSink, 0)
})

test('rotating a day records every class before any advances, and undo puts it all back', () => {
  const s = setup({ A1: [['a', 'b']], A2: [['c', 'd']], A3: [] }, ['Sweep', 'Mop'])
  const before = { A1: blockDisplay(s, 'A1').duties, A2: blockDisplay(s, 'A2').duties }
  const snap = snapshotBlocks(s, ['A1', 'A2', 'A3'], 'Rotate A Day', 'batch1')
  const records = rotateBlocks(s, ['A1', 'A2', 'A3'], { batchId: 'batch1', today: TODAY })
  assert.equal(records.length, 2, 'A3 is empty, so it is not recorded')
  assert.equal(records[1].k[0].du, before.A2[0], 'A2 recorded the duty it actually did, not one reassigned by A1 advancing')
  assert.deepEqual(students(s, 'A1'), ['b', 'a'])
  applyUndo(s, snap)
  assert.deepEqual(students(s, 'A1'), ['a', 'b'])
  assert.deepEqual(students(s, 'A2'), ['c', 'd'])
  assert.equal(s.blocks.A1.dutyIndex, 0)
})

test('undo keeps attendance taken after the rotation', () => {
  const s = setup({ A1: [['a', 'b', 'c']] })
  const snap = snapshotBlocks(s, ['A1'], 'Advance A1', 'x')
  advanceBlock(s, 'A1')
  setAbsent(s.blocks.A1, 'a', true, TODAY)
  applyUndo(s, snap)
  assert.deepEqual(students(s, 'A1'), ['a', 'b', 'c'])
  assert.deepEqual(s.blocks.A1.absent, { a: true })
})

test('undo never re-seats a student who was unseated since, nor drops one seated since', () => {
  const s = setup({ A1: [['a', 'b'], ['c']] })
  const snap = snapshotBlocks(s, ['A1'], 'Advance A1', 'x')
  advanceBlock(s, 'A1')
  s.blocks.A1.kitchens[0].students = ['a']          // b unseated
  s.blocks.A1.kitchens[1].students = ['c', 'n']     // n placed
  applyUndo(s, snap)
  assert.deepEqual(students(s, 'A1', 0), ['a'])
  assert.ok(s.blocks.A1.kitchens.some(k => k.students.includes('n')))
})

test('restore to original puts back the saved seating and resets the cursors', () => {
  const s = setup({ A1: [['a', 'b', 'c']] }, ['Sweep'])
  saveOriginal(s, 'A1')
  advanceBlock(s, 'A1'); advanceBlock(s, 'A1')
  restoreOriginal(s, 'A1')
  assert.deepEqual(students(s, 'A1'), ['a', 'b', 'c'])
  assert.equal(s.blocks.A1.dutyIndex, 0)
})

test('restore keeps a student seated after the original was saved, and drops one who left', () => {
  const s = setup({ A1: [['a', 'b', 'c']] })
  saveOriginal(s, 'A1')
  s.blocks.A1.kitchens[0].students = ['c', 'a', 'n'] // b left, n joined, rotated
  restoreOriginal(s, 'A1')
  assert.deepEqual(students(s, 'A1'), ['a', 'c', 'n'])
})

// --- attendance ---

test('absent students drop below the present ones, so the present take the top jobs', () => {
  const s = setup({ A1: [['a', 'b', 'c']] })
  setAbsent(s.blocks.A1, 'a', true, TODAY)
  assert.deepEqual(seatOrder(s.blocks.A1, 0), ['b', 'c', 'a'])
  assert.deepEqual(students(s, 'A1'), ['a', 'b', 'c'], 'the rotation cycle itself is untouched')
})

test("yesterday's absences expire when the state is loaded", () => {
  const s = setup({ A1: [['a', 'b']] })
  setAbsent(s.blocks.A1, 'a', true, '2026-11-03')
  const loaded = normalizeState(JSON.parse(JSON.stringify(s)), TODAY)
  assert.deepEqual(loaded.blocks.A1.absent, {})
  const sameDay = normalizeState(JSON.parse(JSON.stringify(s)), '2026-11-03')
  assert.deepEqual(sameDay.blocks.A1.absent, { a: true })
})

// --- duties ---

test('one physical kitchen never draws the same duty twice in a day', () => {
  const s = setup({ A1: [['a'], ['b'], ['c']], A2: [['d'], ['e'], ['f']], A3: [['g'], ['h'], ['i']] }, ['One', 'Two', 'Three'])
  for (let day = 0; day < 4; day++) {
    const out = assignDayDuties(s, 'A')
    for (let ki = 0; ki < 3; ki++) {
      const drawn = ['A1', 'A2', 'A3'].map(id => out[id][ki])
      assert.equal(new Set(drawn).size, 3, `rotation ${day}, K${ki + 1} drew ${drawn}`)
    }
    rotateBlocks(s, ['A1', 'A2', 'A3'], { batchId: String(day), today: TODAY })
  }
})

test('a kitchen with everyone out draws no duty and has no sink', () => {
  const s = setup({ A1: [['a'], ['b']] }, ['Sweep', 'Mop'])
  setAbsent(s.blocks.A1, 'b', true, TODAY)
  const { duties, sinks } = blockDisplay(s, 'A1')
  assert.ok(duties[0])
  assert.equal(duties[1], undefined)
  assert.deepEqual(staffedKitchenIdxs(s.blocks.A1), [0])
  assert.deepEqual(sinks, { 0: true }, 'its partner is out, so K1 keeps the sink')
})

test('paired kitchens take turns at the center sink; an unpaired one keeps it', () => {
  const s = setup({ A1: [['a'], ['b'], [], [], ['e'], [], ['g']] })
  assert.deepEqual(blockDisplay(s, 'A1').sinks, { 0: true, 1: false, 4: true, 6: true })
  advanceBlock(s, 'A1')
  assert.deepEqual(blockDisplay(s, 'A1').sinks, { 0: false, 1: true, 4: true, 6: true })
})

// --- history ---

test('records hold ids in display order with absences, and are capped per class', () => {
  const s = setup({ A1: [['a', 'b', 'c']] }, ['Sweep'])
  setAbsent(s.blocks.A1, 'a', true, TODAY)
  const [rec] = rotateBlocks(s, ['A1'], { batchId: 'b1', today: TODAY })
  assert.deepEqual(rec.k[0].s, ['b', 'c', 'a'])
  assert.deepEqual(rec.k[0].ab, ['a'])
  let h = appendRecords(emptyHistory(), [rec])
  assert.equal(h.records[0]._id, undefined)
  const rows = participationRows([{ label: 'A1', day: 'A', records: h.records }], id => id.toUpperCase())
  assert.deepEqual(rows[1], [TODAY, 'A', 'A1', 'Culinary 1', 'K1', 'Manager', 'B', 'Present', 'Sweep', 'Yes'])
  assert.deepEqual(rows[3].slice(5, 8), ['Sous Chef', 'A', 'Absent'], 'the absent student sits below the present ones')
  for (let i = 0; i < HISTORY_CAP + 5; i++) h = appendRecords(h, [{ ...rec, b: `x${i}` }])
  assert.equal(h.records.length, HISTORY_CAP)
  assert.equal(removeBatch(h, 'x0').records.length, HISTORY_CAP, 'x0 already dropped off')
  assert.equal(removeBatch(h, `x${HISTORY_CAP + 4}`).records.length, HISTORY_CAP - 1)
})

// --- roster ---

test('class sizes split about 4 to a kitchen, 3s before 5s, never over 8 kitchens', () => {
  assert.equal(computeGroupCount(16), 4)
  assert.equal(computeGroupCount(27), 7)
  assert.equal(computeGroupCount(10), 3)
  assert.equal(computeGroupCount(40), 8)
  const s = setup({ A1: [] })
  const ids = Array.from({ length: 27 }, (_, i) => `s${i}`)
  assert.deepEqual(seatShuffled(s.blocks.A1, ids, () => 0.5), [])
  const sizes = s.blocks.A1.kitchens.map(k => k.students.length).filter(Boolean)
  assert.equal(sizes.length, 7)
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1)
})

test('placing, nudging and departures', () => {
  const s = setup({ A1: [['a', 'b', 'c', 'd', 'e'], ['f']] })
  const b = s.blocks.A1
  assert.equal(placeStudent(b, 'f', 0), false, 'a kitchen of 5 is full')
  assert.equal(placeStudent(b, 'a', 1), true)
  assert.deepEqual(students(s, 'A1', 1), ['f', 'a'])
  assert.equal(nudgeStudent(b, 'a', -1), true)
  assert.deepEqual(students(s, 'A1', 1), ['a', 'f'])
  assert.deepEqual(removeDeparted(b, []), [], 'an empty section is a Canvas hiccup, not a class that left')
  assert.deepEqual(removeDeparted(b, ['a', 'b', 'c', 'd', 'n']), ['e', 'f'])
  assert.deepEqual(unseatedIds(b, ['a', 'b', 'c', 'd', 'n']), ['n'])
})

test('section names map to A/B blocks', () => {
  assert.deepEqual(matchSection('1A'), { day: 'A', pos: 0 })
  assert.deepEqual(matchSection('6B'), { day: 'B', pos: 1 })
  assert.deepEqual(matchSection('Period 3 A'), { day: 'A', pos: 2 })
  assert.deepEqual(matchSection('Culinary 1 - B4'), { day: 'B', pos: 3 })
  assert.equal(matchSection('Culinary 1'), null)
})

test('board names are first name + last initial, longer only where two clash', () => {
  assert.equal(shortName('Archer, Kelly Noel'), 'Kelly A.')
  const names = displayNames([
    { id: '1', sortableName: 'Archer, Kelly' },
    { id: '2', sortableName: 'Adams, Kelly' },
    { id: '3', sortableName: 'Bowman, Cache' },
  ])
  assert.deepEqual(names, { 1: 'Kelly Ar.', 2: 'Kelly Ad.', 3: 'Cache B.' })
})

// --- repair ---

test('a damaged or merged state loads: missing blocks become prep, no student sits twice', () => {
  const s = setup({ A1: [['a', 'b'], ['b', 'c']] })
  s.slots.A[1] = 'GONE'
  s.slots.B[0] = 'A1'
  const n = normalizeState(JSON.parse(JSON.stringify(s)), TODAY)
  assert.deepEqual(n.slots.A, ['A1', null, null, null])
  assert.deepEqual(n.slots.B, [null, null, null, null])
  assert.deepEqual(n.blocks.A1.kitchens[1].students, ['c'])
  assert.equal(n.nextNum.A, 2)
  assert.equal(blockLabel(n, 'A1'), 'A1')
  assert.deepEqual(normalizeState(null, TODAY), freshState())
})
