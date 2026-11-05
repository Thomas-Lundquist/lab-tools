import { useEffect, useState, useCallback } from 'react'
import { getSections } from '../../api/sections.js'
import { getEnrollments } from '../../api/enrollments.js'
import { displayNames } from './roster.js'

// Live rosters for every course the board's classes come from. Read from
// Canvas on every load, never stored: the rotator keeps only ids.
//
// Returns, per block, { status: 'loading' | 'ready' | 'error', sectionIds,
// sectionName, names: { userId: 'Kelly A.' }, error }.
export function useRosters(state) {
  const [courses, setCourses] = useState({}) // courseId -> { status, sections, students, error }
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  const courseIds = [...new Set(Object.values(state?.blocks ?? {}).map(b => b.courseId).filter(Boolean))].sort()
  const courseKey = courseIds.join(',')

  useEffect(() => {
    let cancelled = false
    for (const courseId of courseKey ? courseKey.split(',') : []) {
      setCourses(c => ({ ...c, [courseId]: { ...c[courseId], status: c[courseId]?.sections ? 'refreshing' : 'loading' } }))
      Promise.all([getSections(courseId), getEnrollments(courseId)])
        .then(([sections, enrollments]) => {
          if (cancelled) return
          const students = Object.fromEntries(enrollments.map(e => [e.userId, { id: e.userId, name: e.userName, sortableName: e.userSortableName }]))
          setCourses(c => ({ ...c, [courseId]: { status: 'ready', sections, students } }))
        })
        .catch(err => { if (!cancelled) setCourses(c => ({ ...c, [courseId]: { ...c[courseId], status: 'error', error: err.message } })) })
    }
    return () => { cancelled = true }
  }, [courseKey, tick])

  const byBlock = {}
  for (const [id, b] of Object.entries(state?.blocks ?? {})) {
    const c = courses[b.courseId]
    if (!b.courseId || !b.sectionId) { byBlock[id] = { status: 'unlinked', sectionIds: [], names: {} }; continue }
    if (!c || c.status === 'loading') { byBlock[id] = { status: 'loading', sectionIds: [], names: {} }; continue }
    if (c.status === 'error' && !c.sections) { byBlock[id] = { status: 'error', error: c.error, sectionIds: [], names: {} }; continue }
    const section = c.sections.find(s => s.id === b.sectionId)
    if (!section) { byBlock[id] = { status: 'error', error: 'This Canvas section no longer exists.', sectionIds: [], names: {} }; continue }
    // Students only: a section's member list can include the teacher and any
    // test student, who have no StudentEnrollment.
    const sectionIds = section.studentIds.filter(uid => c.students[uid])
    byBlock[id] = {
      // A failed refresh keeps showing the last good roster, flagged as an error.
      status: c.status === 'ready' ? 'ready' : c.status === 'error' ? 'error' : 'loading',
      error: c.error,
      sectionIds,
      sectionName: section.name,
      names: displayNames(sectionIds.map(uid => c.students[uid])),
    }
  }
  return { byBlock, reload }
}
