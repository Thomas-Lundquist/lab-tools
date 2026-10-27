import { canvasGetAll, canvasPost } from './request.js'

export async function getModules(courseId) {
  const modules = await canvasGetAll(`/api/v1/courses/${courseId}/modules`)
  return modules.map(mapModule).sort((a, b) => a.position - b.position)
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
