import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRestartMessage, restartArgs, type RestartRequest } from './restart.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileManifest = join(dshHome, 'profiles', 'tui', 'package.json')
const installedManifest = join(dshHome, 'profiles', 'tui', 'node_modules', 'dsh-tui', 'package.json')
const packageVersion = (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version

function profileHasTui(): boolean {
  if (!existsSync(profileManifest)) return false
  try {
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    const installed = JSON.parse(readFileSync(installedManifest, 'utf8')) as { version?: string }
    return manifest.dependencies?.['dsh-tui'] !== undefined
      && manifest.dsh?.profile?.bundles?.includes('dsh-tui') === true
      && installed.version === packageVersion
  } catch {
    return false
  }
}

if (!profileHasTui()) {
  process.stderr.write('dsh-tui: setting up the local DSH tui profile...\n')
  const install = spawnSync(
    'dsh',
    ['plugin', '--profile', 'tui', 'add', `file:${packageRoot}`],
    { stdio: 'inherit' },
  )
  if (install.error !== undefined) {
    process.stderr.write(`dsh-tui: could not run dsh: ${install.error.message}\n`)
    process.exit(127)
  }
  if (install.status !== 0) process.exit(install.status ?? 1)
}

function launch(args: string[]): void {
  let restart: RestartRequest | undefined
  const child = spawn('dsh', ['--profile', 'tui', ...args], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: process.env,
  })

  child.on('message', (message) => {
    restart ??= parseRestartMessage(message)
  })
  child.on('error', (error) => {
    process.stderr.write(`dsh-tui: could not run dsh: ${error.message}\n`)
    process.exitCode = 127
  })
  child.on('exit', (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal)
      return
    }
    if (restart !== undefined && code === 0) {
      process.stdout.write('\u001B[2J\u001B[H')
      launch(restartArgs(restart))
      return
    }
    process.exitCode = code ?? 1
  })
}

launch(process.argv.slice(2))
