import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
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
      // re-derived live from Canvas). The precache manifest below only
      // covers this app's own build output (JS/CSS/HTML/icons) — it can't
      // and doesn't include /api/canvas/* (a serverless function, not a
      // static asset), so those requests pass through the service worker
      // untouched, same as the direct-to-Canvas fetches this proxy replaced.
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
})
