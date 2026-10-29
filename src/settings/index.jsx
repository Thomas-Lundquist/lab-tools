import React, { useState, useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { Eye, EyeOff, CheckCircle, AlertCircle, Loader, ShieldCheck, ShieldOff, Star } from 'lucide-react'
import { BrandLogo } from '../components/AppNav.jsx'
import ToolShell from '../components/ToolShell.jsx'
import SkipLink from '../components/SkipLink.jsx'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import FieldLabel from '../components/FieldLabel.jsx'
import TextField from '../components/TextField.jsx'
import Select from '../components/Select.jsx'
import Callout from '../components/Callout.jsx'
import Skeleton from '../components/Skeleton.jsx'
import { ToastProvider, useToast } from '../components/Toast.jsx'
import SetupGuard from '../components/SetupGuard.jsx'
import DeviceLinkExport from '../components/DeviceLinkExport.jsx'
import { verifyToken } from '../api/auth.js'
import { getCourses } from '../api/courses.js'
import { getAccount, saveAccount } from '../storage/account.js'
import { getPreferences, setPreference } from '../storage/preferences.js'
import { getSecuritySettings, setupPin, clearPin, resetExtension } from '../security/pin.js'
import { applyPalette, applyDarkMode, applyTextSize } from '../utils/color.js'
import { pageUrl } from '../utils/nav.js'
import '../styles/global.css'

function AccountSection() {
  const toast = useToast()
  const [account, setAccount]   = useState(null)
  const [editing, setEditing]   = useState(false)
  const [canvasUrl, setCanvasUrl] = useState('')
  const [token, setToken]       = useState('')
  const [showToken, setShowToken] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError]       = useState(null)

  useEffect(() => { getAccount().then(acc => { setAccount(acc); setCanvasUrl(acc?.canvasUrl ?? '') }) }, [])

  async function handleSave() {
    if (!token.trim()) { setError('Enter the new API token.'); return }
    setVerifying(true)
    setError(null)
    try {
      const user = await verifyToken(canvasUrl, token)
      await saveAccount({ canvasUrl, token, userName: user.name })
      setAccount(await getAccount())
      setEditing(false)
      setToken('')
      toast('Canvas account reconnected', 'success')
    } catch (err) {
      setError(err.message)
    } finally {
      setVerifying(false)
    }
  }

  if (!account) return <Card><Loader size={16} className="animate-spin" /></Card>

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold text-[var(--color-text-body)]">Canvas Account</h2>

      {!editing ? (
        <>
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Canvas URL</span><span className="font-medium text-[var(--color-text-body)]">{account.canvasUrl}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Signed in as</span><span className="font-medium text-[var(--color-text-body)]">{account.userName ?? '—'}</span></div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--color-text-muted)]">Status</span>
              <span className="flex items-center gap-1 font-medium text-[var(--color-success)]">
                <CheckCircle size={14} /> {account.verificationStatus === 'valid' ? 'Connected' : account.verificationStatus}
              </span>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Change URL / Token</Button>
        </>
      ) : (
        <div className="space-y-3">
          <div>
            <FieldLabel htmlFor="canvasUrl">Canvas URL</FieldLabel>
            <TextField id="canvasUrl" value={canvasUrl} onChange={setCanvasUrl} placeholder="https://yourschool.instructure.com" />
          </div>
          <div>
            <FieldLabel htmlFor="token">New API token</FieldLabel>
            <div className="relative">
              <TextField id="token" type={showToken ? 'text' : 'password'} value={token} onChange={setToken} placeholder="Paste your API token" className="pr-10" />
              <button type="button" onClick={() => setShowToken(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-[var(--color-error)] flex items-center gap-1"><AlertCircle size={14} />{error}</p>}
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={verifying}>{verifying ? 'Verifying…' : 'Verify & Save'}</Button>
            <Button variant="ghost" onClick={() => { setEditing(false); setError(null); setToken('') }}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function AppearanceSection() {
  const [prefs, setPrefs] = useState(null)

  useEffect(() => { getPreferences().then(setPrefs) }, [])

  async function update(key, value) {
    const updated = await setPreference(key, value)
    setPrefs(updated)
    if (key === 'palette') applyPalette(value)
    if (key === 'themeMode') applyDarkMode(value)
    if (key === 'textSize') applyTextSize(value)
  }

  if (!prefs) return null

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold text-[var(--color-text-body)]">Appearance</h2>
      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <FieldLabel htmlFor="themeMode">Theme</FieldLabel>
          <Select id="themeMode" value={prefs.themeMode} onChange={v => update('themeMode', v)}
            options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </div>
        <div>
          <FieldLabel htmlFor="palette">Palette</FieldLabel>
          <Select id="palette" value={prefs.palette} onChange={v => update('palette', v)}
            options={[{ value: 'bauhaus', label: 'Bauhaus' }, { value: 'modern', label: 'Modern' }]} />
        </div>
        <div>
          <FieldLabel htmlFor="textSize">Text size</FieldLabel>
          <Select id="textSize" value={prefs.textSize} onChange={v => update('textSize', v)}
            options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }, { value: 'extra-large', label: 'Extra Large' }]} />
        </div>
      </div>
    </Card>
  )
}

