export default function ToolShell({ start, end, children }) {
  // h-[100dvh], not h-screen (100vh): on iPad Safari the browser toolbar makes the
  // visible area shorter than 100vh, so the bottom of the scroll area sat out of
  // reach until the toolbar auto-hid. The dynamic viewport unit tracks the visible
  // height, so the page can always scroll fully.
  return (
    <div className="h-[100dvh] flex flex-col bg-[var(--color-bg-page)]">
      <header className="bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] sticky top-0 z-30">
        <div className="flex items-center justify-between gap-4 h-14 px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">{start}</div>
          <div className="flex items-center gap-2 shrink-0">{end}</div>
        </div>
      </header>
      <main id="main-content" className="flex-1 flex flex-col min-h-0">
        {children}
      </main>
    </div>
  )
}
