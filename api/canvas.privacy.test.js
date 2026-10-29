import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Privacy tripwire. The Canvas proxy is the one server component that sees the
// teacher's token and students' grades in transit. DECISIONS.md commits it to
// staying stateless: no logging, no persistence, no analytics. This test fails
// the build if that promise is quietly broken by a stray console.log or a write.
// See DECISIONS.md "Standing invariant — privacy".

const src = readFileSync(new URL('./canvas.js', import.meta.url), 'utf8')
const helpers = readFileSync(new URL('./_canvasProxyHelpers.js', import.meta.url), 'utf8')
const both = src + '\n' + helpers

test('proxy does not log request/response data', () => {
  assert.ok(!/console\.(log|info|debug|warn|error)\s*\(/.test(both),
    'The Canvas proxy must not call console.* — it would leak tokens or grades into logs.')
})

test('proxy does not persist anything to disk', () => {
  assert.ok(!/\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\b/.test(both),
    'The Canvas proxy must not write to disk — it must stay stateless.')
})

test('proxy holds no hard-coded credential', () => {
  // It forwards the caller's bearer token; it must never carry its own.
  assert.ok(!/Bearer\s+[A-Za-z0-9~._-]{20,}/.test(both),
    'The Canvas proxy must not embed a Canvas token.')
})
