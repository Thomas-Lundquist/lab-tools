import { test } from 'node:test'
import assert from 'node:assert/strict'
import { merge3, deepEqual } from './merge.js'
import { createSyncEngine, isSyncedKey } from './sync.js'
import { flattenDocs } from '../api/customData.js'

// --- merge3 ---

test('only one side changed: that side wins', () => {
  const base = { a: 1 }
  assert.deepEqual(merge3(base, { a: 2 }, base), { a: 2 })
  assert.deepEqual(merge3(base, base, { a: 3 }), { a: 3 })
})

test('different keys edited on each side: both kept', () => {
  const base = { labs: { x: { name: 'X' } } }
  const local = { labs: { x: { name: 'X' }, y: { name: 'Y' } } }
  const remote = { labs: { x: { name: 'X renamed' } } }
  assert.deepEqual(merge3(base, local, remote), { labs: { x: { name: 'X renamed' }, y: { name: 'Y' } } })
})

test('same value changed on both sides: local wins', () => {
  assert.deepEqual(merge3({ a: 1 }, { a: 2 }, { a: 3 }), { a: 2 })
})

test('arrays are replaced whole, not merged element-wise', () => {
  assert.deepEqual(merge3({ f: ['a'] }, { f: ['a', 'b'] }, { f: ['c'] }), { f: ['a', 'b'] })
  assert.deepEqual(merge3({ f: ['a'] }, { f: ['a'] }, { f: ['c'] }), { f: ['c'] })
})

test('a key deleted on one side and untouched on the other stays deleted', () => {
  const base = { s1: { draft: 1 }, s2: { draft: 2 } }
  assert.deepEqual(merge3(base, { s2: { draft: 2 } }, base), { s2: { draft: 2 } })
  assert.deepEqual(merge3(base, base, { s1: { draft: 1 } }), { s1: { draft: 1 } })
})

test('no base (both copies predate sync): objects union', () => {
  assert.deepEqual(merge3(undefined, { a: 1, c: 1 }, { b: 2, c: 2 }), { a: 1, b: 2, c: 1 })
})

test('two devices grading different students in one section both keep their flags', () => {
  const base = { p3: { draft: { students: { s1: { flagIds: [] }, s2: { flagIds: [] } } } } }
  const local = { p3: { draft: { students: { s1: { flagIds: ['phone-out'] }, s2: { flagIds: [] } } } } }
  const remote = { p3: { draft: { students: { s1: { flagIds: [] }, s2: { flagIds: ['late'] } } } } }
  assert.deepEqual(merge3(base, local, remote), {
    p3: { draft: { students: { s1: { flagIds: ['phone-out'] }, s2: { flagIds: ['late'] } } } },
  })
})

test('deepEqual ignores key order, respects array order', () => {
  assert.ok(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }))
  assert.ok(!deepEqual([1, 2], [2, 1]))
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: undefined }))
  assert.ok(!deepEqual(null, {}))
})

// --- which keys sync ---

test('synced keys: preferences, setup, per-lab grading; never PIN, log, or bookkeeping', () => {
  for (const k of ['preferences', 'setup', 'labGrading/lab_1']) assert.ok(isSyncedKey(k), k)
  for (const k of ['security', 'auditLog', 'meta', 'labGrading', 'sync:dirty', 'sync:base:setup', 'cpt_theme']) {
    assert.ok(!isSyncedKey(k), k)
  }
})

// --- custom data tree ---

test('flattenDocs turns the namespace tree into document paths', () => {
  const tree = { setup: '{"a":1}', labGrading: { lab_1: '{}', lab_2: '{"x":1}' }, junk: 5 }
  assert.deepEqual(flattenDocs(tree), { setup: '{"a":1}', 'labGrading/lab_1': '{}', 'labGrading/lab_2': '{"x":1}' })
  assert.deepEqual(flattenDocs(undefined), {})
})

// --- engine: two devices, one fake Canvas ---

function fakeCanvas() {
  const docs = new Map()
  return {
    docs,
    puts: 0,
    async getAllDocs() { return Object.fromEntries(docs) },
    async getDoc(k) { return docs.get(k) },
    async putDoc(k, v) { this.puts++; docs.set(k, v) },
    async deleteAllDocs() { docs.clear() },
  }
}

function device(remote) {
  const data = new Map()
  const store = {
    get: k => (data.has(k) ? structuredClone(data.get(k)) : undefined),
    set: (k, v) => (v === undefined ? data.delete(k) : data.set(k, structuredClone(v))),
    keys: () => [...data.keys()],
  }
  const engine = createSyncEngine({ store, remote })
  // What kvSet does: write locally, then tell sync.
  const write = (k, v) => { store.set(k, v); engine.noteWrite(k) }
  return { store, engine, write, read: k => store.get(k) }
}

test('an edit on one device reaches the other', async () => {
  const canvas = fakeCanvas()
  const ipad = device(canvas)
  const laptop = device(canvas)
  ipad.write('setup', { labs: { x: { name: 'Knife skills' } } })
  await ipad.engine.push()
  await laptop.engine.pull()
  assert.deepEqual(laptop.read('setup'), { labs: { x: { name: 'Knife skills' } } })
  assert.equal(laptop.engine.hasPending(), false)
})

