import { canvasGetAll } from './request.js'

// Returns active student enrollments for a course.
// Foundation for: Group Manager (auto-assign students), At-Risk Dashboard,
// per-student grading views, messaging features.
export async function getEnrollments(courseId, type = 'StudentEnrollment') {
  const enrollments = await canvasGetAll(`/api/v1/courses/${courseId}/enrollments`, {
    type:  [type],
    state: ['active'],
  })
  return enrollments.map(mapEnrollment)
}

// Returns teacher/TA enrollments — useful for multi-instructor course views.
export async function getTeacherEnrollments(courseId) {
  return getEnrollments(courseId, 'TeacherEnrollment')
}

function mapEnrollment(raw) {
  return {
    id:               String(raw.id),
    userId:           String(raw.user_id),
    courseId:         String(raw.course_id),
    type:             raw.type,
    enrollmentState:  raw.enrollment_state,
    userName:         raw.user?.name          ?? null,
    userSortableName: raw.user?.sortable_name ?? null,
    userEmail:        raw.user?.email         ?? null,
  }
}

// Returns active student enrollments with overall course grade data.
// current_score excludes unsubmitted work; final_score treats unsubmitted as zero.
export async function getEnrollmentsWithGrades(courseId) {
  const enrollments = await canvasGetAll(`/api/v1/courses/${courseId}/enrollments`, {
    type:    ['StudentEnrollment'],
    state:   ['active'],
    include: ['grades'],
  })
  return enrollments.map(mapEnrollmentWithGrades)
}

function mapEnrollmentWithGrades(raw) {
  const g = raw.grades ?? {}
  return {
    id:               String(raw.id),
    userId:           String(raw.user_id),
    courseId:         String(raw.course_id),
    type:             raw.type,
    enrollmentState:  raw.enrollment_state,
    userName:         raw.user?.name          ?? null,
    userSortableName: raw.user?.sortable_name ?? null,
    userEmail:        raw.user?.email         ?? null,
    currentScore:     g.current_score  ?? null,
    finalScore:       g.final_score    ?? null,
    currentGrade:     g.current_grade  ?? null,
    finalGrade:       g.final_grade    ?? null,
  }
}
