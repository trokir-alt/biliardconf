import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** where the /api functions are served while developing; see scripts/api-server.mjs */
const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:4181'
const proxy = { '/api': { target: API_TARGET, changeOrigin: false } }

export default defineConfig({
  plugins: [
    react(),
    /**
     * Offline. A coach in a hall has whatever wifi the hall has, and the app
     * has to open regardless: the shell, the fonts and the brand assets are
     * precached, and the exercises come from IndexedDB.
     *
     * Nothing under /api is cached or faked. A stale answer from a service
     * worker would look exactly like a successful sync and would be the one
     * failure the coach could not see - so the API is left to the network and
     * the sync engine's own "no connection" state handles the rest.
     */
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['brand/icon.svg', 'brand/icon-180.png', 'fonts/*.woff2'],
      manifest: {
        name: 'Упражнения · Алексей Соць',
        short_name: 'Упражнения',
        description: 'Конструктор упражнений по русскому бильярду на 12-футовом столе.',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#16191d',
        theme_color: '#173447',
        icons: [
          { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/brand/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/brand/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        navigateFallback: '/index.html',
        // a navigation to /api/... must reach the function, not the app shell
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        // the bundle is one chunk and larger than the 2 MB default
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { proxy },
  preview: { proxy },
})