test('concurrent edits to different labs on two devices both survive', async () => {
  const canvas = fakeCanvas()
  const ipad = device(canvas)
  const laptop = device(canvas)
  ipad.write('setup', { labs: {} })
  await ipad.engine.push()
  await laptop.engine.pull()

  ipad.write('setup', { labs: { a: { name: 'A' } } })
  laptop.write('setup', { labs: { b: { name: 'B' } } })
  await ipad.engine.push()
  const changed = await laptop.engine.push()
  assert.deepEqual(changed, ['setup'], 'laptop picked up the iPad edit while pushing')
  assert.deepEqual(laptop.read('setup'), { labs: { a: { name: 'A' } , b: { name: 'B' } } })

  await ipad.engine.pull()
  assert.deepEqual(ipad.read('setup'), laptop.read('setup'))
  assert.deepEqual(JSON.parse(canvas.docs.get('setup')), laptop.read('setup'))
})

test('pull keeps edits that have not been pushed yet', async () => {
  const canvas = fakeCanvas()
  const ipad = device(canvas)
  const laptop = device(canvas)
  ipad.write('preferences', { palette: 'bauhaus', themeMode: 'system' })
  await ipad.engine.push()
  await laptop.engine.pull()

  laptop.write('preferences', { palette: 'modern', themeMode: 'system' }) // not pushed yet
  ipad.write('preferences', { palette: 'bauhaus', themeMode: 'dark' })
  await ipad.engine.push()
  await laptop.engine.pull()
  assert.deepEqual(laptop.read('preferences'), { palette: 'modern', themeMode: 'dark' })
  assert.equal(laptop.engine.hasPending(), true, 'the merged copy still has to go up')
  await laptop.engine.push()
  assert.deepEqual(JSON.parse(canvas.docs.get('preferences')), { palette: 'modern', themeMode: 'dark' })
})

test('data that predates sync uploads, and two such devices merge instead of overwriting', async () => {
  const canvas = fakeCanvas()
  const ipad = device(canvas)
  const laptop = device(canvas)
  ipad.store.set('labGrading/lab_1', { p1: { committed: 'ipad' } }) // written before sync existed: not dirty
  laptop.store.set('labGrading/lab_1', { p5: { committed: 'laptop' } })

  await ipad.engine.pull()
  await ipad.engine.push()
  assert.deepEqual(JSON.parse(canvas.docs.get('labGrading/lab_1')), { p1: { committed: 'ipad' } })

  await laptop.engine.pull()
  await laptop.engine.push()
  const both = { p1: { committed: 'ipad' }, p5: { committed: 'laptop' } }
  assert.deepEqual(laptop.read('labGrading/lab_1'), both)
  assert.deepEqual(JSON.parse(canvas.docs.get('labGrading/lab_1')), both)
})

test('an empty Canvas never deletes local data; it re-uploads it', async () => {
  const canvas = fakeCanvas()
  const ipad = device(canvas)
  ipad.write('setup', { labs: { a: 1 } })
  await ipad.engine.push()
  canvas.docs.clear() // erased elsewhere, or a read that came back empty
  await ipad.engine.pull()
  assert.deepEqual(ipad.read('setup'), { labs: { a: 1 } })
  await ipad.engine.push()
  assert.deepEqual(JSON.parse(canvas.docs.get('setup')), { labs: { a: 1 } })
})

test('an edit made while a push is in flight is kept and stays pending', async () => {
  const canvas = fakeCanvas()
  const ipad = device(canvas)
  ipad.write('setup', { a: 1 })
  const realPut = canvas.putDoc.bind(canvas)
  canvas.putDoc = async (k, v) => { ipad.write('setup', { a: 1, b: 2 }); return realPut(k, v) }
  await ipad.engine.push()
  assert.deepEqual(ipad.read('setup'), { a: 1, b: 2 })
  assert.equal(ipad.engine.hasPending(), true)
  canvas.putDoc = realPut
  await ipad.engine.push()
  assert.deepEqual(JSON.parse(canvas.docs.get('setup')), { a: 1, b: 2 })
  assert.equal(ipad.engine.hasPending(), false)
})

test('unsynced keys never leave the device', async () => {
  const canvas = fakeCanvas()
  const ipad = device(canvas)
  ipad.write('security', { pinHash: 'x' })
  ipad.write('auditLog', [])
  await ipad.engine.pull()
  await ipad.engine.push()
  assert.equal(canvas.docs.size, 0)
})

test('a failed upload keeps the edit pending for the next try', async () => {
  const canvas = fakeCanvas()
  const ipad = device(canvas)
  ipad.write('setup', { a: 1 })
  const realPut = canvas.putDoc.bind(canvas)
  canvas.putDoc = async () => { throw new Error('offline') }
  await assert.rejects(ipad.engine.push(), /offline/)
  assert.equal(ipad.engine.hasPending(), true)
  canvas.putDoc = realPut
  await ipad.engine.push()
  assert.deepEqual(JSON.parse(canvas.docs.get('setup')), { a: 1 })
})

test('an unchanged document is not re-sent', async () => {
  const canvas = fakeCanvas()
  const ipad = device(canvas)
  ipad.write('setup', { a: 1 })
  await ipad.engine.push()
  ipad.write('setup', { a: 1 })
  await ipad.engine.push()
  assert.equal(canvas.puts, 1)
})
