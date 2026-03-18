const { exec } = require('child_process')
const os = require('os')

function execPromise (cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve(stdout.trim())
    })
  })
}

async function isDockerInstalled () {
  try {
    const version = await execPromise('docker --version')
    console.log('✅ Docker already installed:', version)
    return true
  } catch {
    return false
  }
}

async function installDockerLinux () {
  console.log('📦 Installing Docker via get.docker.com ...')
  await execPromise('curl -fsSL https://get.docker.com | sh', { timeout: 120000 })
  console.log('✅ Docker installed on Linux.')
}

async function installDockerMac () {
  console.log('📦 Installing Docker via get.docker.com ...')
  console.log('   (On macOS you may also install Docker Desktop from https://docker.com/products/docker-desktop)')
  try {
    await execPromise('curl -fsSL https://get.docker.com | sh', { timeout: 120000 })
    console.log('✅ Docker installed on macOS.')
  } catch {
    console.error('⚠️  Automatic install failed on macOS.')
    console.error('   Please install Docker Desktop manually:')
    console.error('   https://docs.docker.com/desktop/install/mac-install/')
    process.exit(1)
  }
}

async function installDockerWindows () {
  console.log('📦 Installing Docker on Windows ...')

  // Step 1: Ensure winget is available
  try {
    await execPromise('winget --version')
    console.log('   winget is available.')
  } catch {
    console.log('   Installing winget ...')
    await execPromise(
      'powershell -Command "irm https://github.com/asheroto/winget-install/releases/latest/download/winget-install.ps1 | iex"',
      { timeout: 120000 }
    )
  }

  // Step 2: Install WSL
  console.log('   Installing WSL ...')
  try {
    await execPromise('wsl --install', { timeout: 120000 })
  } catch {
    console.log('   WSL may already be installed or requires a restart.')
  }

  // Step 3: Install Docker Desktop via winget
  console.log('   Installing Docker Desktop via winget ...')
  await execPromise(
    'winget install --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements',
    { timeout: 300000 }
  )

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
      console.error(`❌ Unsupported platform: ${platform}`)
      console.error('   Please install Docker manually: https://docs.docker.com/get-docker/')
      process.exit(1)
  }

  // Verify installation
  try {
    const version = await execPromise('docker --version')
    console.log('✅ Verified Docker installation:', version)
    return true
  } catch {
    console.error('❌ Docker installation could not be verified.')
    console.error('   You may need to restart your terminal or computer.')
    return false
  }
}

module.exports = { installDocker, isDockerInstalled }
