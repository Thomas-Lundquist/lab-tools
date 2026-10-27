import React, { createContext, useContext, useState } from 'react'
import PinPrompt from '../components/PinPrompt.jsx'
import { isSessionLocked, refreshActivity, getSecuritySettings, PinRequiredError } from './pin.js'
import { logAuditEntry } from './audit-log.js'

const PinGateContext = createContext(null)

export function PinGateProvider({ children }) {
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState(null)

  // `forcePrompt` (used by irreversible, high-stakes operations) always
  // shows the PIN prompt, ignoring the normal "recently verified" shortcut.
  // If no PIN is configured at all there is nothing to force, so the
  // operation is blocked outright rather than silently allowed through.
  async function requirePin(auditMeta, action, { forcePrompt = false } = {}) {
    const settings = await getSecuritySettings()

    if (!settings.pinEnabled || !settings.pinHash) {
      if (forcePrompt) {
        throw new PinRequiredError('Set up a PIN in Settings to use this feature.')
      }
      await action()
      await logAuditEntry({ ...auditMeta, pinVerified: 'disabled' })
      await refreshActivity()
      return
    }

    if (!forcePrompt && !(await isSessionLocked())) {
      await action()
      await logAuditEntry({ ...auditMeta, pinVerified: true })
      await refreshActivity()
      return
    }

    setPending({ auditMeta, action })
    setVisible(true)
  }

  async function handleVerified() {
    setVisible(false)
    if (pending) {
      await pending.action()
      await logAuditEntry({ ...pending.auditMeta, pinVerified: true })
      await refreshActivity()
      setPending(null)
    }
  }

  function handleCancel() {
    setVisible(false)
    setPending(null)
  }

  return (
    <PinGateContext.Provider value={{ requirePin }}>
      {children}
      {visible && (
        <PinPrompt
          warning={pending?.auditMeta?.warning}
          onVerified={handleVerified}
          onCancel={handleCancel}
        />
      )}
    </PinGateContext.Provider>
  )
}

export function usePinGate() {
  const ctx = useContext(PinGateContext)
  if (!ctx) throw new Error('usePinGate must be used within PinGateProvider')
  return ctx
}
