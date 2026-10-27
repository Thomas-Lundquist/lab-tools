import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { getPreferences } from '../../storage/preferences.js'
import { applyPalette, applyDarkMode, applyTextSize } from '../../utils/color.js'
import '../../styles/global.css'
import { ToastProvider } from '../../components/Toast.jsx'
import { PinGateProvider } from '../../security/usePinGate.jsx'
import SetupGuard from '../../components/SetupGuard.jsx'

const initialCourseId = new URLSearchParams(window.location.search).get('courseId') ?? null

getPreferences().then(p => { applyPalette(p.palette); applyDarkMode(p.themeMode ?? 'system'); applyTextSize(p.textSize ?? 'medium') })
createRoot(document.getElementById('root')).render(
  <SetupGuard><ToastProvider><PinGateProvider><App initialCourseId={initialCourseId} /></PinGateProvider></ToastProvider></SetupGuard>
)
