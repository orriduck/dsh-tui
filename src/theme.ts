import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export type ThemeSource = 'env' | 'config' | 'terminal' | 'system' | 'fallback'

export interface ThemeResolution {
  resolved: ResolvedTheme
  source: ThemeSource
  composerBackground: string
}

export type Rgb = readonly [red: number, green: number, blue: number]

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

function rgbChannel(hex: string): number | undefined {
  const parsed = Number.parseInt(hex, 16)
  const maximum = (16 ** hex.length) - 1
  if (!Number.isFinite(parsed) || maximum <= 0) return undefined
  return Math.round((parsed / maximum) * 255)
}

function isLightBackground([red, green, blue]: Rgb): boolean {
  return (0.299 * red) + (0.587 * green) + (0.114 * blue) > 128
}

export function parseOsc11Background(response: string): Rgb | undefined {
  const rgb = /(?:\u001B\]11;)?rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(response)
  if (rgb !== null) {
    const red = rgbChannel(rgb[1]!)
    const green = rgbChannel(rgb[2]!)
    const blue = rgbChannel(rgb[3]!)
    if (red !== undefined && green !== undefined && blue !== undefined) return [red, green, blue]
  }
  const hex = /(?:\u001B\]11;)?#([0-9a-f]{6})/i.exec(response)?.[1]
  if (hex === undefined) return undefined
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ]
}

export function parseOsc11Theme(response: string): ResolvedTheme | undefined {
  const background = parseOsc11Background(response)
  if (background === undefined) return undefined
  return isLightBackground(background) ? 'light' : 'dark'
}

/** Match Codex's terminal-relative composer tint without relying on unsupported ANSI alpha. */
export function composerBackgroundFor(background: Rgb): string {
  const light = isLightBackground(background)
  const foreground: Rgb = light ? [0, 0, 0] : [255, 255, 255]
  const alpha = light ? 0.04 : 0.12
  const blended = background.map((channel, index) => Math.trunc(
    (foreground[index]! * alpha) + (channel * (1 - alpha)),
  ))
  return `#${blended.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

async function probeTerminalBackground(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
  timeoutMs = 100,
): Promise<Rgb | undefined> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') return undefined
  return new Promise((resolve) => {
    const wasRaw = input.isRaw === true
    const wasPaused = input.isPaused()
    let buffer = ''
    let settled = false
    let timer: NodeJS.Timeout

    const finish = (background: Rgb | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      input.off('data', onData)
      if (!wasRaw) input.setRawMode(false)
      if (wasPaused) input.pause()
      resolve(background)
    }
    const onData = (chunk: string | Buffer): void => {
      buffer += chunk.toString()
      if (!buffer.includes('\u0007') && !buffer.includes('\u001B\\')) return
      const background = parseOsc11Background(buffer)
      if (background !== undefined) finish(background)
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
      composerBackground: themePalettes[loaded.preference].composerBackground,
    }
  }
  const terminalBackground = await probeTerminalBackground()
  if (terminalBackground !== undefined) {
    return {
      resolved: isLightBackground(terminalBackground) ? 'light' : 'dark',
      source: 'terminal',
      composerBackground: composerBackgroundFor(terminalBackground),
    }
  }
  const colorEnvironment = colorFgBgTheme(env.COLORFGBG)
  if (colorEnvironment !== undefined) {
    return {
      resolved: colorEnvironment,
      source: 'terminal',
      composerBackground: themePalettes[colorEnvironment].composerBackground,
    }
  }
  const system = macOSSystemTheme()
  const resolved = system ?? 'dark'
  return {
    resolved,
    source: system === undefined ? 'fallback' : 'system',
    composerBackground: themePalettes[resolved].composerBackground,
  }
}
