import { useState } from 'react'
import Modal from '../../components/Modal.jsx'
import Button from '../../components/Button.jsx'
import TextField from '../../components/TextField.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import Select from '../../components/Select.jsx'
import { useToast } from '../../components/Toast.jsx'
import { updateAssignment } from '../../api/assignments.js'
import { getModuleItems, ensureModuleItem, deleteModuleItem } from '../../api/modules.js'
import { createOverride, updateOverride, deleteOverride, getOverrides } from '../../api/overrides.js'
import { saveLab } from '../../storage/setup.js'
import { isProfessionalismAssignment } from './scoring.js'
import {
  STANDALONE, JournalSelect, ModulePicker, SCOPE_OPTIONS, inferScope, journalOverrideDates,
} from './LabFormFields.jsx'
import { reconcileScope } from './scopeDiff.js'

// Edits a tracked Professionalism assignment's metadata: title, Module, scope
// (All periods / A-day / B-day), and the Standalone<->Pairing journal link.
// A period's own lab date is edited in EntryRow's "Periods on this
// assignment" panel, not here — this modal only touches what the create form
// sets once and, until now, never let you change again.
export default function EditLabModal({ entry, assignment, assignments, modules, sections, courseSetup, courseId, onClose, onSaved }) {
  const toast = useToast()
  const assignmentId = entry.professionalismAssignmentId

  const [title, setTitle]       = useState(assignment?.name ?? entry.name)
  const [moduleId, setModuleId] = useState(entry.moduleId ?? '')
  const [journalId, setJournalId] = useState(entry.journalAssignmentId ?? STANDALONE)
  // The scope this assignment is already in, inferred from Canvas — captured
  // once so a later re-render (e.g. a toast) doesn't reset the comparison
  // handleSave uses to decide whether scope actually changed.
  const [originalScope] = useState(() => inferScope(assignment, courseSetup) ?? 'all')
  const [scope, setScope] = useState(originalScope)
  const [saving, setSaving] = useState(false)

  const standalone = journalId === STANDALONE
  // Every other assignment in the course is a journal candidate — simpler than
  // the create form's "likely lab journal" narrowing, since here the teacher
  // is very likely fixing a specific mis-link rather than browsing cold.
  const journalCandidates = assignments
    .filter(a => a.id !== assignmentId)
    .filter(a => !isProfessionalismAssignment(a.name))
    .sort((a, b) => (b.published - a.published) || a.name.localeCompare(b.name, undefined, { numeric: true }))

  const scopeOptions = scope === 'custom'
    ? [{ value: 'custom', label: 'Custom (mixed) — pick one to normalize' }, ...SCOPE_OPTIONS]
    : SCOPE_OPTIONS

  async function handleSave() {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) { toast('Enter a title.', 'warning'); return }
    if (!isProfessionalismAssignment(trimmedTitle)) {
      toast('The title needs the word "Professionalism" so Unit & Term Scores can find it.', 'warning')
      return
    }
    setSaving(true)
    try {
      const scopeChanged = scope !== 'custom' && scope !== originalScope
      const patch = {}
      if (trimmedTitle !== (assignment?.name ?? entry.name)) patch.name = trimmedTitle
      if (scopeChanged) patch.onlyVisibleToOverrides = scope !== 'all'
      if (Object.keys(patch).length > 0) await updateAssignment(courseId, assignmentId, patch)

      // Module: drop the old item (if any), add the new one (if any) —
      // ensureModuleItem already no-ops when it's somehow already there.
      const oldModuleId = entry.moduleId ?? ''
      if (moduleId !== oldModuleId) {
        if (oldModuleId) {
          const items = await getModuleItems(courseId, oldModuleId)
          const item = items.find(i => i.type === 'Assignment' && i.contentId === assignmentId)
          if (item) await deleteModuleItem(courseId, oldModuleId, item.id)
        }
        if (moduleId) await ensureModuleItem(courseId, moduleId, assignmentId)
      }

      // Scope: reconcile which sections carry a professionalism override
      // against the newly-picked scope. A section leaving scope also loses
      // its journal override (using whichever journal is linked today — the
      // journal-link step below handles the *new* journal separately) and its
      // lab date, the same cleanup EntryRow's "Remove a period" does.
      let dates = { ...entry.dates }
      let closeDates = { ...entry.closeDates }
      if (scopeChanged) {
        const currentOverrides = await getOverrides(courseId, assignmentId)
        const coveredSectionIds = currentOverrides.map(o => o.courseSectionId).filter(Boolean)
        const { toAdd, toRemove } = reconcileScope(sections, courseSetup, coveredSectionIds, scope)
        for (const sec of toAdd) {
          await createOverride(courseId, assignmentId, { courseSectionId: sec.id, title: sec.name })
        }
        for (const sectionId of toRemove) {
          const profOverride = currentOverrides.find(o => o.courseSectionId === sectionId)
          if (profOverride) await deleteOverride(courseId, assignmentId, profOverride.id)
          if (entry.journalAssignmentId) {
            const journalOverrides = await getOverrides(courseId, entry.journalAssignmentId)
            const journalOverride = journalOverrides.find(o => o.courseSectionId === sectionId)
            if (journalOverride) await deleteOverride(courseId, entry.journalAssignmentId, journalOverride.id)
          }
          delete dates[sectionId]
          delete closeDates[sectionId]
        }
      }

      // Journal link: Standalone -> Pairing, Pairing -> Standalone, or
      // switched to a different journal. Detaching never touches Canvas —
      // only attaching (to a journal that isn't already the current one)
      // writes journal overrides, copying each still-covered section's known
      // lab date. A section with no known date is skipped and reported.
      const newJournalId = standalone ? null : journalId
      let journalSkipped = 0
      if (newJournalId && newJournalId !== entry.journalAssignmentId) {
        const journalDueOffset   = courseSetup?.settings?.journalDueOffsetDays ?? 1
        const journalCloseOffset = courseSetup?.settings?.labCloseDateOffsetDays ?? 14
        const currentOverrides = await getOverrides(courseId, assignmentId)
        const coveredSectionIds = currentOverrides.map(o => o.courseSectionId).filter(Boolean)
        const existingJournalOverrides = await getOverrides(courseId, newJournalId)
        for (const sectionId of coveredSectionIds) {
          const labDate = dates[sectionId]
          if (!labDate) { journalSkipped++; continue }
          const sec = sections.find(s => s.id === sectionId)
          const fields = { courseSectionId: sectionId, ...journalOverrideDates(labDate, journalDueOffset, journalCloseOffset), title: sec?.name ?? sectionId }
          const existing = existingJournalOverrides.find(o => o.courseSectionId === sectionId)
          if (existing) await updateOverride(courseId, newJournalId, existing.id, fields)
          else await createOverride(courseId, newJournalId, fields)
        }
      }

      await saveLab({ id: entry.id, name: trimmedTitle, moduleId: moduleId || null, journalAssignmentId: newJournalId, dates, closeDates })

      toast(
        journalSkipped
          ? `Saved, but ${journalSkipped} period${journalSkipped === 1 ? '' : 's'} had no lab date to copy to the journal.`
          : 'Saved.',
        journalSkipped ? 'warning' : 'success',
      )
      onSaved?.()
    } catch (err) {
      toast(`Could not save changes: ${err.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Edit "${assignment?.name ?? entry.name}"`}
      onClose={() => !saving && onClose()}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </>}
    >
      <div className="space-y-4">
        <div>
          <FieldLabel htmlFor="edit-title" required>Title</FieldLabel>
          <TextField id="edit-title" value={title} onChange={setTitle} />
        </div>

        <div>
          <FieldLabel htmlFor="edit-module">Module</FieldLabel>
          <ModulePicker id="edit-module" modules={modules} value={moduleId} onChange={setModuleId} />
        </div>

        <div>
          <FieldLabel htmlFor="edit-scope">Assign to</FieldLabel>
          <Select id="edit-scope" value={scope} onChange={setScope} options={scopeOptions} />
          {scope === 'custom' && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              This assignment's periods don't all share one day type. Pick All periods, A-day, or B-day to normalize it.
            </p>
          )}
        </div>

        <div>
          <FieldLabel htmlFor="edit-journal">Journal</FieldLabel>
          <JournalSelect
            id="edit-journal"
            value={journalId}
            onChange={setJournalId}
            labOptions={[]}
            otherOptions={journalCandidates}
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {standalone
              ? 'Standalone — no journal attached.'
              : 'Attaching copies each covered period’s known lab date to the journal as a due date.'}
          </p>
        </div>
      </div>
    </Modal>
  )
}
