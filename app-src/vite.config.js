import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Relative base + a fixed outDir one level up means `npm run build` in
  // this folder drops its output straight into ../app — i.e. right next
  // to the marketing index.html, so the "Try it in your browser" link
  // (./app/) on that page resolves to it.
  base: './',
  build: {
    outDir: '../app',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['src/utils/__tests__/**/*.test.js'],
  },
})
