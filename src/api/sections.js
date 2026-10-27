import { canvasGetAll } from './request.js'

// Returns all sections for a course with student counts.
export async function getSections(courseId) {
  const sections = await canvasGetAll(`/api/v1/courses/${courseId}/sections`, {
    include: ['students'],
  })
  return sections.map(mapSection)
}

function mapSection(raw) {
  return {
    id:           String(raw.id),
    name:         raw.name,
    studentCount: raw.total_students ?? raw.students?.length ?? 0,
    studentIds:   raw.students ? raw.students.map(s => String(s.id)) : [],
  }
}
