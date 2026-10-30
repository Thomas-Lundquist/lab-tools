import { useState, useEffect, useRef } from 'react'
import { navigate, useRoute } from './nav.js'

// pageShortcuts shape:
// [{ key: 'a', ctrl: true, shift: false, combo: 'Ctrl + A', description: '...', action: fn }]
export function useKeyboardShortcuts(pageShortcuts = []) {
  const [showPanel, setShowPanel] = useState(false)
  const { route } = useRoute()
  const routeRef = useRef(route)
  useEffect(() => { routeRef.current = route })
  // Ref keeps action closures current without re-registering the listener
  const shortcutsRef = useRef(pageShortcuts)
  useEffect(() => { shortcutsRef.current = pageShortcuts })

  useEffect(() => {
    function handler(e) {
      const inTextField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)
        || e.target?.isContentEditable

      // Ctrl+, — open Settings (skip if already on settings page)
      if (e.key === ',' && (e.ctrlKey || e.metaKey) && !inTextField) {
        e.preventDefault()
        if (routeRef.current !== 'settings') navigate('settings')
        return
      }

      // ? — toggle shortcut reference panel
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !inTextField) {
        e.preventDefault()
        setShowPanel(s => !s)
        return
      }

      if (inTextField) return

      for (const s of shortcutsRef.current) {
        const ctrlMatch = !!s.ctrl === (e.ctrlKey || e.metaKey)
        const shiftMatch = !!s.shift === e.shiftKey
        const altMatch = !!s.alt === e.altKey
        if (e.key.toLowerCase() === s.key.toLowerCase() && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault()
          s.action()
          return
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // empty — handler reads shortcuts through ref

  return { showPanel, setShowPanel }
}
