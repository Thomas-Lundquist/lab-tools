import { sectionsInScope } from './labFormHelpers.js'

// Reconciles an assignment's section overrides against a newly-picked scope,
// for EditLabModal. `coveredSectionIds` is every section that currently has a
// professionalism override on the assignment (visible there regardless of
// `newScope`, until this diff is applied).
//
// 'all' never touches overrides — once onlyVisibleToOverrides is false the
// assignment is visible to everyone regardless of what overrides exist, and
// existing ones still carry useful due dates, so there is nothing to remove.
// A scoped target (`A`/`B`) needs every in-scope section to carry an
// override (even a dateless one, since that override is what grants
// visibility) and no out-of-scope section to keep one — a leftover override
// would stay visible to that section despite the new scope.
export function reconcileScope(sections, courseSetup, coveredSectionIds, newScope) {
  if (newScope === 'all') return { toAdd: [], toRemove: [] }
  const target = sectionsInScope(sections, courseSetup, newScope)
  const targetIds = new Set(target.map(s => s.id))
  const covered = new Set(coveredSectionIds)
  return {
    toAdd: target.filter(s => !covered.has(s.id)),
    toRemove: [...covered].filter(id => !targetIds.has(id)),
  }
}
