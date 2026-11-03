// Which periods still need committing. Pure, so it's unit-tested.
//
// A period is "due" when its lab date for that period has fully passed
// (strictly before today, within the last `days` days) and it has no commit,
// or has unsaved edits since its commit. A lab dated today isn't due yet —
// the day isn't over. Only periods with a lab date count: a lab with no date
// for a period isn't scheduled there.

import { periodStatus } from '../../storage/labGrading.js'

const shift = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * @param entries   the course's labs ({ id, name, dates: { [sectionId]: 'YYYY-MM-DD' } })
 * @param labStates { [labId]: { [sectionId]: stored state } } (storage/labGrading.js)
 * @param sections  [{ id, name }]
 * @returns [{ labId, labName, sectionId, sectionName, date, status: 'draft' | null }], oldest first
 */
export function uncommittedPeriods(entries, labStates, sections, today, days = 7) {
  const from = shift(today, -days)
  const nameOf = Object.fromEntries(sections.map(s => [s.id, s.name]))
  const out = []
  for (const e of entries) {
    for (const [sectionId, date] of Object.entries(e.dates ?? {})) {
      if (!date || date >= today || date < from || !nameOf[sectionId]) continue
      const status = periodStatus(labStates[e.id]?.[sectionId])
      if (status === 'done') continue
      out.push({ labId: e.id, labName: e.name, sectionId, sectionName: nameOf[sectionId], date, status })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.sectionName.localeCompare(b.sectionName))
}
