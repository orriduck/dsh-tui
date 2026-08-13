import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  colorFgBgTheme,
  loadThemePreference,
  parseOsc11Theme,
  themeConfigPath,
} from '../src/theme.js'

function temporaryDshHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-tui-theme-'))
}

describe('theme configuration', () => {
  it('creates a private system-theme config on first launch', () => {
    const dshHome = temporaryDshHome()
    const env = { DSH_HOME: dshHome }

    expect(loadThemePreference(env)).toEqual({
      preference: 'system',
      configPath: join(dshHome, 'tui.json'),
      explicitEnvironment: false,
    })
    expect(readFileSync(themeConfigPath(env), 'utf8')).toBe('{\n  "theme": "system"\n}\n')
    expect(statSync(themeConfigPath(env)).mode & 0o777).toBe(0o600)
  })

  it('accepts explicit config and environment overrides', () => {
    const dshHome = temporaryDshHome()
    writeFileSync(join(dshHome, 'tui.json'), '{"theme":"light"}\n')

    expect(loadThemePreference({ DSH_HOME: dshHome }).preference).toBe('light')
    expect(loadThemePreference({ DSH_HOME: dshHome, DSH_TUI_THEME: 'dark' })).toMatchObject({
      preference: 'dark',
      explicitEnvironment: true,
    })
  })

  it('reports invalid theme values instead of silently guessing', () => {
    const dshHome = temporaryDshHome()
    writeFileSync(join(dshHome, 'tui.json'), '{"theme":"sepia"}\n')

    expect(() => loadThemePreference({ DSH_HOME: dshHome })).toThrow('must be one of')
  })
})

describe('automatic theme detection', () => {
  it('classifies common OSC 11 terminal background responses', () => {
    expect(parseOsc11Theme('\u001B]11;rgb:0000/0000/0000\u0007')).toBe('dark')
    expect(parseOsc11Theme('\u001B]11;rgb:ffff/ffff/ffff\u001B\\')).toBe('light')
    expect(parseOsc11Theme('\u001B]11;#f5f5f5\u0007')).toBe('light')
    expect(parseOsc11Theme('not-a-color')).toBeUndefined()
  })

  it('uses the COLORFGBG background index when OSC is unavailable', () => {
    expect(colorFgBgTheme('15;0')).toBe('dark')
    expect(colorFgBgTheme('0;15')).toBe('light')
    expect(colorFgBgTheme(undefined)).toBeUndefined()
  })
})
