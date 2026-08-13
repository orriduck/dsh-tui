import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export type ThemeSource = 'env' | 'config' | 'terminal' | 'system' | 'fallback'

interface ThemeResolution {
  resolved: ResolvedTheme
  source: ThemeSource
}

export interface ThemePalette {
  brand: string
  user: string
  success: string
  error: string
  warning: string
  muted: string
  border: string
  composerBackground: string
}

export const themePalettes: Record<ResolvedTheme, ThemePalette> = {
  dark: {
    brand: 'magentaBright',
    user: 'cyanBright',
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    muted: 'gray',
    border: 'gray',
    composerBackground: '#2c2c2c',
  },
  light: {
    brand: 'magenta',
    user: 'cyan',
    success: 'green',
    error: 'red',
    warning: 'yellow',
    muted: 'gray',
    border: 'gray',
    composerBackground: '#e7e7e7',
  },
}

function parsePreference(value: unknown, label: string): ThemePreference {
  if (value === 'system' || value === 'light' || value === 'dark') return value
  throw new Error(`${label} must be one of "system", "light", or "dark"`)
}

export function themeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const dshHome = env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'tui.json')
}

export function loadThemePreference(env: NodeJS.ProcessEnv = process.env): {
  preference: ThemePreference
  configPath: string
  explicitEnvironment: boolean
} {
  const configPath = themeConfigPath(env)
  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 })
    try {
      writeFileSync(configPath, '{\n  "theme": "system"\n}\n', { flag: 'wx', mode: 0o600 })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
    }
  }

  const environment = env.DSH_TUI_THEME
  if (environment !== undefined) {
    return {
      preference: parsePreference(environment, 'DSH_TUI_THEME'),
      configPath,
      explicitEnvironment: true,
    }
  }

  let document: unknown
  try {
    document = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read theme config ${configPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`theme config ${configPath} must contain a JSON object`)
  }
  const configured = parsePreference((document as Record<string, unknown>).theme ?? 'system', `${configPath}: theme`)
  return { preference: configured, configPath, explicitEnvironment: false }
}

function normalizedChannel(hex: string): number | undefined {
  const parsed = Number.parseInt(hex, 16)
  const maximum = (16 ** hex.length) - 1
  if (!Number.isFinite(parsed) || maximum <= 0) return undefined
  return parsed / maximum
}

function relativeLuminance(red: number, green: number, blue: number): number {
  const linear = (channel: number): number => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

export function parseOsc11Theme(response: string): ResolvedTheme | undefined {
  const rgb = /(?:\u001B\]11;)?rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(response)
  let channels: [number, number, number] | undefined
  if (rgb !== null) {
    const red = normalizedChannel(rgb[1]!)
    const green = normalizedChannel(rgb[2]!)
    const blue = normalizedChannel(rgb[3]!)
    if (red !== undefined && green !== undefined && blue !== undefined) channels = [red, green, blue]
  } else {
    const hex = /(?:\u001B\]11;)?#([0-9a-f]{6})/i.exec(response)?.[1]
    if (hex !== undefined) {
      channels = [
        Number.parseInt(hex.slice(0, 2), 16) / 255,
        Number.parseInt(hex.slice(2, 4), 16) / 255,
        Number.parseInt(hex.slice(4, 6), 16) / 255,
      ]
    }
  }
  if (channels === undefined) return undefined
  return relativeLuminance(...channels) >= 0.4 ? 'light' : 'dark'
}

async function probeTerminalTheme(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
  timeoutMs = 100,
): Promise<ResolvedTheme | undefined> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') return undefined
  return new Promise((resolve) => {
    const wasRaw = input.isRaw === true
    const wasPaused = input.isPaused()
    let buffer = ''
    let settled = false
    let timer: NodeJS.Timeout

    const finish = (theme: ResolvedTheme | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      input.off('data', onData)
      if (!wasRaw) input.setRawMode(false)
      if (wasPaused) input.pause()
      resolve(theme)
    }
    const onData = (chunk: string | Buffer): void => {
      buffer += chunk.toString()
      const theme = parseOsc11Theme(buffer)
      if (theme !== undefined) finish(theme)
    }

    input.setRawMode(true)
    input.on('data', onData)
    input.resume()
    timer = setTimeout(() => finish(undefined), timeoutMs)
    output.write('\u001B]11;?\u001B\\')
  })
}

export function colorFgBgTheme(value: string | undefined): ResolvedTheme | undefined {
  const background = Number.parseInt(value?.split(';').at(-1) ?? '', 10)
  if (!Number.isSafeInteger(background) || background < 0 || background > 15) return undefined
  return background === 0 || (background >= 1 && background <= 6) || background === 8 ? 'dark' : 'light'
}

function macOSSystemTheme(): ResolvedTheme | undefined {
  if (process.platform !== 'darwin') return undefined
  const result = spawnSync('/usr/bin/defaults', ['read', '-g', 'AppleInterfaceStyle'], {
    encoding: 'utf8',
    timeout: 250,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.error !== undefined) return undefined
  return result.status === 0 && result.stdout.trim().toLocaleLowerCase() === 'dark' ? 'dark' : 'light'
}

export async function resolveTheme(env: NodeJS.ProcessEnv = process.env): Promise<ThemeResolution> {
  const loaded = loadThemePreference(env)
  if (loaded.preference !== 'system') {
    return {
      resolved: loaded.preference,
      source: loaded.explicitEnvironment ? 'env' : 'config',
    }
  }
  const terminal = await probeTerminalTheme()
  if (terminal !== undefined) {
    return { resolved: terminal, source: 'terminal' }
  }
  const colorEnvironment = colorFgBgTheme(env.COLORFGBG)
  if (colorEnvironment !== undefined) {
    return { resolved: colorEnvironment, source: 'terminal' }
  }
  const system = macOSSystemTheme()
  return {
    resolved: system ?? 'dark',
    source: system === undefined ? 'fallback' : 'system',
  }
}
