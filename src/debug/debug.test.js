import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// --- a minimal browser for request.js, kv.js, and color.js under node ---
class MemoryStorage {
  constructor() { this.m = new Map() }
  get length() { return this.m.size }
  key(i) { return [...this.m.keys()][i] ?? null }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
}
globalThis.localStorage = new MemoryStorage()
globalThis.window = { location: { origin: 'https://canvas.test', protocol: 'about:' }, matchMedia: () => ({ matches: false }), addEventListener() {} }
globalThis.document = { cookie: '_csrf_token=tok', documentElement: { setAttribute() {}, classList: { toggle() {} } }, addEventListener() {} }

const { checkGradeWrite } = await import('./checks.js')
const { describeWrite } = await import('./describe.js')
const { debugReportText, diagnosticsText, scrubBody } = await import('./scrub.js')
const debug = await import('./debugMode.js')
const { canvasGet, canvasPost, canvasPut, setFailureListener } = await import('../api/request.js')
const { updateSubmissionGrade } = await import('../api/submissions.js')
const { kvGet, kvSet } = await import('../storage/kv.js')
const errors = await import('../api/errors.js')

let fetched
function respond(status, body, raw) {
  const text = raw ?? (body === undefined ? '' : 'while(1);' + JSON.stringify(body))
  return new Response(text, { status, statusText: { 400: 'Bad Request', 403: 'Forbidden', 422: 'Unprocessable Entity' }[status] ?? '' })
}
function stubFetch(handler = () => respond(200, {})) {
  globalThis.fetch = async (url, init = {}) => {
    fetched.push({ url: new URL(url), method: init.method ?? 'GET', body: init.body })
    return handler(new URL(url), init)
  }
}
beforeEach(async () => {
  fetched = []
  stubFetch()
  await debug.exitDebug()
})

const rules = r => r.map(c => `${c.level}:${c.rule}`)
const grade = (fields, context = {}) => checkGradeWrite({ courseId: '10', assignmentId: '20', userId: '30', fields, context })

// --- safety checks ---

test('a normal score, a clear, and an excuse pass', () => {
  assert.deepEqual(grade({ posted_grade: '3.6' }), [])
  assert.deepEqual(grade({ posted_grade: '0' }), [])
  assert.deepEqual(grade({ posted_grade: '' }), [])
  assert.deepEqual(grade({ excuse: true }), [])
  assert.deepEqual(grade({ posted_grade: '4', text_comment: 'Great knife work.' }), [])
})

test('broken scores are blocked', () => {
  for (const g of ['null', 'undefined', 'NaN', '-1', 'abc', '3.6.1', null, undefined, 3]) {
    assert.deepEqual(rules(grade({ posted_grade: g })), ['block:bad-score'], String(g))
  }
})

test('broken comments are blocked', () => {
  assert.deepEqual(rules(grade({ text_comment: '   ' })), ['block:blank-comment'])
  assert.deepEqual(rules(grade({ text_comment: null })), ['block:blank-comment'])
  for (const c of ['Kitchen: undefined', 'Score: NaN/4', '[object Object]', 'Note: null']) {
    assert.deepEqual(rules(grade({ text_comment: c })), ['block:garbage-comment'], c)
  }
  // ordinary words that merely contain those letters are fine
  assert.deepEqual(grade({ text_comment: 'Nancy and Annulla nullified nothing' }), [])
})

test('ids that are not Canvas ids are blocked; debug ids pass the check (request.js stops them live)', () => {
  assert.deepEqual(rules(checkGradeWrite({ courseId: '10', assignmentId: 'undefined', userId: '30', fields: { posted_grade: '1' } })), ['block:bad-id'])
  assert.deepEqual(checkGradeWrite({ courseId: '10', assignmentId: 'debug-3', userId: '30', fields: { posted_grade: '1' } }), [])
})

test('an empty write is blocked', () => {
  assert.deepEqual(rules(grade({})), ['block:empty-write'])
})

test('warnings: above 4 on professionalism, above points possible, duplicate comment', () => {
  assert.deepEqual(rules(grade({ posted_grade: '5' }, { kind: 'professionalism' })), ['warn:score-above-4'])
  assert.deepEqual(rules(grade({ posted_grade: '12' }, { pointsPossible: 10 })), ['warn:score-above-max'])
  assert.deepEqual(rules(grade({ text_comment: 'Nice' }, { existingComments: ['Nice'] })), ['warn:duplicate-comment'])
})

// --- live mode ---

