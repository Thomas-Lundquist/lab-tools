import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// GitHub Pages serves this repo from /lab-tools/, not the domain root — but
// `npm run dev` should keep serving from / so the documented localhost:5175
// workflow doesn't change. Only the production build gets the subpath base.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/lab-tools/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-source.svg'],
      manifest: {
        name: 'Culinary Canvas Tools',
        short_name: 'Lab Tools',
        description: 'A personal Canvas toolkit for culinary classes.',
        theme_color: '#B7102A',
        background_color: '#FAF9F5',
        display: 'standalone',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // No runtimeCaching routes: Canvas API responses must never be cached
      // or served offline (see CLAUDE.md — attendance/grade state is always
      // re-derived live from Canvas). The default precache below only covers
      // this app's own build output (JS/CSS/HTML/icons), so cross-origin
      // Canvas requests pass through the service worker untouched.
      workbox: {
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5175,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        root:            resolve(__dirname, 'index.html'),
        home:            resolve(__dirname, 'src/shell/index.html'),
        onboarding:      resolve(__dirname, 'src/pages/onboarding/index.html'),
        settings:        resolve(__dirname, 'src/settings/index.html'),
        labs:            resolve(__dirname, 'src/pages/labs/index.html'),
      },
    },
  },
}))
