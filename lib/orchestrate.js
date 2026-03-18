#!/usr/bin/env node
const { spawn } = require('child_process')
const path = require('path')

// --- Configuration ---
const isLegacy = process.argv.includes('--legacy')
const DOCKER_DIR = path.resolve(__dirname, '../../flamingo-docker')
const UI_MODE = isLegacy ? 'start-legacy' : 'start'
const uiLabel = isLegacy ? 'Legacy UI' : 'New UI'

console.log('=== 🦩 Flamingo Dev Environment (Docker) ===')
console.log(`   Frontend: ${uiLabel}`)
console.log(`   Running: docker compose up --build`)
console.log('')

// Spawn docker compose with UI_MODE env var
const child = spawn('docker', ['compose', 'up', '--build'], {
    cwd: DOCKER_DIR,
    stdio: 'inherit',
    env: { ...process.env, UI_MODE }
})

child.on('exit', (code) => {
    process.exit(code || 0)
})

// Graceful shutdown
function shutdown(signal) {
    console.log(`\n${signal} received. Stopping containers...`)
    const down = spawn('docker', ['compose', 'down'], {
        cwd: DOCKER_DIR,
        stdio: 'inherit'
    })
    down.on('exit', () => process.exit(0))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
