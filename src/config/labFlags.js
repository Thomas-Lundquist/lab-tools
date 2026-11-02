// Lab professionalism flags — DATA, not logic. The scoring rules live in
// kitchenScoring.js; this file only declares which flags exist.
//
// Two kinds:
//   - Kitchen flags apply to every student in that kitchen. Each is 'minor' or
//     'critical'; kitchenScoring.js turns the per-kitchen minor/critical counts
//     into a kitchen score (see that file for the thresholds).
//   - Individual flags apply to one student. Each is also 'minor' or 'critical'
//     (shown as Major), weighted like kitchen flags — a Major counts as two
//     Minors: a Minor drops the student one tier, a Major two
//     (studentScore = max(1, kitchenScore - individualPenalty)). A flag saved
//     before individual severities existed has none and counts as Minor.
//
// `id` is a STABLE slug and is what a stored lab records — never the label or an
// array index. That way the teacher can reword a label here, or reorder the
// lists, without changing the meaning of flags already saved on past labs. Add
// or remove entries freely; only reuse an old `id` for the same concept.

export const KITCHEN_FLAGS = [
  { id: 'cleanup-not-finished',     label: 'Cleanup not finished at bell',                        scope: 'kitchen', severity: 'minor' },
  { id: 'floor-not-swept',          label: 'Floor not swept',                                     scope: 'kitchen', severity: 'minor' },
  { id: 'dishes-left-unwashed',     label: 'Dishes left unwashed',                                scope: 'kitchen', severity: 'minor' },
  { id: 'extra-duty-not-done',      label: 'Extra duty not completed',                            scope: 'kitchen', severity: 'minor' },
  { id: 'worked-without-recipe',    label: 'Worked without referring to recipe',                  scope: 'kitchen', severity: 'minor' },
  { id: 'grazing-beyond-recipe',    label: 'Grazing / took product beyond recipe',                scope: 'kitchen', severity: 'minor' },
  { id: 'equipment-dirty-or-wet',   label: 'Equipment put away dirty or wet',                     scope: 'kitchen', severity: 'minor' },
  { id: 'burners-left-on',          label: 'Burners / oven / griddle left on',                    scope: 'kitchen', severity: 'minor' },
  { id: 'shared-space-worse',       label: 'Shared space left worse than found',                  scope: 'kitchen', severity: 'minor' },
  { id: 'repeated-safety-failure',  label: 'Repeated safety or sanitation failure after correction', scope: 'kitchen', severity: 'critical' },
  { id: 'equipment-on-unattended',  label: 'Equipment left on and unattended',                    scope: 'kitchen', severity: 'critical' },
]

export const INDIVIDUAL_FLAGS = [
  { id: 'left-share-to-group',      label: 'Left their share to the group',               scope: 'individual', severity: 'minor' },
  { id: 'unsafe-horseplay',         label: 'Unsafe behavior / horseplay / throwing',      scope: 'individual', severity: 'minor' },
  { id: 'left-kitchen-repeatedly',  label: 'Left kitchen repeatedly or for extended time', scope: 'individual', severity: 'minor' },
  { id: 'ignored-correction',       label: 'Ignored correction',                          scope: 'individual', severity: 'minor' },
  { id: 'phone-out',                label: 'Phone out during lab',                        scope: 'individual', severity: 'minor' },
  { id: 'no-apron-or-hair',         label: 'No apron / hair not tied back',               scope: 'individual', severity: 'minor' },
  { id: 'eating-or-drinking',       label: 'Eating or drinking outside of tasting',       scope: 'individual', severity: 'minor' },
]

// The built-in defaults as one flat list. Seeds the teacher-editable store
// (storage/setup.js getFlags) and is the fallback whenever no custom list exists.
export const DEFAULT_FLAGS = [...KITCHEN_FLAGS, ...INDIVIDUAL_FLAGS]

// Lookup by id across the built-in lists — the default index for callers that
// have no custom flag config (e.g. unit tests). Live screens pass their own
// resolved index instead (see flagIndex / resolveFlags).
export const FLAG_BY_ID = Object.fromEntries(DEFAULT_FLAGS.map(f => [f.id, f]))

// Resolve the active flag list: the teacher's stored list if there is one, else
// the built-in defaults. `stored` is whatever storage/setup.js getFlags returned.
export function resolveFlags(stored) {
  return stored ?? DEFAULT_FLAGS
}

// Split a flag list into the lookups the screens need: an id->flag map plus the
// scope-filtered arrays the kitchen/individual pickers render.
export function flagIndex(flags = DEFAULT_FLAGS) {
  return {
    byId: Object.fromEntries(flags.map(f => [f.id, f])),
    kitchen: flags.filter(f => f.scope === 'kitchen'),
    individual: flags.filter(f => f.scope === 'individual'),
  }
}

// Count the minor and critical kitchen flags in a set of kitchen flag ids, using
// the given id->flag index (defaults to the built-in one). Unknown ids (a flag
// removed after a lab was saved) are ignored rather than throwing, so old labs
// still score.
// Tiers a student's own flags take off their kitchen's score: 1 per Minor,
// 2 per Major (critical). Unknown ids (a flag removed after the lab was saved)
// and flags with no severity count as Minor, which is what every individual
// flag was before severities existed — so older labs keep their scores.
export function individualPenalty(flagIds = [], byId = FLAG_BY_ID) {
  return flagIds.reduce((sum, id) => sum + (byId[id]?.severity === 'critical' ? 2 : 1), 0)
}

export function countKitchenSeverities(flagIds = [], byId = FLAG_BY_ID) {
  let minor = 0
  let critical = 0
  for (const id of flagIds) {
    const flag = byId[id]
    if (flag?.scope !== 'kitchen') continue
    if (flag.severity === 'critical') critical++
    else if (flag.severity === 'minor') minor++
  }
  return { minor, critical }
}
