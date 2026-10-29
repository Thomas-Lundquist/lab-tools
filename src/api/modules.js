import { canvasGetAll, canvasPost } from './request.js'

export async function getModules(courseId) {
  const modules = await canvasGetAll(`/api/v1/courses/${courseId}/modules`)
  return modules.map(mapModule).sort((a, b) => a.position - b.position)
}

// Every item currently in a module. Canvas does not dedupe module items, so a
// caller that could run twice (a reused assignment, a retry) must read this
// first and skip addModuleItem when the content is already present.
export async function getModuleItems(courseId, moduleId) {
  const items = await canvasGetAll(`/api/v1/courses/${courseId}/modules/${moduleId}/items`)
  return items.map(mapModuleItem)
}

// Adds an assignment as an item in a module. Canvas module items carry their
// own publish flag, but for an Assignment-type item it's expected to mirror
// the assignment's own published state rather than needing a separate step —
// verify against a live course if an item ever shows up unpublished
// unexpectedly.
export async function addModuleItem(courseId, moduleId, assignmentId) {
  const item = await canvasPost(`/api/v1/courses/${courseId}/modules/${moduleId}/items`, {
    module_item: { type: 'Assignment', content_id: assignmentId },
  })
  return mapModuleItem(item)
}

// Idempotent addModuleItem. Reads the module first and adds the assignment only
// when it is not already there, so a reused assignment, a retry, or a re-link
// does not stack duplicate items. Returns the new item, or null when it already
// existed. Prefer this over addModuleItem for any flow that can run twice.
export async function ensureModuleItem(courseId, moduleId, assignmentId) {
  const items = await getModuleItems(courseId, moduleId)
  const already = items.some(i => i.type === 'Assignment' && i.contentId === assignmentId)
  if (already) return null
  return addModuleItem(courseId, moduleId, assignmentId)
}

function mapModule(raw) {
  return {
    id: String(raw.id),
    name: raw.name,
    position: raw.position ?? 0,
  }
}

function mapModuleItem(raw) {
  return {
    id: String(raw.id),
    moduleId: String(raw.module_id),
    contentId: raw.content_id ? String(raw.content_id) : null,
    type: raw.type,
  }
}
