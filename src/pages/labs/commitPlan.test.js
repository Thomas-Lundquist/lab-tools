import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// request.js needs a minimal browser to run the runner tests under node.
globalThis.window = { location: { origin: 'https://canvas.test', protocol: 'about:' } }
globalThis.document = { cookie: '_csrf_token=tok' }

const { planCommit, buildSection, buildComment } = await import('./commitPlan.js')
const { runCommit, runRevert } = await import('./commitRun.js')

const byId = {
  k1: { id: 'k1', label: 'Floor not swept', scope: 'kitchen', severity: 'minor' },
  i1: { id: 'i1', label: 'Phone out', scope: 'individual', severity: 'minor' },
}
const ids = { courseId: '10', profId: '20', journalId: '30' }
const settings = { commentsOn: true, maxScore: 4, zeroJournalWhenAbsent: true }
const roster = [{ userId: '1', userName: 'Ana' }]
const emptyCanvas = (over = {}) => ({
  prof: { 1: { score: null, excused: false, comments: [] }, ...over.prof },
  journal: { 1: { score: null, excused: false }, ...over.journal },
  locks: over.locks ?? {},
})
const sectionWith = student => ({ kitchens: { 1: { flagIds: ['k1'] } }, students: { 1: { kitchen: 1, flagIds: [], present: true, ...student } } })
const plan = (student, canvas = emptyCanvas(), prior = null) =>
  planCommit({ roster, section: sectionWith(student), prior, canvas, ids, settings, byId }).students[0]

// --- bug 1: resuming keeps every field ---

test('buildSection keeps Exceeds, comments, and library comments from the stored set', () => {
  const prior = { kitchens: {}, students: { 1: { kitchen: 2, flagIds: ['i1'], present: true, exceeded: true, comment: 'Great', libraryComments: ['Clean station'] } } }
  const st = buildSection(roster, prior, {}).students[1]
  assert.equal(st.exceeded, true)
  assert.equal(st.comment, 'Great')
  assert.deepEqual(st.libraryComments, ['Clean station'])
  assert.equal(st.kitchen, 2)
})

test('with no stored set, Canvas decides present / absent / excused', () => {
  const r3 = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }]
  const sec = buildSection(r3, null, { a: { score: 3 }, b: { score: 0 }, c: { score: null, excused: true } })
  assert.equal(sec.students.a.present, true)
  assert.equal(sec.students.b.present, false)
  assert.deepEqual([sec.students.c.present, sec.students.c.excused], [false, true])
})

// --- present ---

test('a present student posts their score and comment; an unchanged one sends nothing', () => {
  const s = plan({})
  assert.deepEqual(s.ops, [{ target: 'prof', fields: { posted_grade: '3', text_comment: 'Professionalism: 3/4\nKitchen: Floor not swept' } }])
  const same = plan({}, emptyCanvas({ prof: { 1: { score: 3, excused: false, comments: ['Professionalism: 3/4\nKitchen: Floor not swept'] } } }))
  assert.deepEqual(same.ops, [], 'score already 3 and comment already posted')
})

test('a student with no derivable score is blocked in the preview, not sent as "null"', () => {
  const s = planCommit({ roster: [{ userId: '9', userName: 'Ghost' }], section: { kitchens: {}, students: {} }, prior: null, canvas: emptyCanvas(), ids, settings, byId }).students[0]
  assert.equal(s.blocked, true)
  assert.ok(s.checks.some(c => c.rule === 'bad-score'))
})

// --- bug 2: recommitting an absence is a no-op ---

test('an absent student already zeroed and locked needs nothing on recommit', () => {
  const canvas = emptyCanvas({ prof: { 1: { score: 0, excused: false, comments: [] } }, journal: { 1: { score: 0, excused: false } }, locks: { 1: { id: 'o1', lockAt: 'x' } } })
  assert.deepEqual(plan({ present: false }, canvas).ops, [])
})

test('a first-time absence zeroes both and locks the journal once', () => {
  assert.deepEqual(plan({ present: false }).ops, [
    { target: 'prof', fields: { posted_grade: '0' } },
    { target: 'journal', fields: { posted_grade: '0' } },
    { target: 'lock', action: 'create' },
  ])
})

// --- bug 4: absent students never get the kitchen's flag summary ---

test('an absent student gets only their own typed comment, never the kitchen flag summary', () => {
  const s = plan({ present: false, comment: 'Get the makeup sheet' })
  assert.equal(s.ops[0].fields.text_comment, 'Get the makeup sheet')
  assert.equal(plan({ present: false }).comment, null, 'no typed comment → no comment at all')
})

// --- bug 3: Absent → Present undoes the absence ---

test('a student committed absent and now present gets their journal zero cleared and lock removed', () => {
  const prior = { kitchens: {}, students: { 1: { present: false } } }
  const canvas = emptyCanvas({ prof: { 1: { score: 0, excused: false, comments: [] } }, journal: { 1: { score: 0, excused: false } }, locks: { 1: { id: 'o1', lockAt: 'x' } } })
  const s = plan({}, canvas, prior)
  assert.equal(s.returning, true)
  assert.deepEqual(s.ops.slice(1), [
    { target: 'journal', fields: { posted_grade: '' } },
    { target: 'lock', action: 'delete', lock: { id: 'o1', lockAt: 'x' } },
  ])
})

test('a real journal 0 is left alone for a student who was never committed absent', () => {
  const canvas = emptyCanvas({ journal: { 1: { score: 0, excused: false } } })
  assert.ok(!plan({}, canvas).ops.some(op => op.target === 'journal'))
})

// --- excused uses Canvas excused ---

