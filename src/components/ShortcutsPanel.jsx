import Modal from './Modal.jsx'

const GLOBAL_SHORTCUTS = [
  { combo: '?',        description: 'Open this reference' },
  { combo: 'Escape',   description: 'Close / cancel' },
  { combo: 'Ctrl + ,', description: 'Open Settings' },
]

// sections = [{ label: string, shortcuts: [{ combo, description }] }]
export default function ShortcutsPanel({ sections = [], onClose }) {
  const allSections = [
    { label: 'Global', shortcuts: GLOBAL_SHORTCUTS },
    ...sections,
  ]

  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose} size="sm">
      <div className="space-y-5">
        {allSections.map(section => (
          <div key={section.label}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">
              {section.label}
            </p>
            <div className="space-y-2">
              {section.shortcuts.map(sc => (
                <div key={sc.combo} className="flex items-center justify-between gap-4">
                  <kbd className="inline-block text-xs font-mono bg-[var(--color-bg-hover)] px-2 py-0.5 rounded border border-[var(--color-border)] whitespace-nowrap shrink-0">
                    {sc.combo}
                  </kbd>
                  <span className="text-sm text-[var(--color-text-secondary)]">{sc.description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
