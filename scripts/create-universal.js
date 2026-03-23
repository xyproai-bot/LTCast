#!/usr/bin/env node
'use strict'
const { makeUniversalApp } = require('@electron/universal')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')
const x64AppPath     = path.join(root, 'dist', 'mac', 'LTCast.app')
const arm64AppPath   = path.join(root, 'dist', 'mac-arm64', 'LTCast.app')
const outDir         = path.join(root, 'dist', 'mac-universal')
const outAppPath     = path.join(outDir, 'LTCast.app')

if (!fs.existsSync(x64AppPath))   { console.error('Missing x64 app:', x64AppPath);   process.exit(1) }
if (!fs.existsSync(arm64AppPath)) { console.error('Missing arm64 app:', arm64AppPath); process.exit(1) }

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

console.log('[universal] Merging x64 + arm64 → universal…')
makeUniversalApp({ x64AppPath, arm64AppPath, outAppPath })
  .then(() => console.log('[universal] Done:', outAppPath))
  .catch(err => { console.error('[universal] Failed:', err); process.exit(1) })