test('live: a blocked grade write throws LT-CHECK and never reaches Canvas', async () => {
  await assert.rejects(updateSubmissionGrade('10', '20', '30', { posted_grade: 'null' }), err => {
    assert.ok(err instanceof errors.CheckError)
    assert.equal(err.code, 'LT-CHECK')
    assert.match(err.message, /score is "null"/)
    return true
  })
  assert.equal(fetched.length, 0)
})

test('live: any write to a fake debug id is refused', async () => {
  await assert.rejects(canvasPost('/api/v1/courses/10/assignments/debug-4/overrides', {}), errors.CheckError)
  assert.equal(fetched.length, 0)
})

test('live: a good grade write goes out unchanged', async () => {
  await updateSubmissionGrade('10', '20', '30', { posted_grade: '3.6', text_comment: 'Good' })
  assert.equal(fetched.length, 1)
  assert.equal(fetched[0].method, 'PUT')
  assert.deepEqual(JSON.parse(fetched[0].body), { submission: { posted_grade: '3.6' }, comment: { text_comment: 'Good' } })
})

// --- debug mode ---

test('debug: writes are recorded, not sent; creates get fake ids; reads still go to Canvas', async () => {
  await debug.enterDebug()
  const created = await canvasPost('/api/v1/courses/10/assignments', { assignment: { name: 'Lab 4 Professionalism', points_possible: 4 } })
  assert.equal(created.id, 'debug-1')
  assert.equal(created.name, 'Lab 4 Professionalism')
  await updateSubmissionGrade('10', created.id, '30', { posted_grade: '3.6', text_comment: 'Good' }, { studentName: 'Ana Ruiz', assignmentLabel: 'Lab 4', kind: 'professionalism' })
  assert.equal(fetched.length, 0, 'no write reached Canvas')

  await canvasGet('/api/v1/courses/10/sections')
  assert.equal(fetched.length, 1, 'a real read still goes out')
  const fakeRead = await canvasGet(`/api/v1/courses/10/assignments/${created.id}/submissions`)
  assert.deepEqual(fakeRead, [])
  assert.equal(fetched.length, 1, 'a read of a debug-only item is answered locally')

  const { entries } = debug.getDebugState()
  assert.equal(entries.length, 2)
  assert.match(entries[0].text, /Create assignment “Lab 4 Professionalism” \(4 pts\)/)
  assert.equal(entries[1].text, 'Post 3.6 + comment for Ana Ruiz on “Lab 4”')
  assert.deepEqual(entries[1].categories, ['grade-post', 'comment'])
})

test('debug: a blocked write is shown in the report and still throws, like live', async () => {
  await debug.enterDebug()
  await assert.rejects(updateSubmissionGrade('10', '20', '30', { posted_grade: 'NaN' }), errors.CheckError)
  const [e] = debug.getDebugState().entries
  assert.equal(e.blocked, true)
  assert.deepEqual(e.categories, ['grade-post'])
  assert.equal(fetched.filter(f => f.method !== 'GET').length, 0)
})

test('debug: the sandbox keeps real data untouched and is discarded on exit', async () => {
  await kvSet('setup', { labs: { real: 1 } })
  await debug.enterDebug()
  assert.deepEqual(await kvGet('setup'), { labs: { real: 1 } }, 'sandbox starts as a copy')
  await kvSet('setup', { labs: { test: 1 } })
  assert.equal(localStorage.getItem('labtools:setup'), JSON.stringify({ labs: { real: 1 } }), 'real copy untouched')
  await debug.exitDebug()
  assert.deepEqual(await kvGet('setup'), { labs: { real: 1 } })
  assert.equal([...localStorage.m.keys()].some(k => k.startsWith('labtools-debug:')), false, 'sandbox gone')
})

test('debug: the PIN-gate action name groups writes', async () => {
  await debug.enterDebug()
  await debug.withAction('Commit 2 students for Lab 4', () => updateSubmissionGrade('10', '20', '30', { posted_grade: '4' }))
  assert.equal(debug.getDebugState().entries[0].action, 'Commit 2 students for Lab 4')
})

// --- error classification ---

test('a 403 without a rate-limit message is a permission error, not "rate limited"', async () => {
  stubFetch(() => respond(403, { errors: [{ message: 'user not authorized to perform that action' }] }))
  await assert.rejects(canvasGet('/api/v1/x'), err => {
    assert.ok(err instanceof errors.PermissionError)
    assert.equal(err.code, 'LT-403P')
    assert.match(err.message, /not authorized.*\(LT-403P\)/)
    return true
  })
})

