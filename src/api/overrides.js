import { canvasGetAll, canvasPost, canvasPut, canvasDelete } from './request.js'

// Assignment overrides: used for per-section due dates (Labs) and per-student
// "available until now" journal locks (Attendance). An override targets
// exactly one of courseSectionId or studentIds.

export async function getOverrides(courseId, assignmentId) {
  const overrides = await canvasGetAll(`/api/v1/courses/${courseId}/assignments/${assignmentId}/overrides`)
  return overrides.map(mapOverride)
}

export async function createOverride(courseId, assignmentId, fields) {
  const override = await canvasPost(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/overrides`,
    { assignment_override: buildPayload(fields) },
  )
  return mapOverride(override)
}

export async function updateOverride(courseId, assignmentId, overrideId, fields) {
  const override = await canvasPut(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/overrides/${overrideId}`,
    { assignment_override: buildPayload(fields) },
  )
  return mapOverride(override)
}

export async function deleteOverride(courseId, assignmentId, overrideId) {
  await canvasDelete(`/api/v1/courses/${courseId}/assignments/${assignmentId}/overrides/${overrideId}`)
}

// Finds the single-student override this tool would have created for a lock
// (student_ids === [studentId], nothing else). Returns null if none exists.
export async function findStudentOverride(courseId, assignmentId, studentId) {
  const overrides = await getOverrides(courseId, assignmentId)
  return overrides.find(o => o.studentIds?.length === 1 && o.studentIds[0] === studentId) ?? null
}

function mapOverride(raw) {
  return {
    id:               String(raw.id),
    assignmentId:     String(raw.assignment_id),
    title:            raw.title,
    studentIds:       raw.student_ids ? raw.student_ids.map(String) : null,
    courseSectionId:  raw.course_section_id ? String(raw.course_section_id) : null,
    dueAt:            raw.due_at,
    unlockAt:         raw.unlock_at,
    lockAt:           raw.lock_at,
  }
}

function buildPayload(fields) {
  const payload = {}
  if (fields.studentIds      !== undefined) payload.student_ids       = fields.studentIds
  if (fields.courseSectionId !== undefined) payload.course_section_id = fields.courseSectionId
  if (fields.dueAt           !== undefined) payload.due_at            = fields.dueAt
  if (fields.unlockAt        !== undefined) payload.unlock_at         = fields.unlockAt
  if (fields.lockAt          !== undefined) payload.lock_at           = fields.lockAt
  if (fields.title           !== undefined) payload.title             = fields.title
  return payload
}
