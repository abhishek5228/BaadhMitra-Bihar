import { defineConfig } from 'vitest/config'

// Coverage is a gate in CI (`npm run coverage`): a change that leaves logic untested fails the build.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['shared/**', 'backend/**'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 85 },
    },
  },
})
