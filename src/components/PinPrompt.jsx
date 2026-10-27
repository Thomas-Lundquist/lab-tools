import { useState, useEffect, useRef } from 'react'
import { ShieldAlert, Lock, AlertTriangle } from 'lucide-react'
import { verifyPin, recordFailedAttempt, clearFailedAttempts, isLockedOut, getLockoutRemaining, resetExtension } from '../security/pin.js'
import { pageUrl } from '../utils/nav.js'

export default function PinPrompt({ onVerified, onCancel, warning }) {
  const [view, setView]             = useState('pin')   // 'pin' | 'lockout' | 'reset'
  const [pin, setPin]               = useState('')
  const [error, setError]           = useState(null)
  const [attemptsLeft, setAttemptsLeft] = useState(4)
  const [lockoutMinutes, setLockoutMinutes] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    checkLockout()
  }, [])

  useEffect(() => {
    if (view === 'pin') inputRef.current?.focus()
  }, [view])

  useEffect(() => {
    if (view !== 'lockout') return
    const interval = setInterval(async () => {
      const remaining = await getLockoutRemaining()
      if (remaining <= 0) {
        setView('pin')
        setPin('')
        setError(null)
        setAttemptsLeft(4)
      } else {
        setLockoutMinutes(remaining)
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [view])

  async function checkLockout() {
    if (await isLockedOut()) {
      const remaining = await getLockoutRemaining()
      setLockoutMinutes(remaining)
      setView('lockout')
    }
  }

  async function handleConfirm() {
    if (pin.length < 4) {
      setError('PIN must be at least 4 digits.')
      return
    }
    const correct = await verifyPin(pin)
    if (correct) {
      await clearFailedAttempts()
      onVerified()
    } else {
      const count = await recordFailedAttempt()
      if (await isLockedOut()) {
        const remaining = await getLockoutRemaining()
        setLockoutMinutes(remaining)
        setView('lockout')
      } else {
        const left = Math.max(0, 4 - count)
        setAttemptsLeft(left)
        setError(left === 1 ? 'Incorrect PIN. One attempt remaining before lockout.' : `Incorrect PIN. ${left} attempts remaining.`)
        setPin('')
      }
    }
  }

  async function handleReset() {
    await resetExtension()
    window.location.href = pageUrl('src/pages/onboarding/index.html')
  }

  if (view === 'lockout') {
    return (
      <Overlay>
        <div className="text-center space-y-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 15%, var(--color-bg-surface))' }}>
            <Lock size={28} className="text-[var(--color-error)]" />
          </div>
          <h2 className="text-xl font-bold text-[var(--color-text-body)]">Extension Locked</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Too many incorrect attempts. Try again in{' '}
            <span className="font-semibold text-[var(--color-text-body)]">{lockoutMinutes} minute{lockoutMinutes !== 1 ? 's' : ''}</span>.
          </p>
          <button onClick={() => setView('reset')} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] underline">
            Forgot your PIN? Reset Extension
          </button>
        </div>
      </Overlay>
    )
  }

  if (view === 'reset') {
    return (
      <Overlay>
        <div className="text-center space-y-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, var(--color-bg-surface))' }}>
            <AlertTriangle size={28} className="text-[var(--color-warning)]" />
          </div>
          <h2 className="text-xl font-bold text-[var(--color-text-body)]">Reset Extension</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This will permanently delete all your data — templates, change logs,
            settings, and your API token. You will need to go through setup again.
          </p>
          <p className="text-sm font-semibold text-[var(--color-error)]">This cannot be undone.</p>
          <div className="flex gap-3 justify-center pt-2">
            <button onClick={() => setView(attemptsLeft > 0 ? 'pin' : 'lockout')} className="btn-ghost">
              Cancel
            </button>
            <button onClick={handleReset} className="btn-danger">
              Reset Extension
            </button>
          </div>
        </div>
      </Overlay>
    )
  }

  return (
    <Overlay>
      <div className="text-center space-y-5">
        <div className="w-14 h-14 rounded-full bg-[rgba(var(--cpt-color-rgb),0.1)] flex items-center justify-center mx-auto">
          <ShieldAlert size={28} style={{ color: 'var(--cpt-color-text)' }} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[var(--color-text-body)]">Enter Your PIN</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">You are about to make changes to Canvas.</p>
          {warning && (
            <p className="text-sm font-semibold text-[var(--color-error)] mt-2">{warning}</p>
          )}
        </div>

        <div className="space-y-2">
          <input
            ref={inputRef}
            type="tel"
            inputMode="numeric"
            value={pin}
            onChange={e => {
              setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
              setError(null)
            }}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm() }}
            placeholder="••••"
            className="w-40 mx-auto block text-center text-2xl tracking-[0.5em] font-mono input"
          />
          {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
        </div>

        <div className="flex gap-3 justify-center">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={pin.length < 4}
            className="btn-primary"
          >
            Confirm
          </button>
        </div>

        <button onClick={() => setView('reset')} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] underline block mx-auto">
          Forgot your PIN? Reset Extension
        </button>
      </div>
    </Overlay>
  )
}

function Overlay({ children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-[var(--color-bg-surface)] rounded-xl shadow-xl w-full max-w-sm p-8">
        {children}
      </div>
    </div>
  )
}
