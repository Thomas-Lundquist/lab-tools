import React from 'react'
import { createRoot } from 'react-dom/client'
import { getPreferences } from '../storage/preferences.js'
import { applyPalette, applyDarkMode, applyTextSize } from '../utils/color.js'
import '../styles/global.css'
import { ToastProvider } from '../components/Toast.jsx'
import { PinGateProvider } from '../security/usePinGate.jsx'
import SetupGuard from '../components/SetupGuard.jsx'
import { useRoute } from '../utils/nav.js'
import Home from '../shell/index.jsx'
import LabsPage from '../pages/labs/index.jsx'
import Settings from '../settings/index.jsx'
import Onboarding from '../pages/onboarding/App.jsx'

// The whole app's single entry. In production launch.js loads this module into
// a document on the Canvas origin; in dev, app.html loads it on localhost.
// Each tool used to be its own HTML page — see utils/nav.js for why it's one
// page with in-app routes now.

const PAGES = { home: Home, labs: LabsPage, settings: Settings }

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

getPreferences().then(p => { applyPalette(p.palette); applyDarkMode(p.themeMode ?? 'system'); applyTextSize(p.textSize ?? 'medium') })
createRoot(document.getElementById('root')).render(<Root />)
