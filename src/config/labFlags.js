// Lab professionalism flags — DATA, not logic. The scoring rules live in
// kitchenScoring.js; this file only declares which flags exist.
//
// Two kinds:
//   - Kitchen flags apply to every student in that kitchen. Each is 'minor' or
//     'critical'; kitchenScoring.js turns the per-kitchen minor/critical counts
//     into a kitchen score (see that file for the thresholds).
//   - Individual flags apply to one student and each drops their score one tier
//     (studentScore = max(1, kitchenScore - individualFlagCount)).
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
  { id: 'left-share-to-group',      label: 'Left their share to the group',               scope: 'individual' },
  { id: 'unsafe-horseplay',         label: 'Unsafe behavior / horseplay / throwing',      scope: 'individual' },
  { id: 'left-kitchen-repeatedly',  label: 'Left kitchen repeatedly or for extended time', scope: 'individual' },
  { id: 'ignored-correction',       label: 'Ignored correction',                          scope: 'individual' },
  { id: 'phone-out',                label: 'Phone out during lab',                        scope: 'individual' },
  { id: 'no-apron-or-hair',         label: 'No apron / hair not tied back',               scope: 'individual' },
  { id: 'eating-or-drinking',       label: 'Eating or drinking outside of tasting',       scope: 'individual' },
]

// Lookup by id across both lists — handy when a stored lab only kept flag ids.
export const FLAG_BY_ID = Object.fromEntries(
  [...KITCHEN_FLAGS, ...INDIVIDUAL_FLAGS].map(f => [f.id, f]),
)

// Count the minor and critical kitchen flags in a set of kitchen flag ids.
// Unknown ids (a flag removed from the lists after a lab was saved) are ignored
// rather than throwing, so old labs still score.
export function countKitchenSeverities(flagIds = []) {
  let minor = 0
  let critical = 0
  for (const id of flagIds) {
    const flag = FLAG_BY_ID[id]
    if (flag?.scope !== 'kitchen') continue
    if (flag.severity === 'critical') critical++
    else if (flag.severity === 'minor') minor++
  }
  return { minor, critical }
}
