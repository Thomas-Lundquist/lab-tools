// The Canvas writes for marking one student absent on a lab. Extracted verbatim
// from AttendancePanel's doConfirm so the new kitchen grading screen commits an
// absence exactly the way the old Attendance tab did: zero the professionalism
// score, optionally zero the journal, and lock the journal so the student can't
// take it until a makeup is graded. Absent is the "0, no evidence" state.

import { updateSubmissionGrade } from '../../api/submissions.js'
import { createOverride } from '../../api/overrides.js'

export async function commitAbsent(courseId, entry, userId, { excused, zeroJournalWhenAbsent, userName }) {
  await updateSubmissionGrade(courseId, entry.professionalismAssignmentId, userId, {
    posted_grade: '0',
    ...(excused ? { text_comment: 'Excused absence — zero until the lab makeup is graded.' } : {}),
  })

  if (entry.journalAssignmentId && zeroJournalWhenAbsent) {
    await updateSubmissionGrade(courseId, entry.journalAssignmentId, userId, { posted_grade: '0' })
  }

  if (entry.journalAssignmentId) {
    await createOverride(courseId, entry.journalAssignmentId, {
      studentIds: [userId],
      lockAt: new Date().toISOString(),
      title: `${userName ?? 'Student'} — absent lock`,
    })
  }
}
