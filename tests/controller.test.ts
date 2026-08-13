import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TuiController, internals, permissionLabel } from '../src/controller.js'

function event(type: string, seq: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq, time: seq, data } as SessionEvent
}

function idleAgent(id = 'session-x', status: 'idle' | 'running' = 'idle'): Agent {
  return {
    id,
    status,
    options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    session: { events: [] },
    ctx: {} as never,
  } as unknown as Agent
}

function permissionEvents(seq: number, preset: string, sandbox: string, approval: string): SessionEvent[] {
  return [
    event('permission/preset', seq, { preset }),
    event('sandbox/mode', seq + 1, { mode: sandbox }),
    event('approval/policy', seq + 2, { policy: approval }),
  ]
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('terminal projection', () => {
  it('shows human prompts but hides model-facing plugin context', () => {
    const controller = new TuiController(async () => {})
    controller.ingest(event('user/message', 1, {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'hello' }],
    }))
    controller.ingest(event('user/message', 2, {
      role: 'user',
      source: { kind: 'plugin', plugin: 'context' },
      content: [{ type: 'text', text: 'hidden runtime context' }],
    }))

    expect(controller.snapshot().items).toEqual([
      { id: 'event-1', kind: 'user', text: 'hello' },
    ])
  })

  it('replaces streamed assistant text with the durable final message', () => {
    const controller = new TuiController(async () => {})
    controller.ingest(event('assistant/chunk', 1, {
      chunk: { type: 'text-delta', index: 0, text: 'hel' },
    }))
    controller.ingest(event('assistant/chunk', 2, {
      chunk: { type: 'text-delta', index: 0, text: 'lo' },
    }))
    expect(controller.snapshot().streamingText).toBe('hello')

    controller.ingest(event('assistant/message', 3, {
      message: { content: [{ type: 'text', text: 'hello' }] },
    }))

    expect(controller.snapshot().streamingText).toBe('')
    expect(controller.snapshot().items).toContainEqual({
      id: 'event-3',
      kind: 'assistant',
      text: 'hello',
    })
  })

  it('updates a tool row when its result arrives', () => {
    const controller = new TuiController(async () => {})
    controller.ingest(event('tool/call', 1, {
      callId: 'call-1',
      name: 'bash',
      arguments: '{"cmd":"pwd"}',
    }))
    expect(controller.snapshot().items).toEqual([])
    expect(controller.snapshot().activeTools).toEqual([{
      id: 'tool-call-1',
      kind: 'tool',
      name: 'bash',
      detail: '{"cmd":"pwd"}',
      status: 'running',
    }])

    controller.ingest(event('tool/result', 2, {
      message: {
        source: { kind: 'tool', callId: 'call-1' },
        content: [{
          type: 'tool-result',
          toolCallId: 'call-1',
          isError: false,
          content: [{ type: 'text', text: '/tmp/project' }],
        }],
      },
    }))

    expect(controller.snapshot().activeTools).toEqual([])
    expect(controller.snapshot().items).toContainEqual({
      id: 'tool-call-1',
      kind: 'tool',
      name: 'bash',
      detail: '/tmp/project',
      status: 'done',
    })
  })

  it('projects a long restored history with one subscriber notification', () => {
    const controller = new TuiController(async () => {})
    let notifications = 0
    controller.subscribe(() => { notifications += 1 })
    const events = Array.from({ length: 1_000 }, (_, index) => event('user/message', index, {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: `message ${index}` }],
    }))

    controller.loadHistory(events)

    expect(controller.snapshot().items).toHaveLength(1_000)
    expect(controller.snapshot().items.at(-1)).toEqual({
      id: 'event-999',
      kind: 'user',
      text: 'message 999',
    })
    expect(notifications).toBe(1)
  })
})

describe('input helpers', () => {
  it('extracts nested protocol text and bounds noisy tool output', () => {
    expect(internals.contentText({ content: [{ text: 'one' }, { content: [{ text: 'two' }] }] }))
      .toBe('one\ntwo')
    expect(internals.truncate('x'.repeat(400))).toHaveLength(220)
    expect(internals.messageText({ content: [
      { type: 'reasoning', text: 'hidden' },
      { type: 'text', text: 'visible' },
    ] })).toBe('visible')
  })

  it('routes terminal answers into approval and user-question seams', async () => {
    const controller = new TuiController(async () => {})
    const approval = controller.requestApproval({
      agent: {} as never,
      toolName: 'bash',
      reason: 'write outside the workspace',
    })
    expect(controller.snapshot().interaction?.kind).toBe('approval')
    controller.submit('y')
    await expect(approval).resolves.toBe('allowed-once')

    const question = controller.askQuestions({
      questions: [{
        id: 'choice',
        question: 'Pick one',
        options: [{ label: 'Alpha' }, { label: 'Beta' }],
      }],
    })
    controller.submit('2')
    await expect(question).resolves.toEqual({
      answers: [{ id: 'choice', selected: ['Beta'] }],
    })
  })
})

