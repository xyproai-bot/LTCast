/**
 * Vitest configuration — minimal setup so .tsx tests can run.
 *
 * Background: this project ships @vitejs/plugin-react via
 * electron.vite.config.ts, but vitest 4.x reads its own root config
 * (not electron-vite's) and tsconfig.json uses `"jsx": "preserve"`,
 * so without this file tsx files arrive at rolldown unchanged and
 * fail to parse.
 *
 * We deliberately keep this tiny: just enough of an oxc transform so
 * rolldown emits automatic JSX runtime calls. Existing .ts tests are
 * unaffected (they already declare their own environment or run on
 * node defaults; this config only adds a JSX transform target).
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
})
