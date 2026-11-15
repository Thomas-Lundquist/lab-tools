import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { RotateCw, Undo2 } from 'lucide-react'
import AppNav, { SettingsButton, BrandLogo } from '../../components/AppNav.jsx'
import ToolShell from '../../components/ToolShell.jsx'
import SkipLink from '../../components/SkipLink.jsx'
import { Tabs } from '../../components/Tabs.jsx'
import Button from '../../components/Button.jsx'
import Card from '../../components/Card.jsx'
import { useToast } from '../../components/Toast.jsx'
import { useRoute, navigate } from '../../utils/nav.js'
import { keyPrefix } from '../../storage/kv.js'
import { getRotation, updateRotation, getHistory, saveHistory, clearHistory } from '../../storage/rotation.js'
import { blankBlock, blockLabel, allBlockIds, staffedKitchenIdxs, setAbsent, clearAbsences, todayStamp, isAbsent, dayView } from './model.js'
import { blockDisplay } from './duties.js'
import { rotateBlocks, snapshotBlocks, applyUndo, saveOriginal, restoreOriginal } from './rotation.js'
import { appendRecords, removeBatch, rotatedOn, newBatchId, participationRows, toCSV } from './history.js'
import { seatShuffled, placeStudent, nudgeStudent, unseatStudent, removeDeparted, reconcileSeating } from './roster.js'
import { useRosters } from './useRosters.js'
import { useLabLink } from './useLabLink.js'
import { getSyncStatus, subscribeSyncStatus, syncNow, dismissRemoteChange } from '../../storage/sync.js'
import BlockCard from './BlockCard.jsx'
import FullscreenBoard from './FullscreenBoard.jsx'
import RotationSettings from './RotationSettings.jsx'
import { ConfirmModal, StudentModal, AttendanceModal, HistoryModal, StartClassModal } from './Modals.jsx'

// Kitchen Rotation: seats students in eight kitchens, rotates them through
// the job titles each class day, and hands out extra duties and center-sink
// turns. Ported from ../kitchen-rotator. Linked to the Labs tool one way
// (DECISIONS.md, 2026-11-14): home kitchens come from Course Settings, and on a
// lab day absences and visits come from that lab. Nothing here writes Labs data
// or the gradebook: the only Canvas writes are this tool's own synced documents.

// How often the page checks Canvas for other devices' edits while it's on
// screen: the classroom display usually runs on a separate device nobody
// touches, and sync otherwise only pulls when a tab comes back into view.
const POLL_MS = 20_000

