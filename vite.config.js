import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
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
