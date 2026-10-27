// Tabs({ tabs, activeTab, onChange })
// tabs: [{ id: string, label: string }]
// Renders an accessible tab list. Wrap tab panel content in <TabPanel tabId="..." activeTab={...}>.
// Active state uses a bottom-border indicator rather than solid fill — avoids contrast failures
// when the user's chosen accent colour is light (e.g. orange or green in dark mode).
export function Tabs({ tabs, activeTab, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Tool sections"
      className="flex w-fit border-b"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {tabs.map(tab => {
        const active = activeTab === tab.id
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
              active ? '' : 'hover:bg-[var(--color-bg-hover)]'
            }`}
            style={active
              ? { borderColor: 'var(--cpt-color-text)', color: 'var(--cpt-color-text)', backgroundColor: 'var(--color-bg-hover)' }
              : { borderColor: 'transparent', color: 'var(--color-text-muted)' }
            }
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ tabId, activeTab, children }) {
  const active = tabId === activeTab
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${tabId}`}
      aria-labelledby={`tab-${tabId}`}
      hidden={!active}
    >
      {active && children}
    </div>
  )
}
