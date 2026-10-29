// A small toggle chip. Extracted from ScorePanel's inline version so the kitchen
// grading screen can reuse it with severity-indicative tones. Active = a bold
// filled pill (Bauhaus: solid primary, white text); inactive = a quiet outline.
//
// Tones map to the app's existing semantic color tokens (the eslint token guard
// forbids raw hex / bare Tailwind colors, so every color here is a --color-*):
//   minor      -> warning  (amber)   critical -> danger (red)
//   individual -> info     (blue)    exceeded -> success (green)
//   note / deduct are kept for the legacy ScorePanel.

// All active tones use *-fill tokens: fixed dark colors that keep white text
// readable in both light and dark mode. The plain --color-warning/--color-info
// tokens are for text and lighten in dark mode, so they must not back white text.
const TONES = {
  minor:      'border-[var(--color-warning-fill)] text-white bg-[var(--color-warning-fill)]',
  critical:   'border-[var(--color-danger-fill)] text-white bg-[var(--color-danger-fill)]',
  individual: 'border-[var(--color-info-fill)] text-white bg-[var(--color-info-fill)]',
  exceeded:   'border-[var(--color-success-fill)] text-white bg-[var(--color-success-fill)]',
  note:       'border-[var(--color-info-fill)] text-white bg-[var(--color-info-fill)]',
  deduct:     'border-[var(--color-danger-fill)] text-white bg-[var(--color-danger-fill)]',
}

export default function Chip({ active, tone = 'note', onClick, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`px-2 py-0.5 rounded-full border text-xs font-medium transition-colors duration-75 ${
        active
          ? TONES[tone] ?? TONES.note
          : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
      }`}
    >
      {children}
    </button>
  )
}
