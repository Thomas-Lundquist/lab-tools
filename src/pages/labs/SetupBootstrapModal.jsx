import { useState, useEffect } from 'react'
import { CheckCircle2 } from 'lucide-react'
import Button from '../../components/Button.jsx'
import Modal from '../../components/Modal.jsx'
import Skeleton from '../../components/Skeleton.jsx'
import { useToast } from '../../components/Toast.jsx'
import { getAssignmentGroups, createAssignmentGroup } from '../../api/assignmentGroups.js'
import { saveCourseSetup } from '../../storage/setup.js'

// The two things that actually gate a course's readiness (App.jsx's `ready`).
// Everything else a teacher can configure for a course (sections, deduction
// settings, terms) lives in CourseSettingsModal instead, reachable any time
// via the gear icon — this modal is just the one-time bootstrap, and reopens
// automatically whenever a not-yet-ready course is selected.
export default function SetupBootstrapModal({ courseId, courseName, setup, onSetupChange, onChanged, onClose }) {
  const toast = useToast()
  const [groups, setGroups]           = useState([])
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [creatingGroup, setCreatingGroup] = useState(false)

  useEffect(() => {
    if (!courseId) return
    setLoadingGroups(true)
    getAssignmentGroups(courseId).then(setGroups).finally(() => setLoadingGroups(false))
  }, [courseId])

  async function patch(fields) {
    const updated = await saveCourseSetup(courseId, fields)
    onSetupChange?.(updated)
    onChanged?.()
    return updated
  }

  async function handleCreateGroup() {
    setCreatingGroup(true)
    try {
      const existing = groups.find(g => g.name.trim().toLowerCase() === 'professionalism')
      const group = existing ?? await createAssignmentGroup(courseId, { name: 'Professionalism', position: groups.length + 1 })
      if (!existing) setGroups(prev => [...prev, group])
      await patch({ professionalismGroupId: group.id })
      toast(existing ? 'Linked the existing "Professionalism" group' : 'Created the "Professionalism" assignment group', 'success')
    } catch (err) {
      toast(`Could not create assignment group: ${err.message}`, 'error')
    } finally {
      setCreatingGroup(false)
    }
  }

  const group = groups.find(g => g.id === setup?.professionalismGroupId)
  const ready = !!(setup?.enabled && group)

  return (
    <Modal
      title={`Set up ${courseName ?? 'this course'}`}
      subtitle="These two steps unlock Professionalism, Attendance, and Scoring for this course."
      onClose={onClose}
      size="sm"
      footer={<Button onClick={onClose} disabled={!ready}>{ready ? 'Done' : 'Finish setup to continue'}</Button>}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-body)]">Use Labs &amp; Attendance for {courseName}</h3>
              <p className="text-xs text-[var(--color-text-muted)]">Turns on lab creation and attendance for this course.</p>
            </div>
            <label className="flex items-center gap-2 text-sm shrink-0">
              <input type="checkbox" checked={!!setup?.enabled} onChange={() => patch({ enabled: !setup?.enabled })} />
              Enabled
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--color-text-body)]">Professionalism assignment group</h3>
          {loadingGroups ? (
            <Skeleton height="2.5rem" />
          ) : group ? (
            <p className="text-sm text-[var(--color-text-secondary)] flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-[var(--color-success)]" /> Using &quot;{group.name}&quot;
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--color-text-muted)]">
                Lab professionalism assignments created by this tool go into a dedicated assignment group.
              </p>
              <Button onClick={handleCreateGroup} disabled={creatingGroup}>
                {creatingGroup ? 'Creating…' : 'Create "Professionalism" group'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
