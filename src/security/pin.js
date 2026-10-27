import { kvGet, kvSet, kvClear } from '../storage/kv.js'

export class PinRequiredError extends Error {}

const STORAGE_KEY = 'security'

const DEFAULTS = {
  pinHash: null,
  pinEnabled: true,
  inactivityTimeoutMinutes: 30,
  lastActiveTimestamp: null,
  failedAttemptCount: 0,
  lockoutCount: 0,
  lockoutUntil: null,
}

const LOCKOUT_DURATIONS_MINUTES = [15, 30, 60]

export async function getSecuritySettings() {
  const stored = await kvGet(STORAGE_KEY)
  return { ...DEFAULTS, ...(stored ?? {}) }
}

export async function saveSecuritySettings(patch) {
  const current = await getSecuritySettings()
  const updated = { ...current, ...patch }
  await kvSet(STORAGE_KEY, updated)
  return updated
}

function bytesToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

export async function hashPin(pin) {
  const encoded = new TextEncoder().encode(pin)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  return bytesToBase64(hashBuffer)
}

export async function verifyPin(pin) {
  const { pinHash } = await getSecuritySettings()
  if (!pinHash) return false
  return (await hashPin(pin)) === pinHash
}

export async function setupPin(pin) {
  const pinHash = await hashPin(pin)
  await saveSecuritySettings({
    pinHash,
    pinEnabled: true,
    lastActiveTimestamp: new Date().toISOString(),
    failedAttemptCount: 0,
    lockoutCount: 0,
    lockoutUntil: null,
  })
}

export async function clearPin() {
  await saveSecuritySettings({ pinHash: null, pinEnabled: false })
}

export async function isSessionLocked() {
  const { pinEnabled, pinHash, lastActiveTimestamp, inactivityTimeoutMinutes } = await getSecuritySettings()
  if (!pinEnabled || !pinHash) return false
  if (!lastActiveTimestamp) return true
  const elapsed = Date.now() - new Date(lastActiveTimestamp).getTime()
  return elapsed > inactivityTimeoutMinutes * 60 * 1000
}

export async function refreshActivity() {
  await saveSecuritySettings({ lastActiveTimestamp: new Date().toISOString() })
}

export async function isLockedOut() {
  const { lockoutUntil } = await getSecuritySettings()
  if (!lockoutUntil) return false
  return new Date(lockoutUntil) > new Date()
}

export async function getLockoutRemaining() {
  const { lockoutUntil } = await getSecuritySettings()
  if (!lockoutUntil) return 0
  return Math.max(0, Math.ceil((new Date(lockoutUntil) - Date.now()) / 60000))
}

export async function recordFailedAttempt() {
  const current = await getSecuritySettings()
  const count = (current.failedAttemptCount ?? 0) + 1
  const patch = { failedAttemptCount: count }

  if (count >= 4) {
    const lockoutCount = (current.lockoutCount ?? 0) + 1
    const durationIndex = Math.min(lockoutCount - 1, LOCKOUT_DURATIONS_MINUTES.length - 1)
    patch.lockoutUntil = new Date(Date.now() + LOCKOUT_DURATIONS_MINUTES[durationIndex] * 60 * 1000).toISOString()
    patch.lockoutCount = lockoutCount
    patch.failedAttemptCount = 0
  }

  await saveSecuritySettings(patch)
  return count
}

export async function clearFailedAttempts() {
  await saveSecuritySettings({ failedAttemptCount: 0, lockoutUntil: null, lockoutCount: 0 })
}

export async function resetExtension() {
  await kvClear()
}
