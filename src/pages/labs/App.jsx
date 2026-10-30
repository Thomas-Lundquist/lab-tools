import React, { useState, useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import AppNav, { SettingsButton, BrandLogo } from '../../components/AppNav.jsx'
import ToolShell from '../../components/ToolShell.jsx'
import SkipLink from '../../components/SkipLink.jsx'
import CourseSelector from '../../components/CourseSelector.jsx'
import { Tabs, TabPanel } from '../../components/Tabs.jsx'
import { useKeyboardShortcuts } from '../../utils/useKeyboardShortcuts.js'
import ShortcutsPanel from '../../components/ShortcutsPanel.jsx'
import { getCourses } from '../../api/courses.js'
import { getPreferences, setLastUsedCourse, resolveInitialCourseId, visibleCourses } from '../../storage/preferences.js'
import { getCourseSetup } from '../../storage/setup.js'
import { KEY_PREFIX } from '../../storage/kv.js'
import SetupBootstrapModal from './SetupBootstrapModal.jsx'
import CourseSettingsModal from './CourseSettingsModal.jsx'
import ProfessionalismPanel from './ProfessionalismPanel.jsx'
import KitchenScorePanel from './KitchenScorePanel.jsx'
import ScoringPanel from './ScoringPanel.jsx'

// Left-to-right order matches the dependency order: a Professionalism
// assignment (Pairing or Standalone) must exist before attendance can be
// taken for it, and attendance has to have written some grades before
// there's anything to roll up in Scoring. Course-level
// setup (Enable + Professionalism group, plus everything else) isn't a tab
// at all — see SetupBootstrapModal / CourseSettingsModal below.
// Attendance and Score used to be two tabs that each re-selected the lab and
// section. They collapsed into one period-centric "Lab" screen (present/absent +
// kitchen grading in one pass), so the teacher picks a lab once and flows
// create -> grade across periods without reselecting. See DECISIONS.md.
const TABS = [
  { id: 'labs', label: 'Professionalism' },
  { id: 'lab', label: 'Lab' },
  { id: 'scoring', label: 'Rollup' },
]

// The working lab + period, remembered per course so a refresh or the iPad keeps
// the teacher in place. Selection is sticky; grading drafts live in labGrading.
const CTX_KEY = 'labWorkingContext'
function loadCtx(courseId) {
  try { return (JSON.parse(localStorage.getItem(KEY_PREFIX + CTX_KEY) || '{}')[courseId]) ?? {} }
  catch { return {} }
}
function saveCtx(courseId, ctx) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_PREFIX + CTX_KEY) || '{}')
    all[courseId] = ctx
    localStorage.setItem(KEY_PREFIX + CTX_KEY, JSON.stringify(all))
  } catch { /* localStorage unavailable — selection just won't persist */ }
}

