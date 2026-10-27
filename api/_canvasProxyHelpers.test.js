import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getAllowedHosts,
  isAllowedCanvasBase,
  rewriteLinkHeader,
  isAllowedOrigin,
  parseProxyRequestUrl,
} from './_canvasProxyHelpers.js'

test('getAllowedHosts defaults to graniteschools.instructure.com', () => {
  assert.deepEqual(getAllowedHosts({}), ['graniteschools.instructure.com'])
})

test('getAllowedHosts reads a comma-separated override', () => {
  assert.deepEqual(
    getAllowedHosts({ ALLOWED_CANVAS_HOSTS: 'a.instructure.com, b.instructure.com' }),
    ['a.instructure.com', 'b.instructure.com'],
  )
})

test('isAllowedCanvasBase accepts an allowed https host', () => {
  assert.equal(
    isAllowedCanvasBase('https://graniteschools.instructure.com', ['graniteschools.instructure.com']),
    true,
  )
})

test('isAllowedCanvasBase rejects a host not on the allowlist', () => {
  assert.equal(
    isAllowedCanvasBase('https://evil.example.com', ['graniteschools.instructure.com']),
    false,
  )
})

test('isAllowedCanvasBase rejects plain http even for an allowed host', () => {
  assert.equal(
    isAllowedCanvasBase('http://graniteschools.instructure.com', ['graniteschools.instructure.com']),
    false,
  )
})

test('isAllowedCanvasBase rejects a malformed URL', () => {
  assert.equal(isAllowedCanvasBase('not a url', ['graniteschools.instructure.com']), false)
})

test('rewriteLinkHeader rewrites a single rel="next" entry to a relative proxy path', () => {
  const header = '<https://graniteschools.instructure.com/api/v1/courses/1/assignments?page=2&per_page=100>; rel="next"'
  const result = rewriteLinkHeader(header, 'https://graniteschools.instructure.com')
  assert.equal(result, '</api/canvas/api/v1/courses/1/assignments?page=2&per_page=100>; rel="next"')
})

test('rewriteLinkHeader rewrites multiple comma-separated entries', () => {
  const header =
    '<https://graniteschools.instructure.com/api/v1/courses/1/assignments?page=2>; rel="next", ' +
    '<https://graniteschools.instructure.com/api/v1/courses/1/assignments?page=5>; rel="last"'
  const result = rewriteLinkHeader(header, 'https://graniteschools.instructure.com')
  assert.match(result, /^<\/api\/canvas\/api\/v1\/courses\/1\/assignments\?page=2>; rel="next", <\/api\/canvas\/api\/v1\/courses\/1\/assignments\?page=5>; rel="last"$/)
})

test('rewriteLinkHeader passes through null/empty unchanged', () => {
  assert.equal(rewriteLinkHeader(null, 'https://graniteschools.instructure.com'), null)
  assert.equal(rewriteLinkHeader('', 'https://graniteschools.instructure.com'), '')
})

test('isAllowedOrigin accepts the documented localhost dev origin', () => {
  assert.equal(isAllowedOrigin('http://localhost:5175'), true)
})

test('isAllowedOrigin accepts any vercel.app deployment', () => {
  assert.equal(isAllowedOrigin('https://lab-tools-git-main-thomas.vercel.app'), true)
})

test('isAllowedOrigin rejects an unrelated origin', () => {
  assert.equal(isAllowedOrigin('https://evil.example.com'), false)
})

test('isAllowedOrigin rejects undefined/empty origin', () => {
  assert.equal(isAllowedOrigin(undefined), false)
  assert.equal(isAllowedOrigin(''), false)
})

test('parseProxyRequestUrl strips the proxy prefix and keeps the query string', () => {
  const result = parseProxyRequestUrl('/api/canvas/api/v1/courses/1/assignments?per_page=100&include%5B%5D=overrides')
  assert.equal(result.targetPath, '/api/v1/courses/1/assignments')
  assert.equal(result.search, '?per_page=100&include%5B%5D=overrides')
})

test('parseProxyRequestUrl handles a bare path with no query string', () => {
  const result = parseProxyRequestUrl('/api/canvas/api/v1/users/self')
  assert.equal(result.targetPath, '/api/v1/users/self')
  assert.equal(result.search, '')
})
