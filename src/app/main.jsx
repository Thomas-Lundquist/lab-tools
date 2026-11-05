import React from 'react'
import { createRoot } from 'react-dom/client'
import { getPreferences } from '../storage/preferences.js'
import { migrateLegacyLabGrading } from '../storage/labGrading.js'
import { startSync } from '../storage/sync.js'
import { applyPalette, applyDarkMode, applyTextSize } from '../utils/color.js'
import '../styles/global.css'
import { ToastProvider } from '../components/Toast.jsx'
import { PinGateProvider } from '../security/usePinGate.jsx'
import SetupGuard from '../components/SetupGuard.jsx'
import { useRoute } from '../utils/nav.js'
import Home from '../shell/index.jsx'
import { TOOLS } from '../config/tools.jsx'
import LabsPage from '../pages/labs/index.jsx'
import RotationPage from '../pages/rotation/index.jsx'
import Settings from '../settings/index.jsx'
import Onboarding from '../pages/onboarding/App.jsx'
import DebugReport from '../debug/DebugReport.jsx'
// Installs the debug-mode write interceptor before any request can run.
import { clearLeftoverSandbox } from '../debug/debugMode.js'
import { installDiagnostics } from '../debug/diagnostics.js'

// The whole app's single entry. In production launch.js loads this module into
// a document on the Canvas origin; in dev, app.html loads it on localhost.
// Each tool used to be its own HTML page — see utils/nav.js for why it's one
// page with in-app routes now.

const PAGES = { home: Home, labs: LabsPage, rotation: RotationPage, settings: Settings, debug: DebugReport }
// With a single tool, "home" is that tool: a launcher page with one tile only
// cost a tap on every launch. Home comes back on its own if a second tool is added.
if (TOOLS.length === 1) PAGES.home = LabsPage

function Routes() {
  const { route } = useRoute()
  if (route === 'onboarding') return <Onboarding />
  const Page = PAGES[route] ?? Home
  return <SetupGuard key={route}><Page /></SetupGuard>
}

function Root() {
  const { epoch } = useRoute()
  return (
    <ToastProvider key={epoch}>
      <PinGateProvider>
        <Routes />
      </PinGateProvider>
    </ToastProvider>
  )
}

// Pull synced data from Canvas before the first render, so pages read this
// device's copy already merged with edits made elsewhere. If Canvas is slow,
// startSync gives up waiting after a few seconds and the app renders from
// local data; anything arriving later shows a refresh prompt.
async function boot() {
  installDiagnostics()
  clearLeftoverSandbox() // debug mode never survives a relaunch
  const root = createRoot(document.getElementById('root'))
  root.render(
    <p className="h-[100dvh] flex items-center justify-center text-sm text-[var(--color-text-muted)] bg-[var(--color-bg-page)]">
      Syncing with Canvas…
    </p>,
  )
  await migrateLegacyLabGrading()
  await startSync({ timeoutMs: 5000 })
  const p = await getPreferences()
  applyPalette(p.palette)
  applyDarkMode(p.themeMode ?? 'system')
  applyTextSize(p.textSize ?? 'medium')
  root.render(<Root />)
}

boot()
