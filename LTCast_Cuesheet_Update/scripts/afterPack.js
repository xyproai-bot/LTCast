const { execSync } = require('child_process')
const path = require('path')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'mac') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productName}.app`)
  const script = path.join(__dirname, 'sign-mac.sh')
  console.log('[afterPack] signing:', appPath)
  try {
    execSync(`bash "${script}" "${appPath}"`, { stdio: 'inherit' })
  } catch (e) {
    console.warn('[afterPack] Ad-hoc codesign failed (non-fatal):', e.message)
  }
}
