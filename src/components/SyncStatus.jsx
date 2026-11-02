import { useState, useSyncExternalStore } from 'react'
import { CloudOff, RefreshCw, X, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import Card from './Card.jsx'
import Button from './Button.jsx'
import { getSyncStatus, subscribeSyncStatus, syncNow, dismissRemoteChange } from '../storage/sync.js'
import { getPreferences } from '../storage/preferences.js'
import { applyPalette, applyDarkMode, applyTextSize } from '../utils/color.js'
import { navigate, useRoute } from '../utils/nav.js'

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus)
}

const formatTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

// Header icon, shown only when sync is failing. Edits are still saved on this
// device; tapping it opens Settings, which explains and offers a retry.
export function SyncIndicator() {
  const { phase, error } = useSyncStatus()
  if (phase !== 'error') return null
  return (
    <button
      onClick={() => navigate('settings')}
      className="p-2 rounded-[var(--radius-control)] text-[var(--color-warning)] hover:bg-[var(--color-bg-hover)] transition-colors duration-75"
      title={`Not synced: ${error}. Changes are saved on this device.`}
      aria-label="Not synced with Canvas. Open settings."
    >
      <CloudOff size={16} />
    </button>
  )
}

// Edits from another device arrived after this page loaded. Offer a refresh
// instead of remounting under the teacher mid-task.
export function SyncBanner() {
  const { remoteChanged } = useSyncStatus()
  const { route, params } = useRoute()
  if (!remoteChanged) return null

  async function refresh() {
    const p = await getPreferences()
    applyPalette(p.palette)
    applyDarkMode(p.themeMode ?? 'system')
    applyTextSize(p.textSize ?? 'medium')
    dismissRemoteChange()
    navigate(route, params, { replace: true, remount: true })
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 px-4 sm:px-6 py-2 text-sm border-t"
      style={{
        // Same tint recipe as Callout's info tone.
        background: 'color-mix(in srgb, var(--color-info) 12%, var(--color-bg-surface))',
        borderColor: 'color-mix(in srgb, var(--color-info) 35%, var(--color-bg-surface))',
      }}
    >
      <RefreshCw size={14} className="text-[var(--color-info)] shrink-0" />
      <span className="flex-1 text-[var(--color-text-body)]">Updated from another device.</span>
      <Button size="sm" variant="secondary" onClick={refresh}>Refresh</Button>
      <button
        onClick={dismissRemoteChange}
        className="p-1 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function SyncSection() {
  const { phase, error, lastSyncedAt } = useSyncStatus()
  const [busy, setBusy] = useState(false)

  async function retry() {
    setBusy(true)
    try { await syncNow() } catch { /* shown via status */ } finally { setBusy(false) }
  }

  let line
  if (phase === 'error') {
    line = <span className="flex items-center gap-1 text-[var(--color-error)]"><AlertCircle size={14} />Couldn't sync: {error}</span>
  } else if (phase === 'syncing' || phase === 'pending' || phase === 'idle') {
    line = <span className="flex items-center gap-1 text-[var(--color-text-secondary)]"><Loader size={14} className="animate-spin" />Syncing…</span>
  } else {
    line = <span className="flex items-center gap-1 text-[var(--color-success)]"><CheckCircle size={14} />Synced{lastSyncedAt ? ` at ${formatTime(lastSyncedAt)}` : ''}</span>
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-base font-semibold text-[var(--color-text-body)]">Sync Across Devices</h2>
      <p className="text-xs text-[var(--color-text-muted)]">
        Preferences, course setup, lab flags, and grading drafts are saved in your own Canvas account, so they follow you between devices. Your PIN and activity log stay on each device. If Canvas can't be reached, changes are kept on this device and sent later.
      </p>
      <div className="flex items-center justify-between gap-3 text-sm">
        {line}
        <Button size="sm" variant="secondary" onClick={retry} disabled={busy}>Sync now</Button>
      </div>
    </Card>
  )
}
