import { canvasGetAll } from './request.js'

export async function getCourses() {
  const courses = await canvasGetAll('/api/v1/courses', {
    enrollment_type: 'teacher',
    enrollment_state: 'active',
    include: ['term'],
  })

  return courses.map(course => ({
    id: String(course.id),
    name: course.name,
    courseCode: course.course_code,
    term: course.term?.name ?? null,
    startAt: course.start_at,
    endAt: course.end_at,
  }))
}