const TAB_KEY = 'rotation:tab'
const loadTab = () => { try { return localStorage.getItem(keyPrefix() + TAB_KEY) || 'A' } catch { return 'A' } }
const saveTab = t => { try { localStorage.setItem(keyPrefix() + TAB_KEY, t) } catch { /* per-device convenience only */ } }

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function RotationPage() {
  const toast = useToast()
  const [state, setState] = useState(null)
  const [loadedDay, setLoadedDay] = useState(todayStamp)
  const [tab, setTab] = useState(loadTab)
  const [histories, setHistories] = useState({})
  // One step, memory only: an undo that survived a reload could rewind
  // yesterday's rotation into today's class.
  const [lastRotation, setLastRotation] = useState(null)
  const [modal, setModal] = useState(null)
  const [fullscreenId, setFullscreenId] = useState(null)
  const { byBlock: rosters, reload: reloadRosters } = useRosters(state)
  const { byBlock: link, reload: reloadLink } = useLabLink(state)

  useEffect(() => { getRotation().then(setState) }, [])

  // Keep the board live. Every finished sync (this page's poll, or a tab
  // coming back into view) re-reads the board; useLabLink re-reads the Labs
  // side on its own. Everything this page shows is re-read, so the app-wide
  // "refresh" banner isn't needed here.
  const lastSyncedAt = useSyncExternalStore(subscribeSyncStatus, () => getSyncStatus().lastSyncedAt)
  useEffect(() => {
    if (!lastSyncedAt) return
    getRotation().then(setState)
    dismissRemoteChange()
  }, [lastSyncedAt])
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') syncNow().catch(() => {})
    }, POLL_MS)
    return () => clearInterval(t)
  }, [])

  // Opened as #rotation?board=<blockId> (the Lab tab's "Open kitchen board"
  // shortcut): go straight to that class's fullscreen board. Closing it drops
  // the param, so a reload lands back on the rotator page.
  const { params } = useRoute()
  useEffect(() => {
    if (params.board && state?.blocks[params.board]) setFullscreenId(params.board)
  }, [params.board, state])
  function closeFullscreen() {
    setFullscreenId(null)
    if (params.board) navigate('rotation', {}, { replace: true })
  }

  // Absences belong to one class day. A board left open overnight reloads so
  // yesterday's marks lapse (normalizeState expires them).
  useEffect(() => {
    const t = setInterval(() => {
      const today = todayStamp()
      if (today !== loadedDay) { setLoadedDay(today); setLastRotation(null); getRotation().then(setState); reloadLink() }
    }, 60000)
    return () => clearInterval(t)
  }, [loadedDay, reloadLink])

  const blockIds = useMemo(() => (state ? allBlockIds(state) : []), [state])
  const blockKey = blockIds.join(',')
  useEffect(() => {
    if (!blockKey) return
    Promise.all(blockKey.split(',').map(id => getHistory(id).then(h => [id, h])))
      .then(pairs => setHistories(Object.fromEntries(pairs)))
  }, [blockKey])

  const commit = useCallback(async fn => {
    const { state: next, result } = await updateRotation(fn)
    setState(next)
    return result
  }, [])

  // Students who left their Canvas section leave their seat.
  const departedKey = JSON.stringify(blockIds.map(id => [id, rosters[id]?.status, rosters[id]?.sectionIds]))
  useEffect(() => {
    if (!state) return
    const ready = blockIds.filter(id => rosters[id]?.status === 'ready')
    const stale = ready.filter(id => state.blocks[id].kitchens.some(k => k.students.some(uid => !rosters[id].sectionIds.includes(uid))))
    if (!stale.length) return
    commit(s => stale.flatMap(id => (s.blocks[id] ? removeDeparted(s.blocks[id], rosters[id].sectionIds) : [])))
      .then(gone => { if (gone.length) toast(`${gone.length} student${gone.length === 1 ? '' : 's'} no longer in their Canvas section ${gone.length === 1 ? 'was' : 'were'} taken off the board.`, 'info') })
  // Runs when a roster arrives or changes, not on every seat edit.
  }, [departedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Seat each class from its period's home kitchens in Course Settings. Runs
  // when the home kitchens or a roster change; deterministic, so two devices
  // doing it at once write the same seating.
  const reconcileKey = JSON.stringify(blockIds.map(id => [id, rosters[id]?.status, rosters[id]?.sectionIds, link[id]?.home]))
  useEffect(() => {
    if (!state) return
    const due = blockIds.filter(id => rosters[id]?.status === 'ready' && link[id]?.home
      && reconcileSeating(structuredClone(state.blocks[id]), link[id].home, rosters[id].sectionIds))
    if (!due.length) return
    commit(s => due.forEach(id => s.blocks[id] && reconcileSeating(s.blocks[id], link[id].home, rosters[id].sectionIds)))
  }, [reconcileKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Today, per class: who's working where (model.js's dayView).
  const viewsFor = useCallback(s => Object.fromEntries(
    Object.keys(s?.blocks ?? {}).map(id => [id, dayView(s.blocks[id], link[id]?.att ?? null)]),
  ), [link])
  const views = useMemo(() => viewsFor(state), [viewsFor, state])

  const nameOf = useCallback((blockId, uid) => rosters[blockId]?.names[uid] ?? 'Former student', [rosters])

  // --- rotation ---

  async function rotate(ids, label) {
    const today = todayStamp(), batchId = newBatchId()
    let snap
    const records = await commit(s => { snap = snapshotBlocks(s, ids, label, batchId); return rotateBlocks(s, ids, { batchId, today, views: viewsFor(s) }) })
    const updated = {}
    for (const rec of records) {
      const h = appendRecords(await getHistory(rec._id), [rec])
      await saveHistory(rec._id, h)
      updated[rec._id] = h
    }
    setHistories(hs => ({ ...hs, ...updated }))
    setLastRotation(snap)
    toast(`${label}: done${records.length ? ', recorded' : ''}.`, 'success')
  }

  function rotateDay(day) {
    const ids = state.slots[day].filter(Boolean)
    const withStaff = ids.filter(id => staffedKitchenIdxs(state.blocks[id], views[id]).length > 0)
    const today = todayStamp()
    if (withStaff.length && withStaff.every(id => histories[id] && rotatedOn(histories[id], today))) {
      setModal({ type: 'confirm', title: `Rotate ${day} Day again?`, body: `You already rotated ${day} Day today. Rotating again moves everyone on another job.`, confirmLabel: 'Rotate again', onConfirm: () => rotate(ids, `Rotate ${day} Day`) })
      return
    }
    rotate(ids, `Rotate ${day} Day`)
  }

  async function undo() {
    const snap = lastRotation
    if (!snap) return
    setLastRotation(null)
    await commit(s => applyUndo(s, snap))
    const updated = {}
    for (const id of Object.keys(snap.blocks)) {
      const h = removeBatch(await getHistory(id), snap.batchId)
      await saveHistory(id, h)
      updated[id] = h
    }
    setHistories(hs => ({ ...hs, ...updated }))
    toast(`Undone: ${snap.label}.`, 'success')
  }

  useEffect(() => {
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || String(e.key).toLowerCase() !== 'z') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (!lastRotation || modal || fullscreenId) return
      e.preventDefault()
      undo()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // --- class actions ---

  const actions = {
    advance: id => rotate([id], `Advance ${blockLabel(state, id)}`),
    fullscreen: id => setFullscreenId(id),
    attendance: id => setModal({ type: 'attendance', blockId: id }),
    history: id => setModal({ type: 'history', blockId: id }),
    student: (id, uid) => setModal({ type: 'student', blockId: id, uid }),
    async saveOriginal(id) {
      await commit(s => saveOriginal(s, id)); setLastRotation(null)
      toast(`${blockLabel(state, id)}: current seating saved as the original.`, 'success')
    },
    restoreOriginal: id => setModal({
      type: 'confirm', title: `Restore ${blockLabel(state, id)} to its original seating?`,
      body: 'Puts back the saved seating and restarts the duty rotation. Students seated since the original was saved keep their kitchen.',
      confirmLabel: 'Restore', onConfirm: async () => {
        await commit(s => restoreOriginal(s, id)); setLastRotation(null)
        toast(`${blockLabel(state, id)}: restored to the saved original.`, 'success')
      },
    }),
    shuffle(id, { confirmed } = {}) {
      const roster = rosters[id]
      const run = async () => {
        const left = await commit(s => seatShuffled(s.blocks[id], roster.sectionIds))
        setLastRotation(null)
        toast(left.length ? `Only 40 students fit. ${left.length} left unseated.` : `Shuffled ${roster.sectionIds.length} students into kitchens. This seating is saved as the original.`, left.length ? 'warning' : 'success')
      }
      if (confirmed) return run()
      setModal({ type: 'confirm', title: `Reshuffle ${blockLabel(state, id)}?`, body: `Replaces the whole seating with a fresh shuffle of the ${roster.sectionIds.length} students in ${roster.sectionName}, about 4 to a kitchen, and restarts the duty rotation.`, confirmLabel: 'Reshuffle', danger: true, onConfirm: run })
    },
    remove: id => setModal({
      type: 'confirm', title: `Remove the class at ${blockLabel(state, id)}?`, danger: true, confirmLabel: 'Remove class',
      body: 'Deletes its seating, duty rotation and participation records, and makes the period a prep period. Export the participation CSV first if you still need it. This can’t be undone.',
      onConfirm: async () => {
        const label = blockLabel(state, id)
        await commit(s => {
          const day = s.blocks[id].day
          s.slots[day] = s.slots[day].map(x => (x === id ? null : x))
          delete s.blocks[id]
          s.duties.forEach(d => { delete d.apply[id] })
        })
        await clearHistory(id)
        setLastRotation(null)
        toast(`${label} is now a prep period.`, 'success')
      },
    }),
    async move(id, value) {
      if (value === 'prep') return actions.remove(id)
      const to = Number(value) - 1
      const msg = await commit(s => {
        const day = s.blocks[id].day, slots = s.slots[day], from = slots.indexOf(id)
        if (from === to) return null
        const displaced = slots[to]
        slots[from] = displaced; slots[to] = id
        return displaced ? `Swapped ${day}${from + 1} and ${day}${to + 1}.` : `Moved to ${day}${to + 1}.`
      })
      if (msg) toast(msg, 'success')
    },
    setCourse: (id, course) => commit(s => { s.blocks[id].course = course; s.blocks[id].className = course === 2 ? 'Culinary 2' : 'Culinary 1' }),
  }

  async function startClass(day, pos, { courseId, sectionId, course }) {
    await commit(s => {
      const id = `${day}${s.nextNum[day]}`
      s.nextNum[day] += 1
      s.blocks[id] = blankBlock(day, { courseId, sectionId, course })
      s.slots[day][pos] = id
      s.duties.forEach(d => { d.apply[id] = false })
    })
    toast(`Started a class at ${day}${pos + 1}.`, 'success')
  }

  function exportCSV(onlyId) {
    const ids = onlyId ? [onlyId] : blockIds
    const entries = ids.map(id => ({ label: blockLabel(state, id), day: state.blocks[id].day, records: histories[id]?.records ?? [] }))
    const names = Object.assign({}, ...ids.map(id => rosters[id]?.names ?? {}))
    const rows = participationRows(entries, uid => names[uid] ?? 'Former student')
    if (rows.length === 1) { toast('No rotations recorded yet, so there’s nothing to export.', 'info'); return }
    download(toCSV(rows), `kitchen-participation${onlyId ? `-${blockLabel(state, onlyId)}` : ''}-${todayStamp()}.csv`)
    toast(`Exported ${rows.length - 1} row${rows.length === 2 ? '' : 's'}.`, 'success')
  }

  const recordCount = blockIds.every(id => histories[id]) ? blockIds.reduce((n, id) => n + histories[id].records.length, 0) : null
  const changeTab = t => { setTab(t); saveTab(t) }
  const day = tab === 'B' ? 'B' : 'A'

  return (
    <>
      <SkipLink />
      <ToolShell
        start={<><BrandLogo /><h1 className="text-sm font-semibold text-[var(--color-text-body)] truncate">Kitchen Rotation</h1></>}
        end={<><AppNav current="rotation" /><SettingsButton /></>}
      >
        <div className="overflow-y-auto flex-1">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Tabs tabs={[{ id: 'A', label: 'A Day' }, { id: 'B', label: 'B Day' }, { id: 'settings', label: 'Duties & Settings' }]} activeTab={tab} onChange={changeTab} />
              {tab !== 'settings' && state && (
                <div className="flex items-center gap-2">
                  {lastRotation && <Button variant="secondary" icon={Undo2} onClick={undo} title="Puts the seats and duty rotation back as they were">Undo: {lastRotation.label}</Button>}
                  <Button icon={RotateCw} onClick={() => rotateDay(day)} disabled={!state.slots[day].some(Boolean)}>Rotate {day} Day</Button>
                </div>
              )}
            </div>

            {!state ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
              : tab === 'settings' ? (
                <RotationSettings state={state} recordCount={recordCount} onChange={commit}
                  onExportAll={() => exportCSV()}
                  onClearHistory={() => setModal({
                    type: 'confirm', title: 'Clear all participation records?', danger: true, confirmLabel: 'Clear history',
                    body: 'Deletes every participation record for every class, on every device. Export the CSV first if you still need it. This can’t be undone.',
                    onConfirm: async () => {
                      for (const id of blockIds) await clearHistory(id)
                      setHistories(Object.fromEntries(blockIds.map(id => [id, { records: [] }])))
                      setLastRotation(null)
                      toast('Participation records cleared.', 'success')
                    },
                  })} />
              ) : (
                <div className="space-y-5">
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Rotate at the <b>end</b> of each class day: it records what the class just did, then moves everyone to the next job.
                    {' '}Home kitchens come from Course Settings. On a lab day, attendance and kitchen moves come from the Grade tab.
                    {Object.values(rosters).some(r => r.status === 'error') && <button className="ml-2 underline" onClick={reloadRosters}>Retry loading rosters</button>}
                  </p>
                  {state.slots[day].map((id, pos) => id ? (
                    <BlockCard key={id} state={state} blockId={id} roster={rosters[id] ?? { status: 'loading', sectionIds: [], names: {} }}
                      view={views[id]} link={link[id] ?? null}
                      display={blockDisplay(state, id, views)} actions={actions} />
                  ) : (
                    <Card key={`empty-${pos}`} padding="md" className="flex flex-wrap items-center justify-between gap-3 border-dashed">
                      <span className="text-sm text-[var(--color-text-muted)]">{day}{pos + 1} · prep period</span>
                      <Button size="sm" variant="secondary" onClick={() => setModal({ type: 'start', day, pos })}>Start a class here</Button>
                    </Card>
                  ))}
                </div>
              )}
          </div>
        </div>
      </ToolShell>

      {modal?.type === 'confirm' && <ConfirmModal {...modal} onClose={() => setModal(null)} />}
      {modal?.type === 'start' && (
        <StartClassModal day={modal.day} pos={modal.pos}
          usedSectionIds={new Set(Object.values(state.blocks).map(b => b.sectionId))}
          onStart={opts => { setModal(null); startClass(modal.day, modal.pos, opts) }}
          onClose={() => setModal(null)} />
      )}
      {modal?.type === 'student' && state.blocks[modal.blockId] && (() => {
        const { blockId: id, uid } = modal
        return (
          <StudentModal block={state.blocks[id]} uid={uid} name={nameOf(id, uid)} onClose={() => setModal(null)}
            view={views[id]} homeFromSettings={!!link[id]?.home} labName={link[id]?.lab?.name ?? null}
            onAbsent={on => commit(s => setAbsent(s.blocks[id], uid, on, todayStamp()))}
            onPlace={async ki => { const ok = await commit(s => placeStudent(s.blocks[id], uid, ki)); if (!ok) toast(`Kitchen ${ki + 1} is full (5).`, 'warning') }}
            onNudge={delta => commit(s => nudgeStudent(s.blocks[id], uid, delta))}
            onUnseat={async () => { await commit(s => unseatStudent(s.blocks[id], uid)); setModal(null) }} />
        )
      })()}
      {modal?.type === 'attendance' && state.blocks[modal.blockId] && (
        <AttendanceModal title={`Attendance — ${blockLabel(state, modal.blockId)} ${state.blocks[modal.blockId].className}`}
          block={state.blocks[modal.blockId]} nameOf={uid => nameOf(modal.blockId, uid)}
          onToggle={uid => commit(s => { const b = s.blocks[modal.blockId]; setAbsent(b, uid, !isAbsent(b, uid), todayStamp()) })}
          onClear={() => commit(s => clearAbsences(s.blocks[modal.blockId]))}
          onClose={() => setModal(null)} />
      )}
      {modal?.type === 'history' && state.blocks[modal.blockId] && (
        <HistoryModal title={`Rotation history — ${blockLabel(state, modal.blockId)} ${state.blocks[modal.blockId].className}`}
          history={histories[modal.blockId]} nameOf={uid => nameOf(modal.blockId, uid)}
          onExport={() => exportCSV(modal.blockId)} onClose={() => setModal(null)} />
      )}
      {fullscreenId && state?.blocks[fullscreenId] && (
        <FullscreenBoard state={state} blockId={fullscreenId} names={rosters[fullscreenId]?.names ?? {}}
          view={views[fullscreenId]} display={blockDisplay(state, fullscreenId, views)} onClose={closeFullscreen} />
      )}
    </>
  )
}
