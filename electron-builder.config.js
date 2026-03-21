/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.ltcast.app',
  publish: {
    provider: 'github',
    owner: 'xyproai-bot',
    repo: 'CueSync'
  },
  productName: 'LTCast',
  copyright: 'Copyright © 2024 LTCast',
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
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ],
    icon: 'icon.icns',
    // Ad-hoc signed via afterPack hook — avoids "damaged" error on macOS 15
    identity: null
  },
  dmg: {
    title: 'LTCast',
    contents: [
      { x: 130, y: 220, type: 'file' },
      { x: 410, y: 220, type: 'link', path: '/Applications' }
    ]
  },
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] }
    ],
    icon: 'resources/icon.png'
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
