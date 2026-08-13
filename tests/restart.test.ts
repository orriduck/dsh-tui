import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const moduleUrl = new URL('../src/restart.js', import.meta.url)

describe('launcher restart protocol', () => {
  it('accepts only typed new/resume IPC messages and derives the next argv', async () => {
    expect(existsSync(fileURLToPath(new URL('../src/restart.ts', import.meta.url)))).toBe(true)
    const { parseRestartMessage, restartArgs } = await import(moduleUrl.href)

    expect(parseRestartMessage({ type: 'dsh-tui/restart', request: { kind: 'new' } }))
      .toEqual({ kind: 'new' })
    expect(parseRestartMessage({ type: 'dsh-tui/restart', request: { kind: 'resume', id: 'session-123' } }))
      .toEqual({ kind: 'resume', id: 'session-123' })
    expect(parseRestartMessage({ type: 'other', request: { kind: 'new' } })).toBeUndefined()
    expect(parseRestartMessage({ type: 'dsh-tui/restart', request: { kind: 'resume', id: '' } })).toBeUndefined()
    expect(restartArgs({ kind: 'new' })).toEqual([])
    expect(restartArgs({ kind: 'resume', id: 'session-123' })).toEqual(['--resume', 'session-123'])
  })
})
