// Turns an intercepted Canvas write into a plain-English line and the
// coverage categories it exercises. Pure, so it's unit-tested.

// The kinds of write the app's screens can actually make, in the order the
// report's coverage checklist shows them, with how to trigger each. "Test
// everything" = every one of these lit up. Writes the API layer supports but no
// screen uses (update assignment, assignment-group update/delete) are left out,
// and sync is paused in debug mode; describeWrite still labels them if they
// ever appear. Add a row here when a screen gains a new kind of write.
export const COVERAGE = [
  ['assignment-create', 'Create assignment', 'Create a pairing or standalone, or push a Unit/Term score whose assignment doesn’t exist yet'],
  ['override-create', 'Create due date / lock', 'Create a pairing with lab dates, or commit a period with a student marked absent (locks their journal)'],
  ['override-update', 'Update due date / lock', 'Create a pairing whose journal already has dates for that section'],
  ['module-item-add', 'Add to module', 'Create a pairing or standalone with a Unit (module) chosen'],
  ['group-create', 'Create assignment group', 'Enable a course that has no Professionalism assignment group yet'],
  ['grade-post', 'Post a score', 'Commit a period, or push Unit/Term scores'],
  ['grade-zero', 'Post an absence zero', 'Commit a period with a student marked absent'],
  ['comment', 'Post a comment', 'Commit a period with a comment, a library comment, or (if on) flag summaries'],
  ['excuse', 'Excuse (Canvas excused)', 'Commit a period with a student marked absent and Excused'],
  ['grade-clear', 'Clear a score', 'Flip a committed absent student back to Present and recommit (clears their journal zero), or revert a commit'],
  ['override-delete', 'Remove a journal lock', 'Flip a committed absent student back to Present and recommit, or revert a commit'],
  ['comment-delete', 'Delete a comment', 'Revert a commit that posted a comment'],
  ['assignment-delete', 'Delete assignment', 'Delete a Professionalism assignment from Canvas (trash icon on its row), or Course settings › Clear setup, choosing to delete the pairings'],
]

const ID = '(\\d+|debug-\\d+)'
const route = (re, method) => ({ re: new RegExp(`^/api/v1${re}$`), method })
const ROUTES = {
  submission:  route(`/courses/${ID}/assignments/${ID}/submissions/${ID}`, 'PUT'),
  subComment:  route(`/courses/${ID}/assignments/${ID}/submissions/${ID}/comments/${ID}`, 'DELETE'),
  override:    route(`/courses/${ID}/assignments/${ID}/overrides(?:/${ID})?`),
  assignment:  route(`/courses/${ID}/assignments(?:/${ID})?`),
  moduleItem:  route(`/courses/${ID}/modules/${ID}/items`),
  group:       route(`/courses/${ID}/assignment_groups(?:/${ID})?`),
  customData:  route(`/users/self/custom_data(?:/.*)?`),
}

const verb = { POST: 'create', PUT: 'update', DELETE: 'delete' }
const quote = s => (s ? `“${s}”` : null)

export function describeWrite({ method, path, body = {}, context = {} }) {
  const m = re => path.match(re)
  let hit

  if ((hit = m(ROUTES.subComment.re)) && method === 'DELETE') {
    const who = context.studentName ?? `student ${hit[3]}`
    return { text: `Delete a comment for ${who} on ${context.assignmentLabel ? quote(context.assignmentLabel) : `assignment ${hit[2]}`}`, categories: ['comment-delete'] }
  }

  if ((hit = m(ROUTES.submission.re)) && method === 'PUT') {
    const [, , assignmentId, userId] = hit
    const sub = body?.submission ?? {}
    const comment = body?.comment?.text_comment
    const who = context.studentName ?? `student ${userId}`
    const what = context.assignmentLabel ? quote(context.assignmentLabel) : `assignment ${assignmentId}`
    const parts = []
    const categories = []
    if (Object.hasOwn(sub, 'posted_grade')) {
      if (sub.posted_grade === '') { parts.push('Clear the score'); categories.push('grade-clear') }
      else {
        // Absence zeros come from the attendance paths, which pass context.absent.
        const zero = context.absent && String(sub.posted_grade) === '0'
        parts.push(zero ? 'Post absence zero' : `Post ${sub.posted_grade}`)
        categories.push(zero ? 'grade-zero' : 'grade-post')
      }
    }
    if (sub.excuse === true) { parts.push('Excuse'); categories.push('excuse') }
    if (sub.excuse === false) { parts.push('Un-excuse'); categories.push('excuse') }
    if (comment !== undefined) { parts.push(parts.length ? '+ comment' : 'Post a comment'); categories.push('comment') }
    return { text: `${parts.join(' ') || 'Update submission'} for ${who} on ${what}`, categories }
  }

  if ((hit = m(ROUTES.override.re))) {
    const o = body?.assignment_override ?? {}
    const target = o.course_section_id ? `section ${o.course_section_id}`
      : o.student_ids ? `${o.student_ids.length} student${o.student_ids.length === 1 ? '' : 's'}` : 'an override'
    const dates = [o.due_at && `due ${o.due_at}`, o.lock_at && `locks ${o.lock_at}`, o.unlock_at && `opens ${o.unlock_at}`].filter(Boolean).join(', ')
    const action = { POST: 'Create', PUT: 'Update', DELETE: 'Remove' }[method]
    return { text: `${action} a date override for ${target} on assignment ${hit[2]}${dates ? ` (${dates})` : ''}`, categories: [`override-${verb[method]}`] }
  }

  if ((hit = m(ROUTES.assignment.re))) {
    const a = body?.assignment ?? {}
    const name = quote(a.name) ?? `assignment ${hit[2] ?? ''}`.trim()
    const text = method === 'POST' ? `Create assignment ${name}${a.points_possible != null ? ` (${a.points_possible} pts)` : ''}`
      : method === 'PUT' ? `Update assignment ${name}: ${Object.keys(a).join(', ') || 'no fields'}`
        : `Delete assignment ${hit[2]}`
    return { text, categories: [`assignment-${verb[method]}`] }
  }

  if ((hit = m(ROUTES.moduleItem.re)) && method === 'POST') {
    const i = body?.module_item ?? {}
    return { text: `Add ${quote(i.title) ?? `${i.type ?? 'item'} ${i.content_id ?? ''}`.trim()} to module ${hit[2]}`, categories: ['module-item-add'] }
  }

  if ((hit = m(ROUTES.group.re))) {
    const name = quote(body?.name) ?? `group ${hit[2] ?? ''}`.trim()
    return { text: `${{ POST: 'Create', PUT: 'Update', DELETE: 'Delete' }[method]} assignment group ${name}`, categories: [`group-${verb[method]}`] }
  }

  if (m(ROUTES.customData.re)) {
    return { text: `${method === 'DELETE' ? 'Erase' : 'Save'} synced data in your Canvas account`, categories: ['sync'] }
  }

  return { text: `${method} ${path}`, categories: [] }
}
