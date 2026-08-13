import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  colorFgBgTheme,
  composerBackgroundFor,
  loadThemePreference,
  parseOsc11Background,
  parseOsc11Theme,
  themePalettes,
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

  it('lets a valid one-off environment override bypass an invalid config', () => {
    const dshHome = temporaryDshHome()
    writeFileSync(join(dshHome, 'tui.json'), '{"theme":"sepia"}\n')

    expect(loadThemePreference({ DSH_HOME: dshHome, DSH_TUI_THEME: 'dark' })).toMatchObject({
      preference: 'dark',
      explicitEnvironment: true,
    })
  })
})

describe('automatic theme detection', () => {
  it('uses distinct neutral composer surfaces for light and dark terminals', () => {
    expect(themePalettes.light.composerBackground).toBe('#e7e7e7')
    expect(themePalettes.dark.composerBackground).toBe('#2c2c2c')
  })

  it('preserves the OSC 11 RGB value and derives the same opaque tint as Codex', () => {
    expect(parseOsc11Background('\u001B]11;rgb:f5f5/f5f5/f5f5\u0007')).toEqual([245, 245, 245])
    expect(parseOsc11Background('\u001B]11;#123456\u001B\\')).toEqual([18, 52, 86])
    expect(composerBackgroundFor([255, 255, 255])).toBe('#f4f4f4')
    expect(composerBackgroundFor([0, 0, 0])).toBe('#1e1e1e')
    expect(composerBackgroundFor([18, 52, 86])).toBe('#2e4c6a')
  })

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
