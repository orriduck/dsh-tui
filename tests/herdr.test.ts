import { describe, expect, it } from 'vitest'
import { HerdrBridge, type HerdrSnapshot } from '../src/herdr.js'

function snapshot(overrides: Partial<HerdrSnapshot> = {}): HerdrSnapshot {
  return {
    status: 'starting',
    interaction: undefined,
    sessionId: undefined,
    title: 'New session',
    ...overrides,
  }
}

function commandWithoutSequence(command: string[]): string[] {
  const sequenceIndex = command.indexOf('--seq')
  return sequenceIndex === -1
    ? command
    : command.filter((_, index) => index !== sequenceIndex && index !== sequenceIndex + 1)
}

describe('Herdr bridge', () => {
  it('does nothing outside a Herdr-managed pane', async () => {
    const commands: string[][] = []
    const bridge = new HerdrBridge({}, async args => { commands.push(args) })

    await bridge.sync(snapshot())
    await bridge.dispose()

    expect(bridge.enabled).toBe(false)
    expect(commands).toEqual([])
  })

  it('reports lifecycle, session identity, and display metadata', async () => {
    const commands: string[][] = []
    const bridge = new HerdrBridge({
      HERDR_ENV: '1',
      HERDR_PANE_ID: 'w3:p6',
      HERDR_SOCKET_PATH: '/tmp/herdr.sock',
    }, async args => { commands.push(commandWithoutSequence(args)) })

    await bridge.sync(snapshot())
    await bridge.sync(snapshot({
      status: 'idle',
      sessionId: 'session-123',
      title: 'Fix search flow',
    }))

    expect(bridge.enabled).toBe(true)
    expect(commands).toContainEqual([
      'pane', 'report-agent', 'w3:p6',
      '--source', 'dsh-tui', '--agent', 'deepseek', '--state', 'working',
    ])
    expect(commands).toContainEqual([
      'pane', 'report-agent-session', 'w3:p6',
      '--source', 'dsh-tui', '--agent', 'deepseek',
      '--agent-session-id', 'session-123',
    ])
    expect(commands).toContainEqual([
      'pane', 'report-metadata', 'w3:p6',
      '--source', 'dsh-tui', '--agent', 'deepseek',
      '--display-agent', 'DeepSeek', '--title', 'Fix search flow',
    ])
    expect(commands).toContainEqual([
      'pane', 'report-agent', 'w3:p6',
      '--source', 'dsh-tui', '--agent', 'deepseek', '--state', 'idle',
    ])
  })

  it('waits for a session identity before publishing placeholder metadata', async () => {
    const commands: string[][] = []
    const bridge = new HerdrBridge({
      HERDR_ENV: '1',
      HERDR_PANE_ID: 'w3:p6',
      HERDR_SOCKET_PATH: '/tmp/herdr.sock',
    }, async args => { commands.push(commandWithoutSequence(args)) })

    await bridge.sync(snapshot())

    expect(commands.some(command => command.includes('report-metadata'))).toBe(false)
  })

  it('maps approvals and questions to blocked and suppresses duplicates', async () => {
    const commands: string[][] = []
    const bridge = new HerdrBridge({
      HERDR_ENV: '1',
      HERDR_PANE_ID: 'w3:p6',
      HERDR_SOCKET_PATH: '/tmp/herdr.sock',
    }, async args => { commands.push(commandWithoutSequence(args)) })
    const running = snapshot({ status: 'running' })

    await bridge.sync(running)
    await bridge.sync(running)
    await bridge.sync(snapshot({ status: 'running', interaction: { kind: 'approval' } }))
    await bridge.sync(snapshot({ status: 'running', interaction: { kind: 'question' } }))
    await bridge.sync(running)

    expect(commands.filter(command => command.includes('report-agent'))).toEqual([
      ['pane', 'report-agent', 'w3:p6', '--source', 'dsh-tui', '--agent', 'deepseek', '--state', 'working'],
      ['pane', 'report-agent', 'w3:p6', '--source', 'dsh-tui', '--agent', 'deepseek', '--state', 'blocked'],
      ['pane', 'report-agent', 'w3:p6', '--source', 'dsh-tui', '--agent', 'deepseek', '--state', 'working'],
    ])
  })

  it('releases source ownership once on disposal', async () => {
    const commands: string[][] = []
    const bridge = new HerdrBridge({
      HERDR_ENV: '1',
      HERDR_PANE_ID: 'w3:p6',
      HERDR_SOCKET_PATH: '/tmp/herdr.sock',
    }, async args => { commands.push(commandWithoutSequence(args)) })

    await bridge.sync(snapshot({ status: 'idle' }))
    await bridge.dispose()
    await bridge.dispose()

    expect(commands.at(-1)).toEqual([
      'pane', 'release-agent', 'w3:p6', '--source', 'dsh-tui', '--agent', 'deepseek',
    ])
    expect(commands.filter(command => command.includes('release-agent'))).toHaveLength(1)
  })
})
