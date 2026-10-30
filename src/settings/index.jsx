import React, { useState, useEffect, useMemo } from 'react'
import { CheckCircle, AlertCircle, Loader, ShieldCheck, ShieldOff, Star, X } from 'lucide-react'
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
import { useToast } from '../components/Toast.jsx'
import { getCurrentUser } from '../api/auth.js'
import { canvasOrigin } from '../api/canvasContext.js'
import { getCourses } from '../api/courses.js'
import { getPreferences, setPreference } from '../storage/preferences.js'
import { getFlags, saveFlags } from '../storage/setup.js'
import { DEFAULT_FLAGS } from '../config/labFlags.js'
import { getSecuritySettings, setupPin, clearPin, resetExtension } from '../security/pin.js'
import { applyPalette, applyDarkMode, applyTextSize } from '../utils/color.js'
import { navigate } from '../utils/nav.js'

function AccountSection() {
  const [user, setUser]   = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { getCurrentUser().then(setUser).catch(err => setError(err.message)) }, [])

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold text-[var(--color-text-body)]">Canvas Account</h2>
      <p className="text-xs text-[var(--color-text-muted)]">
        Lab Tools runs inside Canvas and uses your Canvas login. There is no API token to manage — to switch accounts, log in to Canvas as someone else and relaunch.
      </p>
      {error ? (
        <p className="text-sm text-[var(--color-error)] flex items-center gap-1"><AlertCircle size={14} />{error}</p>
      ) : !user ? (
        <Loader size={16} className="animate-spin" />
      ) : (
        <div className="text-sm space-y-1">
          <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Canvas</span><span className="font-medium text-[var(--color-text-body)]">{new URL(canvasOrigin()).host}</span></div>
          <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Signed in as</span><span className="font-medium text-[var(--color-text-body)]">{user.name}</span></div>
          <div className="flex justify-between items-center">
            <span className="text-[var(--color-text-muted)]">Status</span>
            <span className="flex items-center gap-1 font-medium text-[var(--color-success)]"><CheckCircle size={14} /> Connected</span>
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

// The teacher-editable lab flag checklist, shared across every course (stored
// globally via storage/setup.js). The Lab tool reads this list to build its
// flag pickers and to score: a saved lab keeps only flag ids, so renaming or
// re-rating a flag here recomputes past labs. Kitchen flags carry a severity
// (Minor / Major); individual flags do not (each simply drops one tier).
function LabFlagsSection() {
  const [flags, setFlags]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { getFlags().then(setFlags).finally(() => setLoading(false)) }, [])

  // Persist the whole list on every edit (saveFlags is a cheap localStorage
  // read-modify-write; the list is short and edits are infrequent).
  async function update(next) {
    setFlags(next)
    await saveFlags(next)
  }

  function addFlag(scope) {
    const flag = scope === 'kitchen'
      ? { id: `flag_${Date.now()}`, label: 'New kitchen flag', scope: 'kitchen', severity: 'minor' }
      : { id: `flag_${Date.now()}`, label: 'New individual flag', scope: 'individual' }
    update([...(flags ?? []), flag])
  }

  const setLabel    = (id, label)    => update(flags.map(f => (f.id === id ? { ...f, label } : f)))
  const setSeverity = (id, severity) => update(flags.map(f => (f.id === id ? { ...f, severity } : f)))
  const removeFlag  = id             => update(flags.filter(f => f.id !== id))

  const kitchen    = (flags ?? []).filter(f => f.scope === 'kitchen')
  const individual = (flags ?? []).filter(f => f.scope === 'individual')

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text-body)]">Lab flags</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          The checklist you tap when grading a lab, shared across every course. A clean kitchen scores the top;
          each kitchen flag lowers the score (a Major counts about twice a Minor), and each individual flag drops
          that one student one tier. Renaming or re-rating a flag also updates labs you have already graded.
        </p>
      </div>

      {loading || !flags ? (
        <Skeleton height="8rem" />
      ) : (
        <>
          <div className="space-y-2">
            <FieldLabel>Kitchen flags — apply to everyone in the kitchen</FieldLabel>
            <div className="space-y-2">
              {kitchen.map(f => (
                <div key={f.id} className="flex items-center gap-2">
                  <TextField value={f.label} onChange={v => setLabel(f.id, v)} aria-label="Flag label" className="flex-1" />
                  <div className="segmented-control shrink-0">
                    {[['minor', 'Minor'], ['critical', 'Major']].map(([val, lbl]) => (
                      <button key={val} aria-pressed={f.severity === val} onClick={() => setSeverity(f.id, val)}>{lbl}</button>
                    ))}
                  </div>
                  <button onClick={() => removeFlag(f.id)} aria-label={`Remove ${f.label}`}
                    className="shrink-0 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-error)]">
                    <X size={16} />
                  </button>
                </div>
              ))}
              {kitchen.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No kitchen flags yet.</p>}
            </div>
            <Button variant="secondary" size="sm" onClick={() => addFlag('kitchen')}>Add kitchen flag</Button>
          </div>

          <div className="space-y-2">
            <FieldLabel>Individual flags — apply to one student (each drops one tier)</FieldLabel>
            <div className="space-y-2">
              {individual.map(f => (
                <div key={f.id} className="flex items-center gap-2">
                  <TextField value={f.label} onChange={v => setLabel(f.id, v)} aria-label="Flag label" className="flex-1" />
                  <button onClick={() => removeFlag(f.id)} aria-label={`Remove ${f.label}`}
                    className="shrink-0 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-error)]">
                    <X size={16} />
                  </button>
                </div>
              ))}
              {individual.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No individual flags yet.</p>}
            </div>
            <Button variant="secondary" size="sm" onClick={() => addFlag('individual')}>Add individual flag</Button>
          </div>

          <button
            onClick={() => update(DEFAULT_FLAGS.map(f => ({ ...f })))}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] underline"
          >
            Reset to the built-in flags
          </button>
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
    navigate('onboarding', {}, { replace: true, remount: true })
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-base font-semibold text-[var(--color-error)]">Danger Zone</h2>
      <p className="text-sm text-[var(--color-text-muted)]">
        Resetting clears this tool's PIN, preferences, course setup, and saved grading drafts on this device. Canvas itself is not touched. You'll need to go through setup again.
      </p>
      {!confirming ? (
        <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>Reset Lab Tools</Button>
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

export default function Settings() {
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
            <LabFlagsSection />
            <SecuritySection />
            <DangerZone />
          </div>
        </div>
      </ToolShell>
    </>
  )
}