describe('permission display', () => {
  it('labels presets as human text, full access not by color alone', () => {
    expect(permissionLabel('read-only')).toBe('Read only')
    expect(permissionLabel('workspace-write')).toBe('Workspace write')
    expect(permissionLabel('danger-full-access')).toBe('FULL ACCESS')
    expect(permissionLabel('custom')).toBe('Custom')
  })

  it('folds fresh-session pin events into the displayed preset', () => {
    const controller = new TuiController(async () => {})
    for (const permissionEvent of permissionEvents(1, 'workspace-write', 'workspace-write', 'ask')) {
      controller.ingest(permissionEvent)
    }
    expect(controller.snapshot().permission).toEqual({
      preset: 'workspace-write',
      sandbox: 'workspace-write',
      approval: 'ask',
    })
    expect(controller.snapshot().permissionPreset).toBe('workspace-write')
  })

  it('derives custom when knobs exist but no preset event matches', () => {
    const controller = new TuiController(async () => {})
    controller.ingest(event('sandbox/mode', 1, { mode: 'read-only' }))
    controller.ingest(event('approval/policy', 2, { policy: 'ask' }))
    expect(controller.snapshot().permissionPreset).toBe('custom')
  })

  it('replays the last permission on resume via loadHistory', () => {
    const controller = new TuiController(async () => {})
    const history = [
      event('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }),
      ...permissionEvents(2, 'danger-full-access', 'danger-full-access', 'never'),
    ]
    controller.loadHistory(history)
    expect(controller.snapshot().permissionPreset).toBe('danger-full-access')
  })

  it('reports permission facts in /status', () => {
    const controller = new TuiController(async () => {})
    controller.bindAgent(idleAgent())
    for (const permissionEvent of permissionEvents(1, 'workspace-write', 'workspace-write', 'ask')) {
      controller.ingest(permissionEvent)
    }
    controller.submit('/status')
    const text = controller.snapshot().items.at(-1)
    expect(text).toMatchObject({ kind: 'system' })
    expect(String((text as { text: string }).text)).toContain('permission workspace-write')
    expect(String((text as { text: string }).text)).toContain('sandbox workspace-write')
    expect(String((text as { text: string }).text)).toContain('approval ask')
  })
})

describe('permission switching', () => {
  const presets = { names: ['read-only', 'workspace-write', 'danger-full-access'] }

  function makeController(execute = vi.fn()): { controller: TuiController; execute: ReturnType<typeof vi.fn> } {
    const controller = new TuiController(async () => {}, {
      permissionPresets: presets,
      commands: { execute },
    })
    controller.bindAgent(idleAgent())
    return { controller, execute }
  }

  it('switches through the official command when idle with an argument', async () => {
    const execute = vi.fn().mockResolvedValue({ result: { kind: 'success', text: 'preset workspace-write' } })
    const { controller } = makeController(execute)
    controller.submit('/permission workspace-write')
    await flush()
    expect(execute).toHaveBeenCalledWith(expect.anything(), '/permission workspace-write', expect.anything())
  })

  it('rejects switches while the agent is running', async () => {
    const execute = vi.fn().mockResolvedValue({ result: { kind: 'success', text: 'preset read-only' } })
    const controller = new TuiController(async () => {}, {
      permissionPresets: presets,
      commands: { execute },
    })
    controller.bindAgent(idleAgent('session-x', 'running'))
    controller.submit('/permission read-only')
    await flush()
    expect(execute).not.toHaveBeenCalled()
    expect(controller.snapshot().notice).toContain('idle')
  })

  it('rejects unknown presets before executing', async () => {
    const execute = vi.fn()
    const { controller } = makeController(execute)
    controller.submit('/permission nope')
    await flush()
    expect(execute).not.toHaveBeenCalled()
    expect(controller.snapshot().notice).toContain('unknown preset')
  })

  it('does not re-switch to the current preset', async () => {
    const execute = vi.fn()
    const { controller } = makeController(execute)
    for (const permissionEvent of permissionEvents(1, 'workspace-write', 'workspace-write', 'ask')) {
      controller.ingest(permissionEvent)
    }
    controller.submit('/permission workspace-write')
    await flush()
    expect(execute).not.toHaveBeenCalled()
    expect(controller.snapshot().notice).toContain('already')
  })

  it('offers a numbered picker on a bare /permission', async () => {
    const execute = vi.fn().mockResolvedValue({ result: { kind: 'success', text: 'preset read-only' } })
    const { controller } = makeController(execute)
    controller.submit('/permission')
    await flush()
    expect(controller.snapshot().interaction?.kind).toBe('permission')
    controller.submit('1')
    await flush()
    expect(execute).toHaveBeenCalledWith(expect.anything(), '/permission read-only', expect.anything())
  })

  it('requires typing FULL ACCESS to enter danger-full-access, parameter path included', async () => {
    const execute = vi.fn().mockResolvedValue({ result: { kind: 'success', text: 'preset danger-full-access' } })
    const { controller } = makeController(execute)
    controller.submit('/permission danger-full-access')
    await flush()
    expect(controller.snapshot().interaction?.kind).toBe('permission-confirm')
    controller.submit('not full access')
    await flush()
    expect(execute).not.toHaveBeenCalled()
    expect(controller.snapshot().notice).toContain('cancelled')

    controller.submit('/permission danger-full-access')
    await flush()
    expect(controller.snapshot().interaction?.kind).toBe('permission-confirm')
    controller.submit('FULL ACCESS')
    await flush()
    expect(execute).toHaveBeenCalledWith(expect.anything(), '/permission danger-full-access', expect.anything())
  })

  it('shows a switch failure from the official command outcome', async () => {
    const execute = vi.fn().mockResolvedValue({ result: { kind: 'error', text: 'unknown preset "nope"' } })
    const { controller } = makeController(execute)
    controller.submit('/permission read-only')
    await flush()
    expect(controller.snapshot().notice).toContain('unknown preset')
  })
})