// Which courses show up in the Labs tool's course picker, and which of those
// are pinned to the top. Hiding/favoriting here is read by
// storage/preferences.js's visibleCourses() the next time a tool page loads
// its course list — this page and the tool page are separate full page
// loads (see CLAUDE.md), so there's no live cross-page sync to wire up.
function CoursesSection() {
  const [prefs, setPrefs]     = useState(null)
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  useEffect(() => {
    Promise.all([getPreferences(), getCourses()])
      .then(([p, c]) => { setPrefs(p); setCourses(c) })
      .finally(() => setLoading(false))
  }, [])

  async function update(key, value) {
    const updated = await setPreference(key, value)
    setPrefs(updated)
  }

  function toggleFavorite(courseId) {
    const favorites = prefs.favoriteCourseIds.includes(courseId)
      ? prefs.favoriteCourseIds.filter(id => id !== courseId)
      : [...prefs.favoriteCourseIds, courseId]
    update('favoriteCourseIds', favorites)
  }

  function toggleHidden(courseId) {
    const hidden = prefs.hiddenCourseIds.includes(courseId)
      ? prefs.hiddenCourseIds.filter(id => id !== courseId)
      : [...prefs.hiddenCourseIds, courseId]
    update('hiddenCourseIds', hidden)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return courses
    return courses.filter(c => c.name.toLowerCase().includes(q) || c.term?.toLowerCase().includes(q))
  }, [courses, search])

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text-body)]">Courses</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Choose which courses appear in the course picker, and star favorites to pin them to the top.
        </p>
      </div>

      {loading || !prefs ? (
        <div className="space-y-2">
          <Skeleton height="2.5rem" />
          <Skeleton height="2.5rem" />
          <Skeleton height="2.5rem" />
        </div>
      ) : (
        <>
          {courses.length > 6 && (
            <TextField value={search} onChange={setSearch} placeholder="Search courses" className="max-w-xs" />
          )}
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {filtered.map(c => {
              const favorited = prefs.favoriteCourseIds.includes(c.id)
              const hidden = prefs.hiddenCourseIds.includes(c.id)
              return (
                <div key={c.id} className="flex items-center gap-3 py-2.5">
                  <button
                    onClick={() => toggleFavorite(c.id)}
                    aria-label={favorited ? `Unfavorite ${c.name}` : `Favorite ${c.name}`}
                    aria-pressed={favorited}
                    className={`p-1 rounded-[var(--radius-control)] hover:bg-[var(--color-bg-hover)] ${favorited ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-muted)]'}`}
                  >
                    <Star size={16} fill={favorited ? 'currentColor' : 'none'} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-body)] truncate">{c.name}</p>
                    {c.term && <p className="text-xs text-[var(--color-text-muted)] truncate">{c.term}</p>}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] shrink-0">
                    <input type="checkbox" checked={!hidden} onChange={() => toggleHidden(c.id)} />
                    Show in selector
                  </label>
                </div>
              )
            })}
            {filtered.length === 0 && <p className="text-sm text-[var(--color-text-muted)] py-4 text-center">No courses match.</p>}
          </div>
        </>
      )}
    </Card>
  )
}

