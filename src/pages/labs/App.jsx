import React, { useState, useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import AppNav, { SettingsButton, BrandLogo } from '../../components/AppNav.jsx'
import ToolShell from '../../components/ToolShell.jsx'
import SkipLink from '../../components/SkipLink.jsx'
import CourseSelector from '../../components/CourseSelector.jsx'
import { Tabs } from '../../components/Tabs.jsx'
import Button from '../../components/Button.jsx'
import { useKeyboardShortcuts } from '../../utils/useKeyboardShortcuts.js'
import ShortcutsPanel from '../../components/ShortcutsPanel.jsx'
import { getCourses } from '../../api/courses.js'
import { getPreferences, setLastUsedCourse, resolveInitialCourseId, visibleCourses } from '../../storage/preferences.js'
import { getCourseSetup } from '../../storage/setup.js'
import { keyPrefix } from '../../storage/kv.js'
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
// Grade comes first: it's the daily screen, so the app opens on it.
const TABS = [
  { id: 'lab', label: 'Grade' },
  { id: 'labs', label: 'Assignments' },
  { id: 'scoring', label: 'Unit & Term Scores' },
]

// The working lab + period, remembered per course so a refresh or the iPad keeps
// the teacher in place. Selection is sticky; grading drafts live in labGrading.
const CTX_KEY = 'labWorkingContext'

// A tab panel that stays mounted once opened, hidden while another tab shows.
// Switching tabs used to unmount the panel, so every switch reloaded the roster
// or every submission in the course. Never-opened tabs still don't load.
function KeepAlivePanel({ tabId, activeTab, visited, children }) {
  if (!visited.has(tabId) && tabId !== activeTab) return null
  return (
    <div role="tabpanel" id={`tabpanel-${tabId}`} aria-labelledby={`tab-${tabId}`} hidden={tabId !== activeTab}>
      {children}
    </div>
  )
}
function loadCtx(courseId) {
  try { return (JSON.parse(localStorage.getItem(keyPrefix() + CTX_KEY) || '{}')[courseId]) ?? {} }
  catch { return {} }
}
function saveCtx(courseId, ctx) {
  try {
    const all = JSON.parse(localStorage.getItem(keyPrefix() + CTX_KEY) || '{}')
    all[courseId] = ctx
    localStorage.setItem(keyPrefix() + CTX_KEY, JSON.stringify(all))
  } catch { /* localStorage unavailable — selection just won't persist */ }
}

export default function App({ initialCourseId }) {
  const { showPanel, setShowPanel } = useKeyboardShortcuts([])

  const [courses, setCourses]               = useState([])
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [courseId, setCourseId]             = useState(null)
  const [tab, setTab]                       = useState(TABS[0].id)
  // Tabs opened so far this launch; they stay mounted (KeepAlivePanel).
  const [visited, setVisited]               = useState(() => new Set([TABS[0].id]))
  useEffect(() => { setVisited(v => (v.has(tab) ? v : new Set([...v, tab]))) }, [tab])
  const [courseSetup, setCourseSetup]       = useState(null)
  const [setupVersion, setSetupVersion]     = useState(0)
  const setupVersionRef                     = useRef(0)
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

  // A deleted lab can't stay the working lab.
  function handleLabRemoved(removedId) {
    if (labId === removedId) { setLabId(null); setSectionId('') }
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
  // courseSetup fetch above) refetch. Returns the new version synchronously so
  // a caller that already applied the change locally (see ProfessionalismPanel's
  // handleRowChanged) can mark itself caught-up instead of refetching its own
  // edit back from Canvas.
  function refreshSetup() {
    setupVersionRef.current += 1
    setSetupVersion(setupVersionRef.current)
    return setupVersionRef.current
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tabs tabs={TABS} activeTab={tab} onChange={setTab} />
              <Button variant="ghost" size="sm" icon={Settings} onClick={() => setShowCourseSettings(true)} disabled={!courseId}>
                Course settings
              </Button>
            </div>

            <KeepAlivePanel tabId="labs" activeTab={tab} visited={visited}>
              <ProfessionalismPanel
                courseId={courseId}
                courseName={course?.name}
                loadingCourse={loadingCourses}
                ready={ready}
                active={tab === 'labs'}
                setupVersion={setupVersion}
                onChanged={refreshSetup}
                onLabCreated={handleLabCreated}
                onLabRemoved={handleLabRemoved}
                onGoToSetup={() => setShowBootstrap(true)}
              />
            </KeepAlivePanel>
            <KeepAlivePanel tabId="lab" activeTab={tab} visited={visited}>
              <KitchenScorePanel
                courseId={courseId}
                courseName={course?.name}
                loadingCourse={loadingCourses}
                ready={ready}
                active={tab === 'lab'}
                setupVersion={setupVersion}
                labId={labId}
                sectionId={sectionId}
                onSelect={selectLabPeriod}
                onChanged={refreshSetup}
                onGoToSetup={() => setShowBootstrap(true)}
                onGoToLabs={() => setTab('labs')}
              />
            </KeepAlivePanel>
            <KeepAlivePanel tabId="scoring" activeTab={tab} visited={visited}>
              <ScoringPanel
                courseId={courseId}
                courseName={course?.name}
                loadingCourse={loadingCourses}
                active={tab === 'scoring'}
                dataVersion={setupVersion}
              />
            </KeepAlivePanel>
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
