import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import Button from '../../components/Button.jsx'
import TextField from '../../components/TextField.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import Modal from '../../components/Modal.jsx'
import Card from '../../components/Card.jsx'
import Callout from '../../components/Callout.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import { useToast } from '../../components/Toast.jsx'
import { usePinGate } from '../../security/usePinGate.jsx'
import { getSections } from '../../api/sections.js'
import { getModules } from '../../api/modules.js'
import { deleteAssignment } from '../../api/assignments.js'
import { NotFoundError } from '../../api/errors.js'
import {
  saveSectionDayType, saveCourseSettings, getTerms, saveTerm, deleteTerm,
  getLabs, deleteLabsForCourse, resetCourseSetup, getCourseSetup,
} from '../../storage/setup.js'

// Confirms "Clear setup" — a two-way choice (preserve pairings vs. also
// permanently delete their Canvas Professionalism assignments) plus an
// explicit, named list of what gets deleted when that second option is
// picked. Rendered as its own fixed overlay rather than nesting <Modal>
// inside <Modal> — stacking two of those would double up the Escape-key
// handler each one installs on `document`.
function ClearSetupConfirm({ courseName, pairings, choice, onChoiceChange, onCancel, onConfirm, busy }) {
  const deleting = choice === 'delete'
  const count = pairings.length
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <Card padding="lg" className="max-w-md w-full space-y-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-error)]">Clear setup for {courseName}?</h3>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Resets Enabled, the Professionalism assignment group link, section day types, deduction settings, and
            every Term for this course back to a blank slate. Other courses are not affected.
          </p>
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="clear-pairings" className="mt-0.5" checked={choice === 'keep'} onChange={() => onChoiceChange('keep')} />
            <span>
              <span className="font-medium text-[var(--color-text-body)]">Keep existing pairings</span><br />
              <span className="text-[var(--color-text-muted)]">
                {count} pairing{count === 1 ? '' : 's'} and {count === 1 ? 'its' : 'their'} Canvas Professionalism assignment{count === 1 ? '' : 's'} are left exactly as-is.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="clear-pairings"
              className="mt-0.5"
              checked={choice === 'delete'}
              onChange={() => onChoiceChange('delete')}
              disabled={count === 0}
            />
            <span>
              <span className="font-medium text-[var(--color-text-body)]">Delete pairings and their Canvas assignments</span><br />
              <span className="text-[var(--color-text-muted)]">
                {count === 0 ? 'No pairings exist for this course.' : `Also permanently deletes ${count} Professionalism assignment${count === 1 ? '' : 's'} from Canvas.`}
              </span>
            </span>
          </label>
        </div>

        {deleting && count > 0 && (
          <Callout tone="error" title="This cannot be undone">
            <p>
              The following Canvas assignment{count === 1 ? '' : 's'} — and any grades already entered on {count === 1 ? 'it' : 'them'} —
              will be permanently deleted:
            </p>
            <ul className="list-disc list-inside mt-1">
              {pairings.map(p => <li key={p.id}>{p.name}</li>)}
            </ul>
          </Callout>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Clearing…' : 'Clear Setup'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

// Everything about a course's configuration that *isn't* required just to
// unlock the tabs (see SetupBootstrapModal for Enable + the Professionalism
// group) — edit anytime via the gear icon next to the tabs.
export default function CourseSettingsModal({ courseId, courseName, setup, onSetupChange, onChanged, onClose }) {
  const toast = useToast()
  const { requirePin } = usePinGate()

  const [loading, setLoading]         = useState(true)
  const [sections, setSections]       = useState([])
  const [modules, setModules]         = useState([])
  const [terms, setTerms]             = useState([])
  const [pairings, setPairings]       = useState([])
  const [newReason, setNewReason]     = useState('')
  const [newComment, setNewComment]   = useState('')
  const [newTermName, setNewTermName] = useState('')

  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearChoice, setClearChoice]           = useState('keep')
  const [clearing, setClearing]                 = useState(false)

  useEffect(() => {
    if (!courseId) return
    setLoading(true)
    Promise.all([getSections(courseId), getModules(courseId), getTerms(courseId), getLabs(courseId)])
      .then(([secs, mods, trms, pairs]) => {
        setSections(secs)
        setModules(mods)
        setTerms(trms)
        setPairings(pairs)
      })
      .finally(() => setLoading(false))
  }, [courseId])

  async function updateSettings(fieldPatch) {
    const updated = await saveCourseSettings(courseId, fieldPatch)
    onSetupChange?.(updated)
    onChanged?.()
  }

  async function handleDayType(sectionId, dayType) {
    const updated = await saveSectionDayType(courseId, sectionId, dayType)
    onSetupChange?.(updated)
    onChanged?.()
  }

  function addReason() {
    const r = newReason.trim()
    if (!r || setup.settings.deductionReasons.includes(r)) { setNewReason(''); return }
    updateSettings({ deductionReasons: [...setup.settings.deductionReasons, r] })
    setNewReason('')
  }

  function removeReason(r) {
    updateSettings({ deductionReasons: setup.settings.deductionReasons.filter(x => x !== r) })
  }

  function addComment() {
    const c = newComment.trim()
    const library = setup.settings.commentLibrary ?? []
    if (!c || library.includes(c)) { setNewComment(''); return }
    updateSettings({ commentLibrary: [...library, c] })
    setNewComment('')
  }

  function removeComment(c) {
    updateSettings({ commentLibrary: (setup.settings.commentLibrary ?? []).filter(x => x !== c) })
  }

  async function handleCreateTerm() {
    const trimmed = newTermName.trim()
    if (!trimmed) return
    const term = await saveTerm({ courseId, name: trimmed, moduleIds: [] })
    setTerms(prev => [...prev, term])
    setNewTermName('')
  }

  async function toggleTermModule(term, moduleId) {
    const moduleIds = term.moduleIds.includes(moduleId)
      ? term.moduleIds.filter(id => id !== moduleId)
      : [...term.moduleIds, moduleId]
    const updated = await saveTerm({ ...term, moduleIds })
    setTerms(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  async function handleDeleteTerm(termId) {
    await deleteTerm(termId)
    setTerms(prev => prev.filter(t => t.id !== termId))
  }

  // Deletes each pairing's Canvas Professionalism assignment one at a time
  // before dropping any local state, so a mid-way failure (one assignment
  // 403s, say) leaves the surviving pairings' records intact rather than
  // forgetting about assignments Canvas still has. A 404 means the
  // assignment is already gone (e.g. deleted by hand in Canvas) — that
  // counts as success, not a failure to report.
  async function doClearSetup(deletePairings) {
    setClearing(true)
    try {
      let failed = 0
      if (deletePairings) {
        for (const pairing of pairings) {
          try {
            await deleteAssignment(courseId, pairing.professionalismAssignmentId)
          } catch (err) {
            if (!(err instanceof NotFoundError)) failed++
          }
        }
        await deleteLabsForCourse(courseId)
      }
      await resetCourseSetup(courseId)
      onSetupChange?.(await getCourseSetup(courseId))
      onChanged?.()

      if (failed) {
        toast(`Setup cleared, but ${failed} Professionalism assignment${failed === 1 ? '' : 's'} could not be deleted from Canvas — remove ${failed === 1 ? 'it' : 'them'} by hand if needed`, 'warning')
      } else {
        toast(deletePairings ? 'Setup cleared and pairings deleted from Canvas' : 'Setup cleared — pairings preserved', 'success')
      }
      setShowClearConfirm(false)
      onClose?.()
    } catch (err) {
      toast(`Could not clear setup: ${err.message}`, 'error')
    } finally {
      setClearing(false)
    }
  }

  async function handleConfirmClearSetup() {
    const deletePairings = clearChoice === 'delete'
    const count = pairings.length
    const summary = deletePairings
      ? `Cleared setup for ${courseName} and permanently deleted ${count} Professionalism assignment${count === 1 ? '' : 's'} from Canvas`
      : `Cleared setup for ${courseName} (${count} pairing${count === 1 ? '' : 's'} preserved)`
    const warning = deletePairings
      ? `This permanently deletes ${count} Professionalism assignment${count === 1 ? '' : 's'} from Canvas, including any grades already entered on them. This cannot be undone.`
      : "This resets this course's setup — Enabled, the Professionalism group, section day types, deduction settings, and Terms. Existing pairings and their Canvas assignments are left untouched."
    await requirePin(
      { action: 'clear_course_setup', summary, courseId, courseName, warning },
      () => doClearSetup(deletePairings),
      { forcePrompt: true },
    )
  }

  return (
    <>
    <Modal
      title={`Course settings for ${courseName ?? 'this course'}`}
      onClose={onClose}
      size="lg"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {loading || !setup ? (
        <div className="space-y-3">
          <Skeleton height="6rem" />
          <Skeleton height="10rem" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--color-text-body)]">Sections — A day / B day</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Used to prefill each lab's due date per section.</p>
            <div className="divide-y divide-[var(--color-border-subtle)]">
              {sections.map(sec => (
                <div key={sec.id} className="flex items-center justify-between py-2">
                  <span className="text-sm text-[var(--color-text-body)]">{sec.name}</span>
                  <div className="segmented-control">
                    {['A', 'B'].map(day => (
                      <button
                        key={day}
                        aria-pressed={setup.sections[sec.id]?.dayType === day}
                        onClick={() => handleDayType(sec.id, day)}
                      >
                        {day} day
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {sections.length === 0 && <p className="text-sm text-[var(--color-text-muted)] py-2">No sections found.</p>}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--color-text-body)]">Settings</h3>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Sync per-lab professionalism assignments to Focus (SIS)</span>
              <input type="checkbox" checked={setup.settings.syncLabsToFocus} onChange={e => updateSettings({ syncLabsToFocus: e.target.checked })} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Sync unit and term score assignments to Focus (SIS)</span>
              <input type="checkbox" checked={setup.settings.syncUnitTermToFocus} onChange={e => updateSettings({ syncUnitTermToFocus: e.target.checked })} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Enter a 0 on the journal when a student is marked absent</span>
              <input type="checkbox" checked={setup.settings.zeroJournalWhenAbsent} onChange={e => updateSettings({ zeroJournalWhenAbsent: e.target.checked })} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Send deduction reasons to students as a submission comment</span>
              <input type="checkbox" checked={setup.settings.sendDeductionReasonsAsComment} onChange={e => updateSettings({ sendDeductionReasonsAsComment: e.target.checked })} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Journal due date — days after the lab date</span>
              <TextField
                type="number"
                value={String(setup.settings.journalDueOffsetDays)}
                onChange={v => updateSettings({ journalDueOffsetDays: Math.max(0, parseInt(v, 10) || 0) })}
                className="w-20 text-right"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Journal close date — days after the Journal due date</span>
              <TextField
                type="number"
                value={String(setup.settings.labCloseDateOffsetDays)}
                onChange={v => updateSettings({ labCloseDateOffsetDays: Math.max(0, parseInt(v, 10) || 0) })}
                className="w-20 text-right"
              />
            </label>

            <div>
              <FieldLabel>Deduction reasons</FieldLabel>
              <div className="flex flex-wrap gap-2 mb-2">
                {setup.settings.deductionReasons.map(r => (
                  <span key={r} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
                    {r}
                    <button onClick={() => removeReason(r)} aria-label={`Remove ${r}`} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-body)]">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <TextField value={newReason} onChange={setNewReason} placeholder="Add a reason" className="max-w-xs" onKeyDown={e => e.key === 'Enter' && addReason()} />
                <Button variant="secondary" size="sm" onClick={addReason}>Add</Button>
              </div>
            </div>

            <div>
              <FieldLabel>Comment library</FieldLabel>
              <p className="text-xs text-[var(--color-text-muted)] mb-2">
                Reusable feedback you can pick in the Score tab. These add to the submission comment but do not change the score.
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                {(setup.settings.commentLibrary ?? []).map(c => (
                  <span key={c} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
                    {c}
                    <button onClick={() => removeComment(c)} aria-label={`Remove ${c}`} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-body)]">
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {(setup.settings.commentLibrary ?? []).length === 0 && (
                  <span className="text-xs text-[var(--color-text-muted)]">No saved comments yet.</span>
                )}
              </div>
              <div className="flex gap-2">
                <TextField value={newComment} onChange={setNewComment} placeholder="Add a comment" className="max-w-xs" onKeyDown={e => e.key === 'Enter' && addComment()} />
                <Button variant="secondary" size="sm" onClick={addComment}>Add</Button>
              </div>
            </div>

            <div>
              <FieldLabel>Deduction scoring — how marks turn into a score out of 4</FieldLabel>
              <p className="text-xs text-[var(--color-text-muted)] mb-2">
                The first mark always costs a full point; after that, every N additional marks cost one more point.
              </p>
              <div className="flex items-center gap-3 text-sm">
                <span>Points lost per step</span>
                <TextField
                  type="number"
                  value={String(setup.settings.deductionPointsPerStep)}
                  onChange={v => updateSettings({ deductionPointsPerStep: Math.max(0, parseInt(v, 10) || 0) })}
                  className="w-16 text-right"
                />
                <span>Marks per step (N)</span>
                <TextField
                  type="number"
                  value={String(setup.settings.deductionMarksPerStep)}
                  onChange={v => updateSettings({ deductionMarksPerStep: Math.max(1, parseInt(v, 10) || 1) })}
                  className="w-16 text-right"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--color-text-body)]">Terms</h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Group Modules into a Term — the Scoring tab rolls each Term's Modules up into one score.
            </p>

            {terms.length > 0 && (
              <div className="divide-y divide-[var(--color-border-subtle)]">
                {terms.map(term => (
                  <div key={term.id} className="py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--color-text-body)]">{term.name}</span>
                      <button
                        onClick={() => handleDeleteTerm(term.id)}
                        aria-label={`Delete ${term.name}`}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {modules.map(mod => {
                        const included = term.moduleIds.includes(mod.id)
                        return (
                          <button
                            key={mod.id}
                            onClick={() => toggleTermModule(term, mod.id)}
                            aria-pressed={included}
                            className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                              included
                                ? 'border-[var(--cpt-color-text)] text-[var(--cpt-color-text)]'
                                : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                            }`}
                          >
                            {mod.name}
                          </button>
                        )
                      })}
                      {modules.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No modules found in this course.</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <TextField value={newTermName} onChange={setNewTermName} placeholder="Term 1" className="max-w-xs" onKeyDown={e => e.key === 'Enter' && handleCreateTerm()} />
              <Button variant="secondary" size="sm" onClick={handleCreateTerm}>Add Term</Button>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-error)]">Danger zone</h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Resets this course — Enabled, the Professionalism group, section day types, deduction settings, and
              Terms — back to a blank slate. Useful for testing setup from scratch. You'll separately choose whether
              to keep existing pairings or also delete them (and their Canvas assignments) permanently.
            </p>
            <Button variant="danger" size="sm" onClick={() => { setClearChoice('keep'); setShowClearConfirm(true) }}>
              Clear Setup for This Course…
            </Button>
          </div>
        </div>
      )}
    </Modal>
    {showClearConfirm && (
      <ClearSetupConfirm
        courseName={courseName}
        pairings={pairings}
        choice={clearChoice}
        onChoiceChange={setClearChoice}
        onCancel={() => !clearing && setShowClearConfirm(false)}
        onConfirm={handleConfirmClearSetup}
        busy={clearing}
      />
    )}
    </>
  )
}
