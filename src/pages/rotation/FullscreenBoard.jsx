import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Droplet, X } from 'lucide-react'
import { MAX_KITCHEN, activeKitchenIdxs, staffedKitchenIdxs, seatOrder, isAbsent, blockLabel } from './model.js'

// The classroom display, ported from ../kitchen-rotator/js/fullscreen.js:
// names sized to fill the screen, today's duties, and countdowns to the
// cleanup bell and the end of class.

// Position within a day (1st-4th block) maps to these times on A and B days alike.
const BELL_SCHEDULES = {
  monThu: { label: 'Monday–Thursday', blocks: [
    { start: '07:30', end: '08:55' }, { start: '09:01', end: '10:33' },
    { start: '11:14', end: '12:39' }, { start: '12:45', end: '14:10' }] },
  friday: { label: 'Friday (Late Start)', blocks: [
    { start: '08:30', end: '09:42' }, { start: '09:48', end: '11:00' },
    { start: '11:40', end: '12:52' }, { start: '12:58', end: '14:10' }] },
}
const CLEANUP_LEAD_MIN = 10

function timeToday(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(); d.setHours(h, m, 0, 0)
  return d
}
function countdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

// Every element of one text role shares one font size: the largest at which
// all of them still fit their cells. Cells have fixed sizes (fr rows/columns),
// so the size is found by measuring, binary-searching between min and max.
function fitRole(els, max, min) {
  const fits = () => els.every(el => el.clientWidth > 0 && el.clientHeight > 0 &&
    el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)
  if (!els.length) return max
  let lo = min, hi = max, best = min
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    els.forEach(el => { el.style.fontSize = `${mid}px` })
    if (fits()) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  els.forEach(el => { el.style.fontSize = `${best}px` })
  return best
}

function fitAll(root) {
  const q = sel => [...root.querySelectorAll(sel)]
  const namePx = fitRole(q('[data-fs=name]'), 220, 14)
  const labelPx = fitRole(q('[data-fs=label]'), 90, 12)
  // Never louder than the names: SPLIT is the absence of a student.
  fitRole(q('[data-fs=split]'), Math.max(10, Math.min(90, namePx)), 10)
  // A short title in a half-height row would otherwise outgrow the full rows.
  fitRole(q('[data-fs=splitlabel]'), Math.max(10, labelPx), 10)
  fitRole(q('[data-fs=head]'), 110, 12)
  fitRole(q('[data-fs=duty]'), 56, 10)
  fitRole(q('[data-fs=sink]'), 36, 10)
}

