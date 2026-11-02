import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// request.js reads the origin and cookie at call time, so a bare window and
// document are enough to run it under node.
globalThis.window = { location: { origin: 'https://canvas.test' } }
globalThis.document = { cookie: '_csrf_token=tok' }

const { getAllDocs, getDoc, putDoc } = await import('./customData.js')

let calls
function respond(status, body) {
  return new Response(body === undefined ? '' : 'while(1);' + JSON.stringify(body), { status, statusText: status === 400 ? 'Bad Request' : '' })
}
function stubFetch(handler) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body })
    return handler(new URL(url), init)
  }
}
beforeEach(() => { calls = [] })

test('a path Canvas has no data for (400 "no data for scope") reads as missing', async () => {
  stubFetch(() => respond(400, { message: 'no data for scope' }))
  assert.equal(await getDoc('labGrading/lab_1'), undefined)
})

test('a namespace that was never written (404) reads as empty', async () => {
  stubFetch(() => respond(404, { errors: [{ message: 'The specified resource does not exist.' }] }))
  assert.deepEqual(await getAllDocs(), {})
  assert.equal(await getDoc('setup'), undefined)
})

test('other failures still throw, carrying Canvas\'s own message', async () => {
  stubFetch(() => respond(500, { errors: [{ message: 'boom' }] }))
  await assert.rejects(getDoc('setup'), /boom.*LT-5xx/)
})

test('a write sends ns in the query and body, the document as a string, and the CSRF token', async () => {
  let seen
  stubFetch((url, init) => { seen = { url, init }; return respond(200, { data: '{}' }) })
  await putDoc('labGrading/lab_1', '{"a":1}')
  assert.equal(seen.init.method, 'PUT')
  assert.equal(seen.url.pathname, '/api/v1/users/self/custom_data/labGrading/lab_1')
  assert.equal(seen.url.searchParams.get('ns'), 'org.labtools')
  assert.deepEqual(JSON.parse(seen.init.body), { ns: 'org.labtools', data: '{"a":1}' })
  assert.equal(seen.init.headers['X-CSRF-Token'], 'tok')
})

test('reading the namespace flattens Canvas\'s tree into documents', async () => {
  stubFetch(() => respond(200, { data: { setup: '{}', labGrading: { lab_1: '{"p":1}' } } }))
  assert.deepEqual(await getAllDocs(), { setup: '{}', 'labGrading/lab_1': '{"p":1}' })
})
