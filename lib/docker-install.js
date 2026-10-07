const os = require('os')
const { capture } = require('./exec')

async function isDockerInstalled () {
  try {
    const version = await capture('docker', ['--version'])
    console.log('✅ Docker already installed:', version)
    return true
  } catch {
    return false
  }
}

async function installDockerLinux () {
  console.log('📦 Installing Docker via get.docker.com ...')
  await capture('sh', ['-c', 'curl -fsSL https://get.docker.com | sh'], { timeout: 120000 })
  console.log('✅ Docker installed on Linux.')
}

async function installDockerMac () {
  console.log('📦 Installing Docker via get.docker.com ...')
  console.log('   (On macOS you may also install Docker Desktop from https://docker.com/products/docker-desktop)')
  try {
    await capture('sh', ['-c', 'curl -fsSL https://get.docker.com | sh'], { timeout: 120000 })
    console.log('✅ Docker installed on macOS.')
  } catch {
    throw new Error('Automatic install failed on macOS. Please install Docker Desktop manually: https://docs.docker.com/desktop/install/mac-install/')
  }
}

async function installDockerWindows () {
  console.log('📦 Installing Docker on Windows ...')

  // Step 1: Ensure winget is available
  try {
    await capture('winget', ['--version'])
    console.log('   winget is available.')
  } catch {
    console.log('   Installing winget ...')
    await capture('powershell', [
      '-Command', 'irm https://github.com/asheroto/winget-install/releases/latest/download/winget-install.ps1 | iex'
    ], { timeout: 120000 })
  }

  // Step 2: Install WSL
  console.log('   Installing WSL ...')
  try {
    await capture('wsl', ['--install'], { timeout: 120000 })
  } catch {
    console.log('   WSL may already be installed or requires a restart.')
  }

  // Step 3: Install Docker Desktop via winget
  console.log('   Installing Docker Desktop via winget ...')
  await capture('winget', [
    'install', '--id', 'Docker.DockerDesktop', '--accept-package-agreements', '--accept-source-agreements'
  ], { timeout: 300000 })

  console.log('✅ Docker Desktop installed on Windows.')
  console.log('   ⚠️  You may need to restart your computer and launch Docker Desktop.')
}

async function installDocker () {
  const installed = await isDockerInstalled()
  if (installed) return true

  const platform = os.platform()
  console.log(`🖥️  Detected platform: ${platform}`)

  switch (platform) {
    case 'linux':
      await installDockerLinux()
      break
    case 'darwin':
      await installDockerMac()
      break
    case 'win32':
      await installDockerWindows()
      break
    default:
      throw new Error(`Unsupported platform: ${platform}. Please install Docker manually: https://docs.docker.com/get-docker/`)
  }

  // Verify installation
  try {
    const version = await capture('docker', ['--version'])
    console.log('✅ Verified Docker installation:', version)
    return true
  } catch {
    console.error('❌ Docker installation could not be verified.')
    console.error('   You may need to restart your terminal or computer.')
    return false
  }
}

module.exports = { installDocker, isDockerInstalled }
