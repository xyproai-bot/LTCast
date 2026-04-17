/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.ltcast.app',
  publish: {
    provider: 'github',
    owner: 'xyproai-bot',
    repo: 'LTCast'
  },
  productName: 'LTCast',
  copyright: 'Copyright © 2024 LTCast',
  icon: 'resources/icon',
  // Bypass electron-builder's own rebuild — v0.4.1 CI hit a hardlink EEXIST
  // during the x64 packaging phase; disabling the rebuild and forcing
  // USE_HARD_LINKS=false in CI avoids it.
  nodeGypRebuild: false,
  directories: {
    buildResources: 'resources',
    output: 'dist'
  },
  fileAssociations: [
    {
      ext: 'ltcast',
      name: 'LTCast Project',
      description: 'LTCast Project File',
      icon: 'resources/icon',
      role: 'Editor',
      mimeType: 'application/x-ltcast'
    }
  ],
  files: [
    'out/**/*',
    'resources/**/*',
    '!resources/installers/**/*'
  ],
  asarUnpack: [
    'node_modules/ffmpeg-static/**'
  ],
  mac: {
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] }
    ],
    icon: 'resources/icon.icns',
    // Ad-hoc signed via afterPack hook — avoids "damaged" error on macOS 15.
    // No Apple Developer cert, so hardenedRuntime + Gatekeeper assess must be off.
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false
  },
  dmg: {
    title: 'LTCast',
    window: {
      width: 540,
      height: 380
    },
    iconSize: 100,
    contents: [
      { x: 130, y: 190, type: 'file' },
      { x: 410, y: 190, type: 'link', path: '/Applications' }
    ]
  },
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] }
    ],
    artifactName: '${productName}-Setup-${version}.${ext}'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    license: 'resources/LICENSE.txt',
    runAfterFinish: true
  },
  linux: {
    target: ['AppImage'],
    icon: 'resources/icon.png'
  }
}
