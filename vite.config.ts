import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// GitHub Pages serves the app from /<repo-name>/.
const base = process.env.BASE_PATH ?? '/food-body-and-activity/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'app-icon.svg', 'icons.svg', 'illustrations/*.svg'],
      manifest: {
        name: 'Тіло · Body',
        short_name: 'Тіло',
        description: 'Раціон, кроки, заміри · Ration, steps, measurements',
        lang: 'uk',
        start_url: base + '#/today',
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F5EFE5',
        theme_color: '#F5EFE5',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Never cache GitHub API responses: the data repo is the source of truth.
        navigateFallback: 'index.html',
      },
    }),
  ],
});
