import { canvasGetAll, canvasGet, canvasPut, canvasPost, canvasDelete } from './request.js'

// `include` is caller-controlled so a screen only pays for what it reads. Each
// include costs Canvas extra server-side work and payload — `overrides` most of
// all, since Canvas gathers every assignment's section overrides. The default
// keeps the full set for callers that want it (e.g. the Scoring rollup).
export async function getAssignments(
  courseId,
  { include = ['assignment_group', 'module_ids', 'overrides'], onProgress } = {},
) {
  const assignments = await canvasGetAll(`/api/v1/courses/${courseId}/assignments`, {
    include,
    order_by: 'position',
  }, onProgress)
  return assignments.map(mapAssignment)
}

export async function getAssignment(courseId, assignmentId) {
  const assignment = await canvasGet(`/api/v1/courses/${courseId}/assignments/${assignmentId}`)
  return mapAssignment(assignment)
}

export async function createAssignment(courseId, fields) {
  const assignment = await canvasPost(`/api/v1/courses/${courseId}/assignments`, {
    assignment: buildPayload(fields),
  })
  return mapAssignment(assignment)
}

export async function updateAssignment(courseId, assignmentId, fields) {
  const assignment = await canvasPut(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}`,
    { assignment: buildPayload(fields) },
  )
  return mapAssignment(assignment)
}

export async function deleteAssignment(courseId, assignmentId) {
  await canvasDelete(`/api/v1/courses/${courseId}/assignments/${assignmentId}`)
}

export async function duplicateAssignment(courseId, assignmentId) {
  const assignment = await canvasPost(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/duplicate`,
  )
  return mapAssignment(assignment)
}

function mapAssignment(raw) {
  return {
    id: String(raw.id),
    courseId: String(raw.course_id),
    name: raw.name,
    description: raw.description ?? '',
    dueAt: raw.due_at,
    unlockAt: raw.unlock_at,
    lockAt: raw.lock_at,
    pointsPossible: raw.points_possible,
    published: raw.published,
    submissionTypes: raw.submission_types ?? [],
    allowedExtensions: raw.allowed_extensions ?? [],
    gradingType: raw.grading_type,
    assignmentGroupId: raw.assignment_group_id ? String(raw.assignment_group_id) : null,
    assignmentGroupName: raw.assignment_group?.name ?? null,
    moduleIds: raw.module_ids ?? [],
    peerReviews: raw.peer_reviews ?? false,
    position: raw.position ?? 0,
    postToSis: raw.post_to_sis ?? false,
    onlyVisibleToOverrides: raw.only_visible_to_overrides ?? false,
    // Present only when the caller passed include[]=overrides. Section-scoped
    // overrides carry courseSectionId; student-scoped ones carry studentIds.
    overrides: (raw.overrides ?? []).map(o => ({
      id: String(o.id),
      courseSectionId: o.course_section_id ? String(o.course_section_id) : null,
      studentIds: o.student_ids ? o.student_ids.map(String) : null,
      title: o.title ?? null,
    })),
  }
}

function buildPayload(fields) {
  const payload = {}
  const map = {
    name: 'name',
    description: 'description',
    dueAt: 'due_at',
    unlockAt: 'unlock_at',
    lockAt: 'lock_at',
    pointsPossible: 'points_possible',
    published: 'published',
    submissionTypes: 'submission_types',
    allowedExtensions: 'allowed_extensions',
    gradingType: 'grading_type',
    assignmentGroupId: 'assignment_group_id',
    peerReviews: 'peer_reviews',
    position: 'position',
    postToSis: 'post_to_sis',
    // When true, the assignment is hidden from everyone except sections/students
    // named by an override — this is what scopes a Professionalism assignment to
    // just the A-day or just the B-day sections.
    onlyVisibleToOverrides: 'only_visible_to_overrides',
  }
  for (const [jsKey, apiKey] of Object.entries(map)) {
    if (fields[jsKey] !== undefined) payload[apiKey] = fields[jsKey]
  }
  return payload
}
