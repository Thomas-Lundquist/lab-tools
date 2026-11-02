// Turns an intercepted Canvas write into a plain-English line and the
// coverage categories it exercises. Pure, so it's unit-tested.

// The kinds of write Lab Tools makes, in the order the report's coverage
// checklist shows them. "Test everything" = every one of these lit up.
export const COVERAGE = [
  ['assignment-create', 'Create assignment'],
  ['assignment-update', 'Update assignment'],
  ['assignment-delete', 'Delete assignment'],
  ['override-create', 'Create due date / lock'],
  ['override-update', 'Update due date / lock'],
  ['override-delete', 'Remove due date / lock'],
  ['module-item-add', 'Add to module'],
  ['group-create', 'Create assignment group'],
  ['group-update', 'Update assignment group'],
  ['group-delete', 'Delete assignment group'],
  ['grade-post', 'Post a score'],
  ['grade-zero', 'Post an absence zero'],
  ['grade-clear', 'Clear a score'],
  ['excuse', 'Excuse'],
  ['comment', 'Post a comment'],
  ['sync', 'Sync to Canvas account'],
]

const ID = '(\\d+|debug-\\d+)'
const route = (re, method) => ({ re: new RegExp(`^/api/v1${re}$`), method })
const ROUTES = {
  submission:  route(`/courses/${ID}/assignments/${ID}/submissions/${ID}`, 'PUT'),
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
    if (sub.excuse) { parts.push('Excuse'); categories.push('excuse') }
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
