import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// root is /web (passed on the CLI); shared/ lives one level up, so allow it.
// Two pages: the staff 3D dashboard (index.html) and the public citizen report page (report.html).
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), report: resolve(__dirname, 'report.html'), field: resolve(__dirname, 'field.html') } },
  },
})
