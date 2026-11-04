import { defineConfig } from 'vite'

// root is /web (passed on the CLI); shared/ lives one level up, so allow it.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
})
