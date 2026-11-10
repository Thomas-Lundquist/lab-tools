// Finds students Canvas enrolled in more than one section of a course — the
// shape a mistaken double-enrollment takes (CLAUDE.md: "Canvas has mistakenly
// added multiple students to different classes alongside their regular
// section"). Lets Course Settings surface them directly instead of making the
// teacher hunt through every period's roster for a name that doesn't belong.
// Pure, so it's unit-tested.

// Every double-enrolled student stays listed as long as Canvas still has them
// in 2+ sections, whether or not the teacher has already resolved it — this
// backs a checkbox per section (storage/CourseSettingsModal), checked where
// `activeSectionIds` says they're still included, and a resolved student is
// just as reversible as an unresolved one (re-check the box, no separate undo
// UI needed). `activeSectionIds` already excludes sections the student is
// excluded from.
export function findDuplicateEnrollments(sections, excludedBySection = {}) {
  const sectionIdsByStudent = new Map()
  for (const sec of sections) {
    for (const id of sec.studentIds ?? []) {
      if (!sectionIdsByStudent.has(id)) sectionIdsByStudent.set(id, [])
      sectionIdsByStudent.get(id).push(sec.id)
    }
  }
  const out = []
  for (const [studentId, sectionIds] of sectionIdsByStudent) {
    if (sectionIds.length < 2) continue
    const activeSectionIds = sectionIds.filter(id => !(excludedBySection[id] ?? []).includes(studentId))
    out.push({ studentId, sectionIds, activeSectionIds })
  }
  return out
}