export default function App({ initialCourseId }) {
  const { showPanel, setShowPanel } = useKeyboardShortcuts([])

  const [courses, setCourses]               = useState([])
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [courseId, setCourseId]             = useState(null)
  const [tab, setTab]                       = useState(TABS[0].id)
  const [courseSetup, setCourseSetup]       = useState(null)
  const [setupVersion, setSetupVersion]     = useState(0)
  const [showBootstrap, setShowBootstrap]   = useState(false)
  const [showCourseSettings, setShowCourseSettings] = useState(false)
  const routedCourseId = useRef(null)

  // Working context: the lab + period being graded, lifted here so the Lab tab
  // keeps it across tab switches and page loads.
  const [labId, setLabId]         = useState(null)
  const [sectionId, setSectionId] = useState('')

  // Restore the remembered lab/period when the course changes…
  useEffect(() => {
    if (!courseId) { setLabId(null); setSectionId(''); return }
    const ctx = loadCtx(courseId)
    setLabId(ctx.labId ?? null)
    setSectionId(ctx.sectionId ?? '')
  }, [courseId])

  // …and persist it whenever it changes.
  useEffect(() => {
    if (courseId) saveCtx(courseId, { labId, sectionId })
  }, [courseId, labId, sectionId])

  function selectLabPeriod(nextLabId, nextSectionId) {
    setLabId(nextLabId || null)
    setSectionId(nextSectionId || '')
  }

  // Creating a lab drops the teacher straight into grading it.
  function handleLabCreated(newLabId) {
    setLabId(newLabId)
    setSectionId('')
    setTab('lab')
  }

  useEffect(() => {
    Promise.all([getCourses(), getPreferences()])
      .then(([list, prefs]) => {
        const visible = visibleCourses(list, prefs)
        setCourses(visible)
        setCourseId(resolveInitialCourseId(visible, { override: initialCourseId, prefs }))
      })
      .finally(() => setLoadingCourses(false))
  }, [])

  // courseSetup is fetched here, independent of which tab/modal happens to be
  // open — it used to only arrive via a callback from the Setup tab's panel,
  // which (being conditionally mounted) left `ready` stuck false on every
  // fresh page load until that tab was visited once. See DECISIONS.md.
  useEffect(() => {
    if (!courseId) { setCourseSetup(null); return }
    getCourseSetup(courseId).then(setCourseSetup)
  }, [courseId, setupVersion])

  // Auto-open the bootstrap modal for a course that isn't ready yet, instead
  // of defaulting to Attendance and immediately hitting its "finish setup
  // first" empty state. Only does this once per course switch — it won't
  // reopen the modal repeatedly while the teacher is still on the page.
  useEffect(() => {
    if (!courseId || !courseSetup || routedCourseId.current === courseId) return
    routedCourseId.current = courseId
    if (!(courseSetup.enabled && courseSetup.professionalismGroupId)) setShowBootstrap(true)
  }, [courseId, courseSetup])

  function handleCourseChange(id) {
    setCourseId(id)
    setLastUsedCourse(id)
  }

  // Bumped whenever setup changes (new group/section/term/entry) so panels
  // depending on it (Professionalism, Attendance, Scoring, this course's own
  // courseSetup fetch above) refetch.
  function refreshSetup() {
    setSetupVersion(v => v + 1)
  }

  const course = courses.find(c => c.id === courseId) ?? null
  const ready = courseSetup?.enabled && courseSetup?.professionalismGroupId

  return (
    <>
      <SkipLink />
      <ToolShell
        start={<><BrandLogo /><CourseSelector courses={courses} selectedId={courseId} onChange={handleCourseChange} loading={loadingCourses} /></>}
        end={<><AppNav current="labs" /><SettingsButton /></>}
      >
        <div className="overflow-y-auto flex-1">
          <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text-body)]">Labs, Attendance &amp; Professionalism</h1>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                Create Professionalism assignments (paired with a lab journal, or standalone), take attendance, score students, and roll scores up by Unit and Term.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <Tabs tabs={TABS} activeTab={tab} onChange={setTab} />
              <button
                onClick={() => setShowCourseSettings(true)}
                disabled={!courseId}
                className="p-2 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] hover:bg-[var(--color-bg-hover)] transition-colors duration-75 disabled:opacity-40 disabled:pointer-events-none"
                title="Course settings"
                aria-label="Course settings"
              >
                <Settings size={16} />
              </button>
            </div>

            <TabPanel tabId="labs" activeTab={tab}>
              <ProfessionalismPanel
                courseId={courseId}
                courseName={course?.name}
                loadingCourse={loadingCourses}
                ready={ready}
                setupVersion={setupVersion}
                onChanged={refreshSetup}
                onLabCreated={handleLabCreated}
                onGoToSetup={() => setShowBootstrap(true)}
              />
            </TabPanel>
            <TabPanel tabId="lab" activeTab={tab}>
              <KitchenScorePanel
                courseId={courseId}
                courseName={course?.name}
                loadingCourse={loadingCourses}
                ready={ready}
                setupVersion={setupVersion}
                labId={labId}
                sectionId={sectionId}
                onSelect={selectLabPeriod}
                onChanged={refreshSetup}
                onGoToSetup={() => setShowBootstrap(true)}
                onGoToLabs={() => setTab('labs')}
              />
            </TabPanel>
            <TabPanel tabId="scoring" activeTab={tab}>
              <ScoringPanel
                courseId={courseId}
                courseName={course?.name}
                loadingCourse={loadingCourses}
              />
            </TabPanel>
          </div>
        </div>
      </ToolShell>
      {showPanel && <ShortcutsPanel onClose={() => setShowPanel(false)} />}
      {showBootstrap && (
        <SetupBootstrapModal
          courseId={courseId}
          courseName={course?.name}
          setup={courseSetup}
          onSetupChange={setCourseSetup}
          onChanged={refreshSetup}
          onClose={() => setShowBootstrap(false)}
        />
      )}
      {showCourseSettings && (
        <CourseSettingsModal
          courseId={courseId}
          courseName={course?.name}
          setup={courseSetup}
          onSetupChange={setCourseSetup}
          onChanged={refreshSetup}
          onClose={() => setShowCourseSettings(false)}
        />
      )}
    </>
  )
}
