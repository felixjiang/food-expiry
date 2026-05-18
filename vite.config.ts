import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'maskable-icon-512x512.png',
      ],
      manifest: {
        name: '食品保质期检测',
        short_name: '保质期检测',
        description: '拍照提取生产日期和保质期，确认后判断食品是否过期。',
        theme_color: '#2563eb',
        background_color: '#f3f4f6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        cleanupOutdatedCaches: true,
        // Do not serve index.html for verification files or server-side function routes.
        navigateFallbackDenylist: [/\.txt$/, /^\/functions\//],
      },
      devOptions: {
        // Keep PWA disabled in dev to avoid stale service-worker cache on localhost.
        enabled: false,
      },
    }),
  ],
})
