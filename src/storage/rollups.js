// What Lab Tools last pushed to each Unit/Term score assignment, so the next
// push can spot a score changed in Canvas (pages/labs/rollupPush.js) and the
// last push can be reverted. One synced key per course, `rollups/<courseId>`:
//   { [assignmentId]: { posted: { [studentId]: score|null }, pushedAt,
//                       lastPush: { at, before: { [studentId]: { score, excused } },
//                                   after: { [studentId]: score|null } } | null } }
// Canvas student ids and the scores already in the teacher's gradebook, synced
// only to the teacher's own Canvas custom data, like labGrading's lastCommit.

import { kvGet, kvSet } from './kv.js'

const key = courseId => `rollups/${courseId}`

export async function getRollups(courseId) {
  return (await kvGet(key(courseId))) ?? {}
}

export async function recordPush(courseId, assignmentId, { posted, record }) {
  const all = await getRollups(courseId)
  const prev = all[assignmentId] ?? {}
  const next = { ...prev, posted: { ...(prev.posted ?? {}), ...posted }, pushedAt: record.at, lastPush: record }
  await kvSet(key(courseId), { ...all, [assignmentId]: next })
  return next
}

// After a revert: reverted students go back to the score they had before the push.
export async function recordPushRevert(courseId, assignmentId, reverted) {
  const all = await getRollups(courseId)
  const prev = all[assignmentId]
  if (!prev?.lastPush) return prev
  const posted = { ...(prev.posted ?? {}) }
  for (const id of reverted) posted[id] = prev.lastPush.before[id]?.score ?? null
  const next = { ...prev, posted, lastPush: null }
  await kvSet(key(courseId), { ...all, [assignmentId]: next })
  return next
}
