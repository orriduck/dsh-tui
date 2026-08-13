import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyCompletion,
  completionCandidates,
  TuiController,
  internals,
  permissionLabel,
} from '../src/controller.js'

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

  it('accumulates durable assistant usage across messages', () => {
    const controller = new TuiController(async () => {})
    controller.ingest(event('assistant/message', 1, {
      message: { content: [{ type: 'text', text: 'one' }] },
      usage: {
        inputTokens: 10_000,
        outputTokens: 2_000,
        cacheReadTokens: 300,
        cacheWriteTokens: 40,
        reasoningTokens: 500,
      },
    }))
    controller.ingest(event('assistant/message', 2, {
      message: { content: [{ type: 'text', text: 'two' }] },
      usage: { inputTokens: 2_000, outputTokens: 100 },
    }))

    expect(controller.snapshot().usage).toEqual({
      inputTokens: 12_000,
      outputTokens: 2_100,
      cacheReadTokens: 300,
      cacheWriteTokens: 40,
      reasoningTokens: 500,
    })
  })

  it('projects skill catalog and invocation metadata without exposing injected content', () => {
    const controller = new TuiController(async () => {})
    controller.ingest(event('user/message', 1, {
      role: 'user',
      source: {
        kind: 'skill-catalog',
        entries: [
          { name: 'brainstorming', description: 'Explore approaches first.' },
          { name: 'audit', description: 'Inspect a repository.' },
        ],
      },
      content: [{ type: 'text', text: '<available_skills>hidden catalog</available_skills>' }],
    }))
    controller.ingest(event('user/message', 2, {
      role: 'user',
      source: { kind: 'skill-invocation', name: 'brainstorming' },
      content: [{ type: 'text', text: '<skill_content>hidden instructions</skill_content>' }],
    }))

    expect(controller.snapshot().skills).toEqual([
      { name: 'brainstorming', description: 'Explore approaches first.' },
      { name: 'audit', description: 'Inspect a repository.' },
    ])
    expect(controller.snapshot().items).toEqual([{
      id: 'skill-2',
      kind: 'system',
      text: '◇ skill "brainstorming" loaded',
    }])
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

  it('shows the selected skill name instead of raw tool JSON', () => {
    const controller = new TuiController(async () => {})
    controller.ingest(event('tool/call', 1, {
      callId: 'call-skill',
      name: 'skill',
      arguments: '{"name":"brainstorming"}',
    }))

    expect(controller.snapshot().activeTools).toContainEqual({
      id: 'tool-call-skill',
      kind: 'tool',
      name: 'skill',
      detail: 'brainstorming',
      status: 'running',
    })

    controller.ingest(event('tool/result', 2, {
      message: {
        source: { kind: 'tool', callId: 'call-skill' },
        content: [{
          type: 'tool-result',
          toolCallId: 'call-skill',
          isError: false,
          content: [{ type: 'text', text: '<skill_content name="brainstorming">long body</skill_content>' }],
        }],
      },
    }))

    expect(controller.snapshot().items).toContainEqual({
      id: 'tool-call-skill',
      kind: 'tool',
      name: 'skill',
      detail: 'brainstorming',
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

  it('offers command and skill completions for the final slash token', () => {
    const match = completionCandidates('please use /s', [
      { name: 'shadow-mode' },
      { name: 'status-helper' },
      { name: 'skills' },
    ])
    expect(match).toEqual({
      start: 11,
      end: 13,
      candidates: ['/skills', '/status', '/shadow-mode', '/status-helper'],
    })
    expect(match === undefined ? undefined : applyCompletion('please use /s', match, '/status-helper'))
      .toBe('please use /status-helper')
    expect(completionCandidates('/skill already', [])).toBeUndefined()

    const preview = (internals as unknown as {
      completionPreview?: (candidates: readonly string[], selected?: string, maxLength?: number) => string
    }).completionPreview
    expect(preview).toBeTypeOf('function')
    expect(preview?.(['/skills', '/status', '/shadow-mode', '/systematic-debugging'], undefined, 28))
      .toBe('/skills · /status · …')
    expect(preview?.(['/skills', '/status', '/systematic-debugging'], '/systematic-debugging', 28))
      .toBe('/systematic-debugging · …')
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

describe('skills command', () => {
  it('lists skills from the injected registry and refreshes completion state', async () => {
    const list = vi.fn().mockResolvedValue([
      { name: 'audit', description: 'Inspect a repository.' },
      { name: 'brainstorming', description: 'Explore approaches first.' },
    ])
    const controller = new TuiController(async () => {}, {
      skills: { list },
    })
    controller.bindAgent(idleAgent())

    controller.submit('/skills')
    await flush()

    expect(list).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(controller.snapshot().skills).toEqual([
      { name: 'audit', description: 'Inspect a repository.' },
      { name: 'brainstorming', description: 'Explore approaches first.' },
    ])
    expect(controller.snapshot().items.slice(-2)).toEqual([
      { id: expect.any(String), kind: 'system', text: 'audit — Inspect a repository.' },
      { id: expect.any(String), kind: 'system', text: 'brainstorming — Explore approaches first.' },
    ])
  })

  it('reports usage, context percentage, and skill count in /status', () => {
    const controller = new TuiController(async () => {})
    controller.bindAgent(idleAgent())
    controller.ingest(event('user/message', 1, {
      source: { kind: 'skill-catalog', entries: [{ name: 'audit', description: 'Inspect.' }] },
      content: [{ type: 'text', text: 'hidden' }],
    }))
    controller.ingest(event('assistant/message', 2, {
      message: { content: [{ type: 'text', text: 'done' }] },
      usage: { inputTokens: 10_000, outputTokens: 2_000, cacheReadTokens: 300 },
    }))
    controller.setContextWindow(128_000)
    controller.setDshVersion('0.1.0-rc.6')
    controller.setDshUpgrade({
      version: '0.1.0-rc.7',
      command: 'npm install -g @deepseek-ai/dsh@0.1.0-rc.7',
    })

    controller.submit('/status')

    const last = controller.snapshot().items.at(-1) as { text: string }
    expect(last.text).toContain('tokens in 10k / out 2k')
    expect(last.text).toContain('ctx 12.3k/128k (10%)')
    expect(last.text).toContain('skills 1')
    expect(last.text).toContain('dsh 0.1.0-rc.6')
    expect(last.text).toContain('update 0.1.0-rc.7: npm install -g @deepseek-ai/dsh@0.1.0-rc.7')
  })
})
