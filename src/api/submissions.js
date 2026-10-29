import { canvasGetAll, canvasPut } from './request.js'

// Returns all assignments for a course enriched with submission_summary counts.
// Used by Grading Dashboard. Future: At-Risk Dashboard, Grade Trend features.
export async function getAssignmentsWithGradingData(courseId) {
  const assignments = await canvasGetAll(`/api/v1/courses/${courseId}/assignments`, {
    include: ['assignment_group', 'submission_summary'],
    order_by: 'position',
  })
  return assignments.map(mapAssignmentWithGrading)
}

// Returns individual submissions for one assignment — per-student detail view.
// Future: grade entry, submission review, at-risk flagging.
export async function getAssignmentSubmissions(courseId, assignmentId, { includeComments = false } = {}) {
  const subs = await canvasGetAll(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`,
    { include: includeComments ? ['user', 'submission_comments'] : ['user'], student_ids: ['all'] },
  )
  return subs.map(mapSubmission)
}

// Returns submissions across a course's assignments in one grouped call. Pass
// assignmentIds to scope it to just those assignments — far fewer pages than
// pulling every assignment's submissions, which matters on a real course.
export async function getCourseSubmissions(courseId, assignmentIds) {
  const params = { student_ids: ['all'], include: ['assignment'] }
  if (assignmentIds?.length) params.assignment_ids = assignmentIds
  const subs = await canvasGetAll(
    `/api/v1/courses/${courseId}/students/submissions`,
    params,
  )
  return subs.map(mapSubmission)
}

// Update one student's grade on an assignment.
// fields: { posted_grade: '85' } to set a score, '' to clear it, or { excuse: true }
// to excuse. A `text_comment` field is lifted into Canvas's separate top-level
// `comment` param — Canvas doesn't accept comments nested under `submission`.
export async function updateSubmissionGrade(courseId, assignmentId, userId, fields) {
  const { text_comment, ...submissionFields } = fields
  const body = { submission: submissionFields }
  if (text_comment) body.comment = { text_comment }
  return canvasPut(
    `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`,
    body,
  )
}

function mapAssignmentWithGrading(raw) {
  const s = raw.submission_summary
  return {
    id:                  String(raw.id),
    courseId:            String(raw.course_id),
    name:                raw.name,
    dueAt:               raw.due_at,
    pointsPossible:      raw.points_possible,
    published:           raw.published,
    gradingType:         raw.grading_type,
    submissionTypes:     raw.submission_types ?? [],
    assignmentGroupId:   raw.assignment_group_id ? String(raw.assignment_group_id) : null,
    assignmentGroupName: raw.assignment_group?.name ?? null,
    position:            raw.position ?? 0,
    submissionSummary: s
      ? {
          graded:       s.graded       ?? 0,
          ungraded:     s.ungraded     ?? 0,
          notSubmitted: s.not_submitted ?? 0,
        }
      : null,
  }
}

function mapSubmission(raw) {
  return {
    id:            String(raw.id),
    assignmentId:  String(raw.assignment_id),
    userId:        String(raw.user_id),
    userName:      raw.user?.name            ?? null,
    score:         raw.score,
    grade:         raw.grade,
    workflowState: raw.workflow_state,   // 'submitted'|'unsubmitted'|'graded'|'pending_review'
    submittedAt:   raw.submitted_at,
    gradedAt:      raw.graded_at,
    late:          raw.late    ?? false,
    missing:       raw.missing ?? false,
    excused:       raw.excused ?? false,
    // Present only when requested with include[]=submission_comments. The comment
    // bodies already on the submission — used to avoid re-posting an identical one.
    comments:      raw.submission_comments ? raw.submission_comments.map(c => c.comment) : [],
  }
}