test('a dropped connection is LT-NET; 422 carries Canvas\'s reason; operations generalise ids', async () => {
  globalThis.fetch = async () => { throw new TypeError('Load failed') }
  await assert.rejects(canvasGet('/api/v1/courses/123/sections'), err => {
    assert.ok(err instanceof errors.NetworkError)
    assert.equal(err.operation, 'GET /courses/:id/sections')
    return true
  })
  stubFetch(() => respond(422, { errors: { due_at: [{ message: 'invalid' }] }, message: 'due_at is invalid' }))
  await assert.rejects(canvasPut('/api/v1/courses/1/assignments/2', {}), err => err.code === 'LT-422' && /due_at is invalid/.test(err.message))
})

test('every failure reaches the diagnostics listener, except expected "not there yet" reads', async () => {
  const seen = []
  setFailureListener(err => seen.push(err.code))
  stubFetch(() => respond(400, { message: 'no data for scope' }))
  await assert.rejects(canvasGet('/api/v1/users/self/custom_data', {}, { expectMissing: true }))
  await assert.rejects(canvasGet('/api/v1/courses/1'))
  assert.deepEqual(seen, ['LT-400'])
  setFailureListener(null)
})

// --- copy for Claude ---

test('describe: overrides, module items, and absence zeros read plainly', () => {
  assert.equal(describeWrite({ method: 'POST', path: '/api/v1/courses/1/assignments/2/overrides', body: { assignment_override: { student_ids: ['9'], lock_at: '2026-11-02' } } }).text,
    'Create a date override for 1 student on assignment 2 (locks 2026-11-02)')
  assert.deepEqual(describeWrite({ method: 'PUT', path: '/api/v1/courses/1/assignments/2/submissions/9', body: { submission: { posted_grade: '0' } }, context: { absent: true, studentName: 'Bo' } }),
    { text: 'Post absence zero for Bo on assignment 2', categories: ['grade-zero'] })
  assert.deepEqual(describeWrite({ method: 'POST', path: '/api/v1/courses/1/modules/5/items', body: { module_item: { type: 'Assignment', content_id: 'debug-1' } } }).categories, ['module-item-add'])
})

test('copied debug report has no student names, ids, scores, or comment text', async () => {
  await debug.enterDebug()
  await debug.withAction('Commit 2 students for Lab 4 — Ana Ruiz absent', async () => {
    await updateSubmissionGrade('10', '20', '987654', { posted_grade: '3.6', text_comment: 'Ana, great sanitising today' }, { studentName: 'Ana Ruiz', assignmentLabel: 'Lab 4' })
    await updateSubmissionGrade('10', '20', '876543', { posted_grade: 'null' }, { studentName: 'Bo Chen', assignmentLabel: 'Lab 4' }).catch(() => {})
    await canvasPost('/api/v1/courses/10/assignments/20/overrides', { assignment_override: { student_ids: ['876543'], title: 'Bo Chen — absent lock' } })
  })
  const text = debugReportText(debug.getDebugState().entries, { build: 'app-test.js' })
  for (const secret of ['Ana Ruiz', 'Bo Chen', '987654', '876543', '3.6', 'great sanitising']) {
    assert.ok(!text.includes(secret), `leaked ${secret}`)
  }
  assert.match(text, /student-1/)
  assert.match(text, /BLOCKED/)
  assert.match(text, /score is "null"/, 'the broken value is kept — it is the bug, not a grade')
  assert.match(text, /Lab 4/)
})

test('copied diagnostics replace long ids', () => {
  const text = diagnosticsText([{ at: '2026-11-02T10:00:00Z', code: 'LT-422', operation: 'PUT /courses/:id/assignments/:id', message: 'Canvas rejected user 4455667 (LT-422)', count: 2, route: 'labs' }])
  assert.ok(!text.includes('4455667'))
  assert.match(text, /LT-422 ×2/)
})

test('scrubBody keeps assignment content, drops student content', () => {
  assert.deepEqual(scrubBody({ assignment: { name: 'Lab 4', points_possible: 4 }, submission: { posted_grade: '4' }, comment: { text_comment: 'abc' } }),
    { assignment: { name: 'Lab 4', points_possible: 4 }, submission: { posted_grade: '<score>' }, comment: { text_comment: '<comment, 3 chars>' } })
})

// Last: a rate limit makes request.js pause later requests for 10 s.
test('a 403 whose body says rate limit is LT-403R', async () => {
  stubFetch(() => respond(403, undefined, '403 Forbidden (Rate Limit Exceeded)'))
  await assert.rejects(canvasGet('/api/v1/x'), err => err instanceof errors.RateLimitError && err.code === 'LT-403R')
})
