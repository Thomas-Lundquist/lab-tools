import { useState, useRef } from 'react'
import { CheckCircle, AlertCircle, Loader, ShieldCheck } from 'lucide-react'
import { getCurrentUser } from '../../api/auth.js'
import { canvasOrigin } from '../../api/canvasContext.js'
import { markSetupComplete } from '../../storage/account.js'
import { setupPin } from '../../security/pin.js'
import { navigate } from '../../utils/nav.js'

// No URL or token steps: the app runs inside Canvas on the teacher's own
// session, so "connecting" is just confirming that session works.
const STEPS = ['welcome', 'checking', 'pin-setup', 'success']

export default function App() {
  const [step, setStep] = useState('welcome')
  const [checkError, setCheckError] = useState(null)
  const [verifiedUser, setVerifiedUser] = useState(null)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinError, setPinError] = useState(null)
  const pinConfirmRef = useRef(null)

  async function handleCheck() {
    setCheckError(null)
    setStep('checking')
    try {
      const user = await getCurrentUser()
      await markSetupComplete()
      setVerifiedUser(user)
      setStep('pin-setup')
    } catch (err) {
      setCheckError(err.message)
      setStep('welcome')
    }
  }

  async function handleSetPin() {
    if (pin.length < 4) { setPinError('PIN must be at least 4 digits.'); return }
    if (pin !== pinConfirm) { setPinError('PINs do not match.'); return }
    await setupPin(pin)
    setStep('success')
  }

  function openLabsTool() {
    navigate('labs')
  }

  function openSettings() {
    navigate('settings')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--primary-50)] to-[var(--color-bg-page)] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {step === 'welcome' && <WelcomeScreen onStart={handleCheck} error={checkError} />}

        {step === 'checking' && (
          <div className="card p-12 text-center">
            <Loader size={40} className="animate-spin text-[var(--cpt-color-text)] mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-[var(--color-text-body)]">Checking your Canvas login...</h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-2">Connecting to Canvas</p>
          </div>
        )}

        {step === 'pin-setup' && (
          <StepCard step={2} title="Protect your account">
            <div className="flex items-start gap-3 bg-[var(--primary-50)] border border-[var(--primary-200)] rounded-lg p-4 mb-5">
              <ShieldCheck size={18} className="text-[var(--cpt-color-text)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--cpt-color-text)]">
                A PIN prevents anyone else on this computer from making changes to your Canvas courses through Culinary Canvas Tools. Recommended for shared or classroom computers.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">Create a PIN (4–6 digits)</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={pin}
                  onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setPinError(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') pinConfirmRef.current?.focus() }}
                  placeholder="••••"
                  className="input w-full text-center text-xl tracking-[0.4em] font-mono"
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Confirm PIN</label>
                <input
                  ref={pinConfirmRef}
                  type="tel"
                  inputMode="numeric"
                  value={pinConfirm}
                  onChange={e => { setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6)); setPinError(null) }}
                  placeholder="••••"
                  className="input w-full text-center text-xl tracking-[0.4em] font-mono"
                  onKeyDown={e => { if (e.key === 'Enter') handleSetPin() }}
                />
              </div>
              {pinError && <p className="text-sm text-[var(--color-error)] flex items-center gap-1"><AlertCircle size={14} />{pinError}</p>}
              <p className="text-xs text-[var(--color-text-muted)]">
                If you forget your PIN, you will need to reset Lab Tools. Your PIN cannot be recovered.
              </p>
            </div>

            <div className="mt-6 flex justify-end">
              <button className="btn-primary" disabled={pin.length < 4 || pinConfirm.length < 4} onClick={handleSetPin}>
                Set PIN
              </button>
            </div>
          </StepCard>
        )}

        {step === 'success' && (
          <div className="card p-10 text-center space-y-6">
            <div>
              <CheckCircle size={52} className="text-[var(--color-success)] mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-[var(--color-text-body)]">
                You are all set{verifiedUser?.shortName ? `, ${verifiedUser.shortName.split(' ')[0]}` : ''}.
              </h2>
              <p className="text-[var(--color-text-muted)] mt-2">Culinary Canvas Tools is ready to use.</p>
            </div>

            {verifiedUser && (
              <div className="bg-[var(--color-bg-hover)] rounded-lg p-4 text-sm text-left space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Logged in as</span>
                  <span className="font-medium text-[var(--color-text-body)]">{verifiedUser.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Canvas</span>
                  <span className="font-medium text-[var(--color-text-body)] text-xs">{new URL(canvasOrigin()).host}</span>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <button className="btn-primary w-full justify-center" onClick={openLabsTool}>
                Open Labs &amp; Attendance
              </button>
              <button className="btn-secondary w-full justify-center" onClick={openSettings}>
                Go to Settings
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function WelcomeScreen({ onStart, error }) {
  return (
    <div className="card p-12 text-center space-y-8">
      <div>
        <div className="w-16 h-16 bg-[var(--cpt-color)] rounded-2xl mx-auto mb-6 flex items-center justify-center">
          <span className="text-white text-2xl font-black">C</span>
        </div>
        <h1 className="text-3xl font-bold text-[var(--color-text-body)]">Culinary Canvas Tools</h1>
        <p className="text-[var(--color-text-muted)] mt-3 text-lg">A personal Canvas toolkit for your culinary classes.</p>
      </div>
      <div className="space-y-3 text-sm text-[var(--color-text-secondary)] text-left bg-[var(--color-bg-hover)] rounded-lg p-5">
        <p>Score professionalism labs by unit straight from your live gradebook, and push the results back to Canvas in one click.</p>
        <p className="font-medium text-[var(--cpt-color-text)]">Runs inside Canvas with your Canvas login — student data goes only between your browser and Canvas.</p>
      </div>
      {error && (
        <div className="bg-[color-mix(in_srgb,var(--color-error)_12%,var(--color-bg-surface))] border border-[color-mix(in_srgb,var(--color-error)_32%,var(--color-bg-surface))] rounded-lg p-3 text-sm text-[var(--color-error)] flex items-start gap-2 text-left">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Could not reach Canvas with your login</p>
            <p className="mt-1">{error}</p>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">Make sure you're logged in to Canvas in this browser, then relaunch Lab Tools from Canvas.</p>
          </div>
        </div>
      )}
      <div className="space-y-3">
        <button className="btn-primary text-base px-8 py-3" onClick={onStart}>{error ? 'Try Again' : 'Get Started'}</button>
        <p className="text-xs text-[var(--color-text-muted)]">Takes about a minute</p>
      </div>
    </div>
  )
}

function StepCard({ step, title, children }) {
  return (
    <div className="card p-8">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-[var(--cpt-color-text)] uppercase tracking-wider">Step {step} of 2</span>
      </div>
      <h2 className="text-xl font-bold text-[var(--color-text-body)] mb-6">{title}</h2>
      {children}
    </div>
  )
}
