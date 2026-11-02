import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeCourseCommentLibraries } from './setup.js'

test('the global comment bank starts as every course\'s old list merged, in order, without duplicates', () => {
  const courses = {
    c1: { settings: { commentLibrary: ['Great teamwork', 'Clean station'] } },
    c2: { settings: { commentLibrary: ['Clean station', 'Watch your knife grip'] } },
    c3: { settings: {} },
    c4: {},
  }
  assert.deepEqual(mergeCourseCommentLibraries(courses), ['Great teamwork', 'Clean station', 'Watch your knife grip'])
  assert.deepEqual(mergeCourseCommentLibraries(undefined), [])
})
