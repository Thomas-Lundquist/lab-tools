import React, { useState, useEffect } from 'react'
import { LayoutGrid, List, ChevronRight } from 'lucide-react'
import { SettingsButton, BrandMark } from '../components/AppNav.jsx'
import { TOOLS, MODULES } from '../config/tools.jsx'
import { getPreferences, setPreference } from '../storage/preferences.js'
import { applyPalette, applyDarkMode } from '../utils/color.js'
import SkipLink from '../components/SkipLink.jsx'
import { useKeyboardShortcuts } from '../utils/useKeyboardShortcuts.js'
import ShortcutsPanel from '../components/ShortcutsPanel.jsx'
import { navigate } from '../utils/nav.js'

export default function Home() {
  const [displayMode, setDisplayMode] = useState('tiles')

  useEffect(() => {
    getPreferences().then(p => {
      applyPalette(p.palette)
      applyDarkMode(p.themeMode ?? 'system')
      setDisplayMode(p.homepageDisplayMode ?? 'tiles')
    })
  }, [])

  function toggleMode() {
    const next = displayMode === 'tiles' ? 'list' : 'tiles'
    setDisplayMode(next)
    setPreference('homepageDisplayMode', next)
  }

  // Group tools by module, preserving MODULES order
  const grouped = MODULES.map(mod => ({
    ...mod,
    tools: TOOLS.filter(t => t.module === mod.id),
  })).filter(g => g.tools.length > 0)

  const { showPanel, setShowPanel } = useKeyboardShortcuts([])

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)]">
      <SkipLink />
      {/* Header */}
      <div className="bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <BrandMark />
          <div className="flex items-center gap-1">
            <button
              onClick={toggleMode}
              className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] hover:bg-[var(--color-bg-hover)] transition-colors duration-75"
              title={displayMode === 'tiles' ? 'Switch to list view' : 'Switch to tile view'}
              aria-label={displayMode === 'tiles' ? 'Switch to list view' : 'Switch to tile view'}
            >
              {displayMode === 'tiles' ? <List size={16} /> : <LayoutGrid size={16} />}
            </button>
            <SettingsButton />
          </div>
        </div>
      </div>

      {/* Content */}
      <div id="main-content" className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        {grouped.map(group => (
          <section key={group.id} aria-label={group.label}>
            <h2 className="section-title mb-4">{group.label}</h2>

            {displayMode === 'tiles' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.tools.map(tool => (
                  <button
                    key={tool.id}
                    onClick={() => navigate(tool.route)}
                    className="group card p-6 text-left hover:bg-[var(--color-bg-hover)] transition-colors duration-75"
                  >
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4">
                      <tool.Icon size={20} className="text-[var(--color-text-muted)] group-hover:text-[var(--cpt-color-text)] transition-colors duration-75" />
                    </div>
                    <h3 className="text-sm font-semibold tracking-tight text-[var(--color-text-body)] mb-1">{tool.label}</h3>
                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{tool.description}</p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="card overflow-hidden">
                {group.tools.map((tool, i) => (
                  <button
                    key={tool.id}
                    onClick={() => navigate(tool.route)}
                    className={`group w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-[var(--color-bg-hover)] transition-colors duration-75 ${i > 0 ? 'border-t border-[var(--color-border-subtle)]' : ''}`}
                  >
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0">
                      <tool.Icon size={18} className="text-[var(--color-text-muted)] group-hover:text-[var(--cpt-color-text)] transition-colors duration-75" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold tracking-tight text-[var(--color-text-body)]">{tool.label}</div>
                      <div className="text-xs text-[var(--color-text-secondary)] mt-0.5">{tool.description}</div>
                    </div>
                    <ChevronRight size={15} className="shrink-0 text-[var(--color-text-muted)]" />
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      {showPanel && <ShortcutsPanel onClose={() => setShowPanel(false)} />}
    </div>
  )
}

