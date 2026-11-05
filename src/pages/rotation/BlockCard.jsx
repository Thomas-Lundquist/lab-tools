import { useEffect, useRef, useState } from 'react'
import { Droplet, EllipsisVertical, Maximize2, Shuffle } from 'lucide-react'
import Card from '../../components/Card.jsx'
import Button from '../../components/Button.jsx'
import Select from '../../components/Select.jsx'
import { MAX_KITCHEN, NUM_KITCHENS, activeKitchenIdxs, seatOrder, isAbsent } from './model.js'
import { unseatedIds } from './roster.js'

const ACCENT = { 1: 'var(--color-bauhaus-red)', 2: 'var(--color-bauhaus-blue)' }
const GRID = { gridTemplateColumns: `minmax(6.5rem, auto) repeat(${NUM_KITCHENS}, minmax(5.5rem, 1fr))` }

// One class on the board: its header, the 8-kitchen seat grid, today's duties
// and center sink, and any students in the section who aren't seated yet.
export default function BlockCard({ state, blockId, roster, display, actions }) {
  const block = state.blocks[blockId]
  const day = block.day
  const pos = state.slots[day].indexOf(blockId)
  const active = activeKitchenIdxs(block)
  const ready = roster.status === 'ready'
  const unseated = ready ? unseatedIds(block, roster.sectionIds) : []
  const nameOf = uid => roster.names[uid] ?? (roster.status === 'loading' ? '…' : 'Unknown student')
  const nobodySeated = active.length === 0

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]"
           style={{ borderTop: `4px solid ${ACCENT[block.course]}` }}>
        <Select
          value={String(pos + 1)}
          onChange={v => actions.move(blockId, v)}
          aria-label="Period"
          className="w-auto font-semibold"
          options={[
            ...[1, 2, 3, 4].map(n => ({ value: String(n), label: `${day}${n}` })),
            { value: 'prep', label: 'Prep (remove class)' },
          ]}
        />
        <Select
          value={String(block.course)}
          onChange={v => actions.setCourse(blockId, Number(v))}
          aria-label="Class type"
          className="w-auto"
          options={[{ value: '1', label: 'Culinary 1' }, { value: '2', label: 'Culinary 2' }]}
        />
        <span className="text-xs text-[var(--color-text-muted)] truncate" title="Canvas section">
          {roster.sectionName ?? ''}
          {roster.status === 'error' && <span className="text-[var(--color-error)]"> · Couldn’t load the roster: {roster.error}</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => actions.advance(blockId)} disabled={nobodySeated}>Advance</Button>
          <Button size="sm" variant="secondary" icon={Maximize2} onClick={() => actions.fullscreen(blockId)} disabled={nobodySeated}>Full screen</Button>
          <BlockMenu
            items={[
              { label: 'Attendance…', onClick: () => actions.attendance(blockId), disabled: nobodySeated },
              { label: 'Rotation history', onClick: () => actions.history(blockId) },
              { label: 'Save as original', onClick: () => actions.saveOriginal(blockId), disabled: nobodySeated },
              { label: 'Restore to original', onClick: () => actions.restoreOriginal(blockId), disabled: !block.kitchens.some(k => k.original.length) },
              { label: 'Reshuffle into kitchens…', onClick: () => actions.shuffle(blockId), disabled: !ready },
              { label: 'Remove this class…', onClick: () => actions.remove(blockId), danger: true },
            ]}
          />
        </div>
      </div>

      {nobodySeated && ready && roster.sectionIds.length > 0 ? (
        <div className="px-4 py-6 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {roster.sectionIds.length} students in {roster.sectionName}. None seated yet.
          </p>
          <Button icon={Shuffle} onClick={() => actions.shuffle(blockId, { confirmed: true })}>Shuffle into kitchens</Button>
        </div>
      ) : nobodySeated ? (
        <p className="px-4 py-6 text-sm text-center text-[var(--color-text-muted)]">
          {roster.status === 'loading' ? 'Loading the roster…' : 'No students in this section.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid text-sm min-w-max" style={GRID}>
            <div className="px-2 py-1.5" />
            {Array.from({ length: NUM_KITCHENS }, (_, ki) => (
              <div key={ki} className={`px-2 py-1.5 text-center font-semibold border-l border-[var(--color-border-subtle)] ${active.includes(ki) ? 'text-[var(--color-text-body)]' : 'text-[var(--color-text-disabled)]'}`}>
                K{ki + 1}
              </div>
            ))}

            {Array.from({ length: MAX_KITCHEN }, (_, r) => (
              <Row key={r} label={state.jobTitles[r]}>
                {Array.from({ length: NUM_KITCHENS }, (_, ki) => {
                  if (!active.includes(ki)) {
                    return <Cell key={ki} empty />
                  }
                  const uid = seatOrder(block, ki)[r]
                  if (!uid) return <Cell key={ki}><span className="text-xs tracking-wide text-[var(--color-text-disabled)]">SPLIT</span></Cell>
                  const away = isAbsent(block, uid)
                  return (
                    <Cell key={ki}>
                      <button
                        onClick={() => actions.student(blockId, uid)}
                        title={away ? 'Out today — this job is shared by the kitchen' : 'Attendance, move, or unseat'}
                        className={`w-full text-left px-1.5 py-1 rounded-[var(--radius-control)] truncate hover:bg-[var(--color-bg-hover)] ${away ? 'line-through text-[var(--color-text-body)] bg-[var(--color-danger-fill)]' : 'text-[var(--color-text-body)]'}`}
                      >
                        {nameOf(uid)}
                      </button>
                    </Cell>
                  )
                })}
              </Row>
            ))}

            <Row label="Extra Duty" muted>
              {Array.from({ length: NUM_KITCHENS }, (_, ki) => (
                <Cell key={ki} empty={!active.includes(ki)}>
                  <span className="text-xs text-[var(--color-text-secondary)]">{display.duties[ki] ?? ''}</span>
                </Cell>
              ))}
            </Row>
            <Row label="Center Sink" muted>
              {Array.from({ length: NUM_KITCHENS }, (_, ki) => (
                <Cell key={ki} empty={!active.includes(ki)}>
                  {display.sinks[ki] && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-[var(--radius-control)] bg-[var(--color-info-fill)] text-[var(--color-info)]">
                      <Droplet size={12} aria-hidden="true" /> Sink
                    </span>
                  )}
                </Cell>
              ))}
            </Row>
          </div>
        </div>
      )}

      {unseated.length > 0 && !nobodySeated && (
        <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-warning-fill)]">
          <p className="text-xs font-semibold text-[var(--color-text-body)] mb-2">
            Not seated yet ({unseated.length}): new to {roster.sectionName}, or unseated. Tap to pick a kitchen.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unseated.map(uid => (
              <button key={uid} onClick={() => actions.student(blockId, uid)}
                className="text-xs px-2 py-1 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] text-[var(--color-text-body)] hover:bg-[var(--color-bg-hover)]">
                {nameOf(uid)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function Row({ label, muted, children }) {
  return (
    <>
      <div className={`px-2 py-1.5 border-t border-[var(--color-border-subtle)] text-xs font-medium ${muted ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'}`}>{label}</div>
      {children}
    </>
  )
}

function Cell({ empty, children }) {
  return (
    <div className={`px-1 py-1 border-t border-l border-[var(--color-border-subtle)] min-h-[2.25rem] flex items-center ${empty ? 'bg-[var(--color-bg-page)]' : ''}`}>
      {children}
    </div>
  )
}

function BlockMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label="More actions" aria-expanded={open}
        className="p-1.5 rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] hover:bg-[var(--color-bg-hover)]">
        <EllipsisVertical size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-40 min-w-[13rem] py-1 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-[var(--radius-control)] shadow-[var(--shadow-xl)]">
          {items.map(it => (
            <button key={it.label} role="menuitem" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick() }}
              className={`block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed ${it.danger ? 'text-[var(--color-error)]' : 'text-[var(--color-text-body)]'}`}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

