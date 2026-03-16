import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    optimizeDeps: {
      // Exclude React JSX runtimes from pre-bundling so Vite handles them
      // correctly without the named-export detection issue in CJS modules.
      exclude: ['react/jsx-runtime', 'react/jsx-dev-runtime']
    },
    plugins: [react()],
    assetsInclude: ['**/ltcProcessor.js']
  }
})
