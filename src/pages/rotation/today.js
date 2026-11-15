// Which lab a rotator class takes today's attendance from, and what that lab
// says. Pure: the caller (useLabLink.js) reads the stored Labs data and hands
// it in. The rotator only ever reads Labs data, never writes it.
// DECISIONS.md, 2026-11-14.

// The lab dated today for this period, picked automatically: no selector. Two
// labs dated the same day for one period (rare) resolve to the one whose
// grading for this period was touched most recently. `gradingByLab` is
// { labId: that lab's stored state for this period } (storage/labGrading.js).
export function pickTodaysLab(entries, sectionId, today, gradingByLab = {}) {
  const todays = (entries ?? []).filter(e => sectionId && e.dates?.[sectionId] === today)
  if (todays.length <= 1) return todays[0] ?? null
  const touched = e => {
    const st = gradingByLab[e.id]
    return (st?.draft ? st.updatedAt : st?.committedAt) ?? ''
  }
  return todays.reduce((best, e) => (touched(e) > touched(best) ? e : best))
}

// Today's attendance from the lab's working section (its draft, else its
// commit; storage/labGrading.js's activeSection), in dayView's shape
// (model.js). Kitchen numbers become 0-based indexes. Moves only count when
// the period has home kitchens to be moved from (`hasHome`): with none, every
// lab placement would read as a visit.
export function labAttendance(section, labName, hasHome) {
  const absent = new Set()
  const kitchen = {}
  for (const [uid, st] of Object.entries(section?.students ?? {})) {
    if (st?.present === false) absent.add(uid)
    else if (hasHome && Number.isInteger(st?.kitchen) && st.kitchen >= 1) kitchen[uid] = st.kitchen - 1
  }
  return { absent, kitchen, labName }
}
