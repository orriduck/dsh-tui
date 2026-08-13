import { spawnSync } from 'node:child_process'

const DSH_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest'
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

interface ParsedVersion {
  core: [number, number, number]
  prerelease: string[]
}

export interface RegistryResponse {
  ok: boolean
  json: () => Promise<unknown>
}

export type RegistryFetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<RegistryResponse>

function parseVersion(value: string): ParsedVersion | undefined {
  const match = SEMVER.exec(value.trim())
  if (match === null) return undefined
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  }
}

function compareIdentifier(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined
  if (leftNumber !== undefined && rightNumber !== undefined) return Math.sign(leftNumber - rightNumber)
  if (leftNumber !== undefined) return -1
  if (rightNumber !== undefined) return 1
  return left.localeCompare(right)
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const installed = parseVersion(current)
  if (next === undefined || installed === undefined) return false
  for (let index = 0; index < next.core.length; index += 1) {
    const difference = (next.core[index] ?? 0) - (installed.core[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  if (next.prerelease.length === 0) return installed.prerelease.length > 0
  if (installed.prerelease.length === 0) return false
  const length = Math.max(next.prerelease.length, installed.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const left = next.prerelease[index]
    const right = installed.prerelease[index]
    if (left === undefined) return false
    if (right === undefined) return true
    const comparison = compareIdentifier(left, right)
    if (comparison !== 0) return comparison > 0
  }
  return false
}

export function parseDshVersion(output: string): string | undefined {
  const version = output.trim().split(/\s+/).at(-1)
  return version !== undefined && parseVersion(version) !== undefined ? version.replace(/^v/, '') : undefined
}

export function detectDshVersion(): string | undefined {
  const result = spawnSync('dsh', ['--version'], {
    encoding: 'utf8',
    timeout: 750,
    env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 && typeof result.stdout === 'string'
    ? parseDshVersion(result.stdout)
    : undefined
}

export async function latestDshVersion(
  fetcher: RegistryFetch = globalThis.fetch as RegistryFetch,
  timeoutMs = 1_500,
): Promise<string | undefined> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const response = await fetcher(DSH_REGISTRY_URL, {
      signal: abort.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return undefined
    const document = await response.json()
    if (document === null || typeof document !== 'object') return undefined
    const version = (document as Record<string, unknown>).version
    return typeof version === 'string' && parseVersion(version) !== undefined ? version : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

export function dshUpgradeCommand(version: string): string {
  return `npm install -g @deepseek-ai/dsh@${version}`
}
