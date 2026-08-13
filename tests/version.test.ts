import { describe, expect, it, vi } from 'vitest'
import {
  dshUpgradeCommand,
  isVersionNewer,
  latestDshVersion,
  parseDshVersion,
  type RegistryFetch,
} from '../src/version.js'

describe('DSH version information', () => {
  it('parses the CLI version without accepting unrelated output', () => {
    expect(parseDshVersion('0.1.0-rc.6\n')).toBe('0.1.0-rc.6')
    expect(parseDshVersion('dsh v0.2.0\n')).toBe('0.2.0')
    expect(parseDshVersion('not a version')).toBeUndefined()
  })

  it('compares stable and prerelease semver correctly', () => {
    expect(isVersionNewer('0.1.0-rc.7', '0.1.0-rc.6')).toBe(true)
    expect(isVersionNewer('0.1.0', '0.1.0-rc.7')).toBe(true)
    expect(isVersionNewer('0.2.0', '0.1.9')).toBe(true)
    expect(isVersionNewer('0.1.0-rc.6', '0.1.0-rc.6')).toBe(false)
    expect(isVersionNewer('0.1.0-rc.5', '0.1.0-rc.6')).toBe(false)
  })

  it('reads the official registry response and builds an exact update command', async () => {
    const fetcher = vi.fn<RegistryFetch>().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.1.0-rc.7' }),
    })

    await expect(latestDshVersion(fetcher)).resolves.toBe('0.1.0-rc.7')
    expect(fetcher).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(dshUpgradeCommand('0.1.0-rc.7'))
      .toBe('npm install -g @deepseek-ai/dsh@0.1.0-rc.7')
  })

  it('silently degrades when the registry is unavailable', async () => {
    const fetcher = vi.fn<RegistryFetch>().mockRejectedValue(new Error('offline'))
    await expect(latestDshVersion(fetcher)).resolves.toBeUndefined()
  })
})
