import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Emits dist/launch.js from src/launch/launch.js, filling in the app entry's
// hashed JS and CSS names and inlining public/theme-init.js (so the theme is
// set before the app's first paint, same as theme-init does for app.html).
function emitLauncher() {
  return {
    name: 'emit-launcher',
    apply: 'build',
    generateBundle(_, bundle) {
      const entry = Object.values(bundle).find(c => c.type === 'chunk' && c.isEntry && c.name === 'app')
      if (!entry) this.error('emit-launcher: no "app" entry chunk in the bundle')
      // global.css is shared with the install page, so Vite hangs it off a
      // shared chunk rather than the entry — walk the static import graph.
      const css = new Set()
      const seen = new Set()
      ;(function collect(chunk) {
        if (!chunk || seen.has(chunk.fileName)) return
        seen.add(chunk.fileName)
        chunk.viteMetadata?.importedCss?.forEach(f => css.add(f))
        chunk.imports.forEach(f => collect(bundle[f]))
      })(entry)
      if (!css.size) this.error('emit-launcher: app entry has no CSS — launch.js would load an unstyled app')
      const source = readFileSync(resolve(__dirname, 'src/launch/launch.js'), 'utf8')
        .replace("'__ENTRY__'", JSON.stringify(entry.fileName))
        .replace('__CSS__', JSON.stringify([...css]))
        .replace('/*__THEME_INIT__*/', readFileSync(resolve(__dirname, 'public/theme-init.js'), 'utf8').trim())
      this.emitFile({ type: 'asset', fileName: 'launch.js', source })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Local dev only: the app on localhost can't use a Canvas session cookie, so
  // the dev server proxies /api/v1 to Canvas with a personal token from
  // .env.local (gitignored, never VITE_-prefixed, so it never reaches the
  // browser bundle). This runs on the teacher's own machine — no third party —
  // and production has no proxy at all.
  const env = loadEnv(mode, __dirname, '')
  const devCanvas = env.CANVAS_DEV_ORIGIN || 'https://graniteschools.instructure.com'

  return {
    // Relative base: the bundle is loaded into a Canvas-origin document, so
    // chunk/asset URLs must resolve against the module's own URL (this site),
    // never against the document (Canvas).
    base: './',
    plugins: [
      react(),
      emitLauncher(),
      // The old Vercel-hosted app registered a service worker that precached it.
      // selfDestroying ships a worker that unregisters itself and clears those
      // caches on devices that still have it. Safe to drop once they've all
      // visited the site again.
      VitePWA({ selfDestroying: true }),
    ],
    server: {
      port: 5175,
      strictPort: true,
      proxy: env.CANVAS_DEV_TOKEN ? {
        '/api/v1': {
          target: devCanvas,
          changeOrigin: true,
          headers: { Authorization: `Bearer ${env.CANVAS_DEV_TOKEN}` },
        },
      } : undefined,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          app:   resolve(__dirname, 'src/app/main.jsx'),
        },
      },
    },
  }
})
