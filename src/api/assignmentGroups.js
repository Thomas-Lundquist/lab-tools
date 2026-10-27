import { canvasGetAll, canvasPost, canvasPut, canvasDelete } from './request.js'

export async function getAssignmentGroups(courseId) {
  const groups = await canvasGetAll(`/api/v1/courses/${courseId}/assignment_groups`)
  return groups.map(mapGroup).sort((a, b) => a.position - b.position)
}

export async function createAssignmentGroup(courseId, fields) {
  // Unlike most Canvas resources, assignment_groups create/update take flat
  // top-level params (name, position, group_weight) — not nested under an
  // `assignment_group` wrapper key. Wrapping them causes Canvas to silently
  // ignore the params and fall back to its own default name.
  const group = await canvasPost(`/api/v1/courses/${courseId}/assignment_groups`, buildPayload(fields))
  return mapGroup(group)
}

export async function updateAssignmentGroup(courseId, groupId, fields) {
  const group = await canvasPut(
    `/api/v1/courses/${courseId}/assignment_groups/${groupId}`,
    buildPayload(fields),
  )
  return mapGroup(group)
}

// moveAssignmentsTo: id of group to receive assignments before deletion (null = Canvas handles it)
export async function deleteAssignmentGroup(courseId, groupId, moveAssignmentsTo = null) {
  const params = moveAssignmentsTo ? `?move_assignments_to=${moveAssignmentsTo}` : ''
  await canvasDelete(`/api/v1/courses/${courseId}/assignment_groups/${groupId}${params}`)
}

function mapGroup(raw) {
  return {
    id:               String(raw.id),
    name:             raw.name,
    position:         raw.position ?? 0,
    groupWeight:      raw.group_weight ?? 0,
    assignmentsCount: raw.assignments_count ?? null,
  }
}

function buildPayload(fields) {
  const payload = {}
  if (fields.name        !== undefined) payload.name         = fields.name
  if (fields.position    !== undefined) payload.position     = fields.position
  if (fields.groupWeight !== undefined) payload.group_weight = fields.groupWeight
  return payload
}