test('an excused absence excuses professionalism and the journal, and removes an old lock', () => {
  const canvas = emptyCanvas({ prof: { 1: { score: 0, excused: false, comments: [] } }, journal: { 1: { score: 0, excused: false } }, locks: { 1: { id: 'o1' } } })
  assert.deepEqual(plan({ present: false, excused: true }, canvas).ops, [
    { target: 'prof', fields: { excuse: true } },
    { target: 'journal', fields: { excuse: true } },
    { target: 'lock', action: 'delete', lock: { id: 'o1' } },
  ])
})

test('an excused student switched to unexcused-absent is un-excused and zeroed', () => {
  const canvas = emptyCanvas({ prof: { 1: { score: null, excused: true, comments: [] } }, journal: { 1: { score: null, excused: true } } })
  const ops = plan({ present: false }, canvas).ops
  assert.deepEqual(ops[0], { target: 'prof', fields: { excuse: false, posted_grade: '0' } })
  assert.deepEqual(ops[1], { target: 'journal', fields: { excuse: false, posted_grade: '0' } })
})

test('summary counts what will happen', () => {
  const r = [{ userId: '11', userName: 'A' }, { userId: '12', userName: 'B' }, { userId: '13', userName: 'C' }]
  const section = { kitchens: {}, students: { 11: { present: true, flagIds: [] }, 12: { present: false }, 13: { present: false, excused: true } } }
  const canvas = { prof: {}, journal: {}, locks: {} }
  const { summary } = planCommit({ roster: r, section, prior: null, canvas, ids, settings: { ...settings, commentsOn: false }, byId })
  assert.deepEqual([summary.scoresPosted, summary.absent, summary.excused, summary.unchanged, summary.blocked], [1, 1, 1, 0, 0])
  assert.deepEqual(summary.scoreCounts, { 4: 1 })
})

test('buildComment omits flags when told to', () => {
  assert.equal(buildComment(sectionWith({ comment: 'Hi' }), '1', 3, false, byId), 'Hi')
})

// --- runner + revert against a fake Canvas ---

let sent
function stubFetch(handler = () => ({})) {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    sent.push({ method: init.method ?? 'GET', path: u.pathname, body: init.body ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify(handler(u, init) ?? {}), { status: 200 })
  }
}
beforeEach(() => { sent = [] })

const entry = { name: 'Lab 4', professionalismAssignmentId: '20', journalAssignmentId: '30' }

test('runCommit sends the plan and records what Canvas had before', async () => {
  stubFetch(() => ({ id: 77 }))
  const canvas = emptyCanvas({ prof: { 1: { score: 2, excused: false, comments: [] } } })
  const p = planCommit({ roster, section: sectionWith({ present: false }), prior: null, canvas, ids, settings, byId })
  const { failures, record } = await runCommit(p, { courseId: '10', entry })
  assert.deepEqual(failures, [])
  assert.deepEqual(sent.map(x => `${x.method} ${x.path}`), [
    'PUT /api/v1/courses/10/assignments/20/submissions/1',
    'PUT /api/v1/courses/10/assignments/30/submissions/1',
    'POST /api/v1/courses/10/assignments/30/overrides',
  ])
  assert.deepEqual(record.students[1].prof, { before: { score: 2, excused: false }, afterExcused: false })
  assert.equal(record.students[1].lockCreated, true)
})

test('runRevert restores scores, deletes the posted comment, and removes the created lock', async () => {
  const record = { students: { 1: {
    prof: { before: { score: 2, excused: false }, afterExcused: false },
    journal: { before: { score: null, excused: true }, afterExcused: false },
    commentPosted: 'Nice work',
    lockCreated: true,
  } } }
  stubFetch(u => {
    if (u.pathname.endsWith('/assignments/20/submissions')) return [{ id: 5, user_id: 1, assignment_id: 20, submission_comments: [{ id: 900, comment: 'Nice work' }] }]
    if (u.pathname.endsWith('/assignments/30/overrides')) return [{ id: 'lock9', assignment_id: 30, student_ids: [1] }]
    return {}
  })
  const { failures } = await runRevert(record, { courseId: '10', entry, names: { 1: 'Ana' } })
  assert.deepEqual(failures, [])
  const writes = sent.filter(x => x.method !== 'GET')
  assert.deepEqual(writes.map(x => `${x.method} ${x.path}`), [
    'PUT /api/v1/courses/10/assignments/20/submissions/1',
    'PUT /api/v1/courses/10/assignments/30/submissions/1',
    'DELETE /api/v1/courses/10/assignments/20/submissions/1/comments/900',
    'DELETE /api/v1/courses/10/assignments/30/overrides/lock9',
  ])
  assert.deepEqual(writes[0].body, { submission: { posted_grade: '2' } })
  assert.deepEqual(writes[1].body, { submission: { excuse: true } })
})

test('a failing student is reported by name and the rest still go out', async () => {
  stubFetch()
  const r2 = [{ userId: '1', userName: 'Ana' }, { userId: '2', userName: 'Bo' }]
  const section = { kitchens: {}, students: { 1: { present: true, flagIds: [] }, 2: { present: true, flagIds: [] } } }
  const p = planCommit({ roster: r2, section, prior: null, canvas: { prof: {}, journal: null, locks: {} }, ids: { ...ids, journalId: null }, settings, byId })
  p.students[0].ops[0].fields.posted_grade = 'null' // simulate a broken value
  const { failures } = await runCommit(p, { courseId: '10', entry: { ...entry, journalAssignmentId: null } })
  assert.deepEqual(failures.map(f => f.userName), ['Ana'])
  assert.equal(sent.filter(x => x.method === 'PUT').length, 1, 'Bo still saved')
})
