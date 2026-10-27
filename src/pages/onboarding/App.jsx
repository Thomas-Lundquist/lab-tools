import { useState, useRef } from 'react'
import { CheckCircle, ChevronDown, ChevronUp, Eye, EyeOff, AlertCircle, Loader, ShieldCheck } from 'lucide-react'
import { verifyToken } from '../../api/auth.js'
import { saveAccount, markSetupComplete } from '../../storage/account.js'
import { setupPin } from '../../security/pin.js'
import { pageUrl } from '../../utils/nav.js'

const STEPS = ['welcome', 'url', 'token', 'verifying', 'pin-setup', 'success']

export default function App() {
  const [step, setStep] = useState('welcome')
  const [canvasUrl, setCanvasUrl] = useState('https://')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [urlError, setUrlError] = useState(null)
  const [verifyError, setVerifyError] = useState(null)
  const [verifiedUser, setVerifiedUser] = useState(null)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinError, setPinError] = useState(null)
  const pinConfirmRef = useRef(null)

  async function handleVerify() {
    setVerifyError(null)
    setStep('verifying')
    try {
      const user = await verifyToken(canvasUrl, token)
      await saveAccount({ canvasUrl, token, userName: user.name })
      await markSetupComplete()
      setVerifiedUser(user)
      setStep('pin-setup')
    } catch (err) {
      setVerifyError(err.message)
      setStep('token')
    }
  }

  async function handleSetPin() {
    if (pin.length < 4) { setPinError('PIN must be at least 4 digits.'); return }
    if (pin !== pinConfirm) { setPinError('PINs do not match.'); return }
    await setupPin(pin)
    setStep('success')
  }

  async function pasteToken() {
    try {
      const text = await navigator.clipboard.readText()
      setToken(text.trim())
    } catch {
      // Clipboard access denied — user can paste manually
    }
  }

  function validateUrl() {
    if (!canvasUrl.startsWith('https://')) {
      setUrlError('URL must start with https://')
      return false
    }
    try {
      new URL(canvasUrl)
      setUrlError(null)
      return true
    } catch {
      setUrlError('Please enter a valid URL.')
      return false
    }
  }

  function openLabsTool() {
    window.location.href = pageUrl('src/pages/labs/index.html')
  }

  function openSettings() {
    window.location.href = pageUrl('src/settings/index.html')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--primary-50)] to-[var(--color-bg-page)] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {step === 'welcome' && <WelcomeScreen onStart={() => setStep('url')} />}

        {step === 'url' && (
          <StepCard step={1} title="Where is your Canvas?">
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              Enter your school's Canvas URL. You'll find it in your browser's address bar when logged into Canvas.
            </p>
            <label className="label">Canvas URL</label>
            <input
              type="url"
              value={canvasUrl}
              onChange={e => { setCanvasUrl(e.target.value); setUrlError(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && validateUrl()) setStep('token') }}
              placeholder="https://yourschool.instructure.com"
              className="input"
              autoFocus
            />
            {urlError && <p className="mt-1 text-sm text-[var(--color-error)] flex items-center gap-1"><AlertCircle size={14} />{urlError}</p>}
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Examples: https://yourschool.instructure.com &nbsp;|&nbsp; https://canvas.yourschool.edu
            </p>
            <div className="mt-6 flex justify-end">
              <button
                className="btn-primary"
                onClick={() => { if (validateUrl()) setStep('token') }}
              >
                Continue
              </button>
            </div>
          </StepCard>
        )}

        {step === 'token' && (
          <StepCard step={2} title="Connect your Canvas account">
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              Culinary Canvas Tools needs an API token to read and update grades.
              This token is stored only on your device and is never shared with anyone.
            </p>

            <button
              onClick={() => setShowInstructions(!showInstructions)}
              className="flex items-center gap-2 text-sm text-[var(--cpt-color-text)] hover:underline mb-4 font-medium"
            >
              {showInstructions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              How to generate your token
            </button>

            {showInstructions && (
              <div className="bg-[var(--primary-50)] border border-[var(--primary-200)] rounded-lg p-4 mb-4 text-sm text-[var(--color-text-secondary)] space-y-1">
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Open Canvas and go to <strong>Account &gt; Settings</strong></li>
                  <li>Scroll down to <strong>Approved Integrations</strong></li>
                  <li>Click <strong>New Access Token</strong></li>
                  <li>Enter <strong>Culinary Canvas Tools</strong> as the purpose</li>
                  <li>Set expiry to the end of your school year (recommended)</li>
                  <li>Click <strong>Generate Token</strong></li>
                  <li>Copy the token — it is only shown once</li>
                </ol>
                <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                  Tip: Setting an expiry date limits risk if your token is ever compromised. You can regenerate it each school year in under a minute.
                </p>
              </div>
            )}

            {verifyError && (
              <div className="bg-[color-mix(in_srgb,var(--color-error)_12%,var(--color-bg-surface))] border border-[color-mix(in_srgb,var(--color-error)_32%,var(--color-bg-surface))] rounded-lg p-3 mb-4 text-sm text-[var(--color-error)] flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Could not verify your token</p>
                  <p className="mt-1 text-[var(--color-error)]">{verifyError}</p>
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">Common causes: token not copied completely, token expired, or incorrect Canvas URL.</p>
                </div>
              </div>
            )}

            <label className="label">Paste your token here</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && token.trim()) handleVerify() }}
                  placeholder="Paste your API token"
                  className="input pr-10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                >
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button className="btn-secondary" onClick={pasteToken}>Paste</button>
            </div>

            <div className="mt-6 flex justify-between items-center">
              <button className="btn-ghost" onClick={() => setStep('url')}>Back</button>
              <button
                className="btn-primary"
                disabled={!token.trim()}
                onClick={handleVerify}
              >
                Verify Token
              </button>
            </div>
          </StepCard>
        )}

        {step === 'verifying' && (
          <div className="card p-12 text-center">
            <Loader size={40} className="animate-spin text-[var(--cpt-color-text)] mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-[var(--color-text-body)]">Verifying your token...</h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-2">Connecting to Canvas</p>
          </div>
        )}

        {step === 'pin-setup' && (
          <StepCard step={3} title="Protect your account">
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
                If you forget your PIN, you will need to reset the extension. Your PIN cannot be recovered.
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
                  <span className="text-[var(--color-text-muted)]">Canvas URL</span>
                  <span className="font-medium text-[var(--color-text-body)] text-xs">{canvasUrl}</span>
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

function WelcomeScreen({ onStart }) {
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
        <p className="font-medium text-[var(--cpt-color-text)]">Your data never leaves your browser.</p>
      </div>
      <div>
        <button className="btn-primary text-base px-8 py-3" onClick={onStart}>Get Started</button>
        <p className="text-xs text-[var(--color-text-muted)] mt-3">Takes about 2 minutes</p>
      </div>
    </div>
  )
}

function StepCard({ step, title, children }) {
  return (
    <div className="card p-8">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-[var(--cpt-color-text)] uppercase tracking-wider">Step {step} of 3</span>
      </div>
      <h2 className="text-xl font-bold text-[var(--color-text-body)] mb-6">{title}</h2>
      {children}
    </div>
  )
}
