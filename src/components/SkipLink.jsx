export default function SkipLink() {
  return (
    <a
      href="#main-content"
      className="fixed -top-16 left-4 focus-visible:top-4 z-[100] px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-bg-surface)] shadow-lg border border-[var(--color-border)] transition-all duration-150"
      style={{ color: 'var(--cpt-color-text)' }}
    >
      Skip to main content
    </a>
  )
}
