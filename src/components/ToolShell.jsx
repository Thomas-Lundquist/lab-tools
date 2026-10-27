export default function ToolShell({ start, end, children }) {
  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-page)]">
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