export default function FullscreenBoard({ state, blockId, names, display, onClose }) {
  const block = state.blocks[blockId]
  const [scheduleKey, setScheduleKey] = useState(() => (new Date().getDay() === 5 ? 'friday' : 'monThu'))
  const [now, setNow] = useState(() => new Date())
  const gridRef = useRef(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { clearInterval(t); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  // Fit after every content change, again once layout settles, on resize, and
  // once web fonts arrive (measuring against fallback metrics gives the wrong size).
  const contentKey = JSON.stringify([block?.kitchens, block?.absent, names, display, state.jobTitles])
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const fit = () => fitAll(el)
    fit()
    const raf = requestAnimationFrame(fit)
    window.addEventListener('resize', fit)
    document.fonts?.ready?.then(fit).catch(() => {})
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', fit) }
  }, [contentKey])

  if (!block) return null
  const active = activeKitchenIdxs(block)
  const staffed = staffedKitchenIdxs(block)
  const orders = Object.fromEntries(active.map(ki => [ki, seatOrder(block, ki)]))
  let usedRows = 0
  for (let r = 0; r < MAX_KITCHEN; r++) if (active.some(ki => orders[ki][r])) usedRows = r + 1
  usedRows = Math.max(1, usedRows)
  const splitRows = MAX_KITCHEN - usedRows
  // fr rows (min 0) always sum to exactly the grid's height. Unfilled job rows
  // still show (they read SPLIT) but at half height; the duty row gets the
  // room the header and name rows give up.
  const dutyFr = 1.1 + (0.7 - 0.6125) + usedRows * (1 - 0.875)
  const gridStyle = {
    gridTemplateColumns: `minmax(0,240px) repeat(${active.length}, minmax(0,1fr))`,
    gridTemplateRows: `minmax(0,0.6125fr) repeat(${usedRows}, minmax(0,0.875fr))` +
      (splitRows > 0 ? ` repeat(${splitRows}, minmax(0,0.5fr))` : '') + ` minmax(0,${dutyFr}fr) minmax(0,0.7fr)`,
  }

  const pos = state.slots[block.day].indexOf(blockId)
  const times = BELL_SCHEDULES[scheduleKey].blocks[pos]
  let timers = null
  if (times) {
    const end = timeToday(times.end)
    const toEnd = end - now
    const toCleanup = toEnd - CLEANUP_LEAD_MIN * 60000
    const over = toEnd <= 0
    const cleanup = !over && toCleanup <= 0
    timers = [
      { label: 'Time until cleanup bell', value: over ? 'Done' : cleanup ? 'Clean up now' : countdown(toCleanup), alert: cleanup },
      { label: 'Time left in class', value: over ? 'Class ended' : countdown(toEnd), muted: over },
    ]
  }

  const cell = 'flex items-center justify-center overflow-hidden text-center leading-tight px-2 border border-[var(--color-border)]'
  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-3 p-4 bg-[var(--color-bg-page)] text-[var(--color-text-body)]">
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-black">{blockLabel(state, blockId)}</span>
          <span className="text-xl font-semibold text-[var(--color-text-secondary)]">{block.className}</span>
        </div>
        <div className="flex-1 text-center text-2xl font-semibold">
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <select value={scheduleKey} onChange={e => setScheduleKey(e.target.value)} className="input w-auto" aria-label="Bell schedule">
          {Object.entries(BELL_SCHEDULES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
        <button onClick={onClose} className="btn-secondary"><X size={16} aria-hidden="true" /> Close</button>
      </div>

      <div className="flex gap-3 shrink-0">
        {timers ? timers.map(t => (
          <div key={t.label} className={`flex-1 rounded-[var(--radius-card)] px-4 py-2 border ${t.alert ? 'bg-[var(--color-danger-fill)] border-[var(--color-error)]' : 'bg-[var(--color-bg-surface)] border-[var(--color-border)]'} ${t.muted ? 'opacity-60' : ''}`}>
            <div className="text-sm font-medium text-[var(--color-text-secondary)]">{t.label}</div>
            <div className={`text-4xl font-black tabular-nums ${t.alert ? 'text-[var(--color-error)]' : ''}`}>{t.value}</div>
          </div>
        )) : (
          <div className="flex-1 rounded-[var(--radius-card)] px-4 py-2 border border-[var(--color-border)] text-sm text-[var(--color-text-muted)]">
            No bell time for position {pos + 1}. The schedule covers the four daily blocks.
          </div>
        )}
      </div>

      {active.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-2xl text-[var(--color-text-muted)]">No kitchens in use for this class.</div>
      ) : (
        <div ref={gridRef} className="flex-1 min-h-0 grid bg-[var(--color-bg-surface)]" style={gridStyle}>
          <div className={cell} />
          {active.map(ki => <div key={ki} data-fs="head" className={`${cell} whitespace-nowrap font-black`}>K{ki + 1}</div>)}

          {Array.from({ length: MAX_KITCHEN }, (_, r) => {
            const splitRow = r >= usedRows
            return [
              <div key={`l${r}`} data-fs={splitRow ? 'splitlabel' : 'label'} className={`${cell} font-semibold text-[var(--color-text-secondary)] ${splitRow ? 'opacity-70' : ''}`}>{state.jobTitles[r]}</div>,
              ...active.map(ki => {
                const uid = orders[ki][r]
                if (!uid) return <div key={`${r}-${ki}`} data-fs="split" className={`${cell} tracking-widest text-[var(--color-text-disabled)]`}>SPLIT</div>
                const away = isAbsent(block, uid)
                return (
                  <div key={`${r}-${ki}`} data-fs="name" className={`${cell} whitespace-nowrap relative font-bold ${away ? 'text-[var(--color-text-disabled)]' : ''}`}>
                    {names[uid] ?? '…'}
                    {away && (
                      // A veil ON TOP of the name, so an absence costs no grid height.
                      <span className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-danger-fill)] opacity-90 pointer-events-none">
                        <b className="text-[var(--color-error)] text-lg tracking-widest">ABSENT</b>
                        <i className="text-[var(--color-text-secondary)] text-sm not-italic tracking-widest">SPLIT</i>
                      </span>
                    )}
                  </div>
                )
              }),
            ]
          })}

          <div data-fs="label" className={`${cell} font-semibold text-[var(--color-text-secondary)]`}>Extra Duty</div>
          {active.map(ki => (
            // Nobody in today: no duty at all, rather than "None".
            <div key={`d${ki}`} data-fs="duty" className={`${cell} font-semibold bg-[var(--color-bg-hover)]`}>
              {staffed.includes(ki) ? (display.duties[ki] || 'None') : ' '}
            </div>
          ))}

          <div data-fs="label" className={`${cell} font-semibold text-[var(--color-text-secondary)]`}>Center Sink</div>
          {active.map(ki => {
            const on = staffed.includes(ki) && display.sinks[ki]
            return (
              <div key={`s${ki}`} data-fs="sink" className={`${cell} font-bold ${on ? 'bg-[var(--color-info-fill)] text-[var(--color-info)]' : ''}`}>
                {on ? <span className="inline-flex items-center gap-[0.3em]"><Droplet className="w-[1em] h-[1em]" aria-hidden="true" /> Center Sink</span> : ''}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