function SecuritySection() {
  const toast = useToast()
  const [security, setSecurity] = useState(null)
  const [pin, setPin]           = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [error, setError]       = useState(null)

  useEffect(() => { getSecuritySettings().then(setSecurity) }, [])

  async function handleSetPin() {
    if (pin.length < 4) { setError('PIN must be at least 4 digits.'); return }
    if (pin !== pinConfirm) { setError('PINs do not match.'); return }
    await setupPin(pin)
    setSecurity(await getSecuritySettings())
    setPin(''); setPinConfirm(''); setError(null)
    toast('PIN updated', 'success')
  }

  async function handleDisable() {
    await clearPin()
    setSecurity(await getSecuritySettings())
    toast('PIN protection disabled', 'info')
  }

  if (!security) return null

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold text-[var(--color-text-body)]">Security</h2>
      <div className="flex items-center gap-2 text-sm">
        {security.pinEnabled && security.pinHash
          ? <span className="flex items-center gap-1 text-[var(--color-success)]"><ShieldCheck size={15} /> PIN protection is on</span>
          : <span className="flex items-center gap-1 text-[var(--color-text-muted)]"><ShieldOff size={15} /> PIN protection is off</span>}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        When enabled, grade writeback requires this PIN after a period of inactivity.
      </p>
      <div className="grid sm:grid-cols-2 gap-3 max-w-md">
        <div>
          <FieldLabel htmlFor="pin">{security.pinHash ? 'New PIN' : 'Set a PIN'}</FieldLabel>
          <TextField id="pin" type="password" inputMode="numeric" value={pin} onChange={v => setPin(v.replace(/\D/g, '').slice(0, 6))} placeholder="••••" />
        </div>
        <div>
          <FieldLabel htmlFor="pinConfirm">Confirm</FieldLabel>
          <TextField id="pinConfirm" type="password" inputMode="numeric" value={pinConfirm} onChange={v => setPinConfirm(v.replace(/\D/g, '').slice(0, 6))} placeholder="••••" />
        </div>
      </div>
      {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSetPin}>{security.pinHash ? 'Update PIN' : 'Set PIN'}</Button>
        {security.pinHash && <Button size="sm" variant="secondary" onClick={handleDisable}>Disable PIN</Button>}
      </div>
    </Card>
  )
}

function DangerZone() {
  const [confirming, setConfirming] = useState(false)

  async function handleReset() {
    await resetExtension()
    window.location.href = pageUrl('src/pages/onboarding/index.html')
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-base font-semibold text-[var(--color-error)]">Danger Zone</h2>
      <p className="text-sm text-[var(--color-text-muted)]">
        Resetting clears your stored Canvas token, PIN, and preferences on this device. You'll need to go through setup again.
      </p>
      {!confirming ? (
        <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>Reset Extension</Button>
      ) : (
        <Callout tone="error" title="This cannot be undone.">
          <div className="flex gap-2 mt-2">
            <Button variant="danger" size="sm" onClick={handleReset}>Yes, reset everything</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </Callout>
      )}
    </Card>
  )
}

function App() {
  return (
    <>
      <SkipLink />
      <ToolShell start={<BrandLogo />} end={null}>
        <div className="overflow-y-auto flex-1">
          <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
            <h1 className="text-2xl font-bold text-[var(--color-text-body)]">Settings</h1>
            <AccountSection />
            <AppearanceSection />
            <CoursesSection />
            <SecuritySection />
            <DeviceLinkExport />
            <DangerZone />
          </div>
        </div>
      </ToolShell>
    </>
  )
}

getPreferences().then(p => { applyPalette(p.palette); applyDarkMode(p.themeMode ?? 'system'); applyTextSize(p.textSize ?? 'medium') })
createRoot(document.getElementById('root')).render(
  <SetupGuard><ToastProvider><App /></ToastProvider></SetupGuard>
)
