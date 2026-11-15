import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getStandingKitchens } from '../../storage/kitchens.js'
import { getLabs } from '../../storage/setup.js'
import { getLabGrading, activeSection } from '../../storage/labGrading.js'
import { getSyncStatus, subscribeSyncStatus } from '../../storage/sync.js'
import { pickTodaysLab, labAttendance } from './today.js'
import { todayStamp } from './model.js'

// The Labs side of each rotator class, read from this device's (synced) Labs
// data — local reads only, no Canvas calls. Per block:
//   home: { userId: kitchenNo } from Course Settings, or null if the period
//         has none set (the rotator's own seating then stands)
//   att:  today's attendance for dayView (model.js), or null with no lab
//         dated today (the rotator's own marks then count)
//   lab:  { id, name } of today's lab, or null
// Re-reads whenever a sync finishes (another device's edits arrived), the day
// changes, or the classes change. DECISIONS.md, 2026-11-14.
export function useLabLink(state) {
  const [byBlock, setByBlock] = useState({})
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const lastSyncedAt = useSyncExternalStore(subscribeSyncStatus, () => getSyncStatus().lastSyncedAt)

  const links = Object.entries(state?.blocks ?? {})
    .filter(([, b]) => b.courseId && b.sectionId)
    .map(([id, b]) => `${id}:${b.courseId}:${b.sectionId}`)
    .sort()
  const linkKey = links.join(',')

  useEffect(() => {
    let cancelled = false
    const today = todayStamp()
    Promise.all((linkKey ? linkKey.split(',') : []).map(async link => {
      const [id, courseId, sectionId] = link.split(':')
      const standing = await getStandingKitchens(courseId, sectionId)
      const home = standing?.students && Object.keys(standing.students).length ? standing.students : null
      const entries = (await getLabs(courseId)).filter(e => e.dates?.[sectionId] === today)
      const grading = Object.fromEntries(await Promise.all(entries.map(async e => [e.id, await getLabGrading(e.id, sectionId)])))
      const lab = pickTodaysLab(entries, sectionId, today, grading)
      const att = lab ? labAttendance(activeSection(grading[lab.id]), lab.name, !!home) : null
      return [id, { home, att, lab: lab ? { id: lab.id, name: lab.name } : null }]
    }))
      .then(pairs => { if (!cancelled) setByBlock(Object.fromEntries(pairs)) })
      .catch(() => { /* Labs data unreadable: the rotator keeps working on its own */ })
    return () => { cancelled = true }
  }, [linkKey, lastSyncedAt, tick])

  return { byBlock, reload }
}
