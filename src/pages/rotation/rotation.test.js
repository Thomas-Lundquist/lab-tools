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

// --- linked to Labs: home kitchens, today's lab, visitors (DECISIONS.md, 2026-11-14) ---

import { dayView, overLimitIdxs } from './model.js'
import { reconcileSeating } from './roster.js'
import { pickTodaysLab, labAttendance } from './today.js'
import { buildRotationRecord } from './history.js'

const att = (absent = [], kitchen = {}) => ({ absent: new Set(absent), kitchen, labName: 'Lab 4' })

test('dayView: absent students leave the job rows and keep their rotation place', () => {
  const s = setup({ A1: [['a', 'b', 'c', 'd']] })
  const v = dayView(s.blocks.A1, att(['b']))
  assert.deepEqual(v.kitchens[0].working, ['a', 'c', 'd'])
  assert.deepEqual(students(s, 'A1'), ['a', 'b', 'c', 'd'], 'stored order untouched')
  assert.equal(v.source, 'lab')
})

test('dayView: a student moved in the Lab tab works in the new kitchen as a visitor, after its crew', () => {
  const s = setup({ A1: [['a', 'b'], ['c', 'd']] })
  const v = dayView(s.blocks.A1, att([], { a: 1, b: 0, c: 1 }))
  assert.deepEqual(v.kitchens[0].working, ['b'])
  assert.deepEqual(v.kitchens[1].working, ['c', 'd', 'a'])
  assert.deepEqual([...v.kitchens[1].visitors], ['a'])
})

test('dayView: your scenario — full kitchen, two out, two visitors in, stays at four working', () => {
  const s = setup({ A1: [['a', 'b', 'c', 'd'], ['e', 'f']] })
  const v = dayView(s.blocks.A1, att(['c', 'd'], { e: 0, f: 0 }))
  assert.deepEqual(v.kitchens[0].working, ['a', 'b', 'e', 'f'])
  assert.deepEqual(overLimitIdxs(v), [])
  // ...and both absentees coming back pushes it to six, which is flagged, not blocked.
  const back = dayView(s.blocks.A1, att([], { e: 0, f: 0 }))
  assert.deepEqual(overLimitIdxs(back), [0])
})

test('dayView with no lab uses the rotator’s own marks', () => {
  const s = setup({ A1: [['a', 'b']] })
  setAbsent(s.blocks.A1, 'a', true, TODAY)
  const v = dayView(s.blocks.A1, null)
  assert.deepEqual(v.kitchens[0].working, ['b'])
  assert.equal(v.source, 'rotator')
  assert.deepEqual(staffedKitchenIdxs(s.blocks.A1), [0])
})

test('a kitchen staffed only by visitors gets a duty and counts as staffed', () => {
  const s = setup({ A1: [['a', 'b'], ['c']] }, ['Sweep', 'Mop'])
  const views = { A1: dayView(s.blocks.A1, att(['c'], { a: 2 })) }
  assert.deepEqual(staffedKitchenIdxs(s.blocks.A1, views.A1), [0, 2])
  const d = blockDisplay(s, 'A1', views).duties
  assert.ok(d[2], 'K3 has a duty')
  assert.equal(d[1], undefined, 'K2, all out, has none')
})

test('records list visitors under the kitchen they worked in, and absentees as Absent', () => {
  const s = setup({ A1: [['a', 'b'], ['c', 'd']] })
  const views = { A1: dayView(s.blocks.A1, att(['b'], { c: 0 })) }
  const rec = buildRotationRecord(s, 'A1', { batchId: 'x', today: TODAY, views })
  const k1 = rec.k.find(k => k.i === 0)
  assert.deepEqual(k1.s, ['a', 'c', 'b'])
  assert.deepEqual(k1.ab, ['b'])
  assert.deepEqual(k1.v, ['c'])
  const rows = participationRows([{ label: 'A1', day: 'A', records: [rec] }], id => id.toUpperCase())
  assert.deepEqual(rows.filter(r => r[4] === 'K1').map(r => [r[6], r[7]]), [['A', 'Present'], ['C', 'Visiting'], ['B', 'Absent']])
})

test('reconcileSeating follows Course Settings, keeping each kitchen’s rotation order', () => {
  const s = setup({ A1: [['a', 'b', 'c'], ['d']] })
  const changed = reconcileSeating(s.blocks.A1, { a: 1, c: 1, b: 2, d: 2, e: 1 }, ['a', 'b', 'c', 'd', 'e'])
  assert.equal(changed, true)
  assert.deepEqual(students(s, 'A1', 0), ['a', 'c', 'e'], 'kept order, newcomer at the bottom')
  assert.deepEqual(students(s, 'A1', 1), ['d', 'b'])
  assert.equal(reconcileSeating(s.blocks.A1, { a: 1, c: 1, b: 2, d: 2, e: 1 }, ['a', 'b', 'c', 'd', 'e']), false, 'idempotent')
})

test('reconcileSeating ignores students not in the section and leaves a period with no home kitchens alone', () => {
  const s = setup({ A1: [['a', 'b']] })
  assert.equal(reconcileSeating(s.blocks.A1, { a: 1, gone: 1 }, ['a', 'b']), true)
  assert.deepEqual(students(s, 'A1'), ['a'], 'b has no home kitchen, so leaves; gone is not in the section')
  const t = setup({ A1: [['a', 'b']] })
  assert.equal(reconcileSeating(t.blocks.A1, null, ['a', 'b']), false)
  assert.equal(reconcileSeating(t.blocks.A1, {}, ['a', 'b']), false)
  assert.deepEqual(students(t, 'A1'), ['a', 'b'])
})

test('pickTodaysLab picks the lab dated today for this period, the most recently graded if two', () => {
  const labs = [
    { id: 'l1', dates: { s1: TODAY } },
    { id: 'l2', dates: { s1: '2026-11-03', s2: TODAY } },
    { id: 'l3', dates: { s1: TODAY } },
  ]
  assert.equal(pickTodaysLab(labs, 's2', TODAY).id, 'l2')
  assert.equal(pickTodaysLab(labs, 's3', TODAY), null)
  const grading = { l1: { draft: {}, updatedAt: '2026-11-04T15:00' }, l3: { committed: {}, committedAt: '2026-11-04T09:00' } }
  assert.equal(pickTodaysLab(labs, 's1', TODAY, grading).id, 'l1')
})

test('labAttendance reads absences, and moves only when the period has home kitchens', () => {
  const section = { students: { a: { present: false, excused: true }, b: { present: true, kitchen: 3 }, c: { kitchen: 1 } } }
  const withHome = labAttendance(section, 'Lab 4', true)
  assert.deepEqual([...withHome.absent], ['a'])
  assert.deepEqual(withHome.kitchen, { b: 2, c: 0 })
  assert.deepEqual(labAttendance(section, 'Lab 4', false).kitchen, {})
})
