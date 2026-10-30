import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { readCsrfCookie } from './canvasContext.js'
import { extractNextPageUrl } from './request.js'
import { buildBookmarklet, buildUserscript } from '../install/launchers.js'

const root = new URL('../../', import.meta.url)

// --- standing privacy invariant: no server hop for Canvas data ---

test('no serverless functions ship: Canvas data never passes through this site', () => {
  assert.equal(existsSync(new URL('api', root)), false, 'an api/ directory would deploy as Vercel functions')
  const vercel = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'))
  assert.equal(vercel.rewrites, undefined)
  assert.equal(vercel.functions, undefined)
})

test('request layer talks only to the Canvas origin it runs on', () => {
  const src = readFileSync(new URL('src/api/request.js', root), 'utf8')
  assert.doesNotMatch(src, /https?:\/\//, 'request.js should build every URL from canvasOrigin()')
  assert.doesNotMatch(src, /Authorization/, 'production auth is the session cookie, never a bearer token')
})

// --- CSRF cookie ---

test('readCsrfCookie decodes the _csrf_token cookie among others', () => {
  assert.equal(readCsrfCookie('a=1; _csrf_token=ab%2Bc%3D%3D; b=2'), 'ab+c==')
  assert.equal(readCsrfCookie('_csrf_token=xyz'), 'xyz')
  assert.equal(readCsrfCookie('not_csrf_token=xyz'), null)
  assert.equal(readCsrfCookie(''), null)
})

// --- pagination ---

test('next-page URL is re-rooted on the current origin', () => {
  const link = '<https://graniteschools.instructure.com/api/v1/courses?page=2&per_page=100>; rel="next", <https://graniteschools.instructure.com/api/v1/courses?page=5&per_page=100>; rel="last"'
  assert.equal(extractNextPageUrl(link, 'http://localhost:5175'), 'http://localhost:5175/api/v1/courses?page=2&per_page=100')
  assert.equal(extractNextPageUrl(link, 'https://graniteschools.instructure.com'), 'https://graniteschools.instructure.com/api/v1/courses?page=2&per_page=100')
  assert.equal(extractNextPageUrl('<https://x/api/v1/a?page=1>; rel="current"', 'https://x'), null)
  assert.equal(extractNextPageUrl(null, 'https://x'), null)
})

// --- launchers ---

test('bookmarklet is valid JavaScript with no percent signs', () => {
  const b = buildBookmarklet('https://lab-tools.example/launch.js')
  assert.match(b, /^javascript:/)
  assert.doesNotMatch(b, /%/, 'javascript: URLs are percent-decoded before running')
  assert.doesNotThrow(() => new Function(b.slice('javascript:'.length)))
})

test('bookmarklet opens the tab before anything async and hands over origin + CSRF', () => {
  const b = buildBookmarklet('https://lab-tools.example/launch.js')
  assert.ok(b.indexOf('window.open') < b.indexOf('createElement'))
  assert.match(b, /canvasOrigin:location\.origin/)
  assert.match(b, /csrfToken:/)
  assert.ok(b.includes('"https://lab-tools.example/launch.js"'))
})

test('userscript matches only the dedicated Canvas launch URL', () => {
  const u = buildUserscript('https://lab-tools.example/launch.js')
  assert.match(u, /@match\s+https:\/\/graniteschools\.instructure\.com\/labtools\*/)
  assert.doesNotThrow(() => new Function(u))
})
