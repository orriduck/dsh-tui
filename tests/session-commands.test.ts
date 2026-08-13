import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import TuiSessionCommandService, {
  createSessionCommandDefinitions,
  recentWorkspaceSessions,
  SessionCommandCoordinator,
} from '../src/session-commands.js'

describe('session command plugin', () => {
  it('lists recent workspace sessions with titles and the current marker', async () => {
    const headers = [
      { id: 'session-old', cwd: '/repo', createdAt: 10, version: 0 },
      { id: 'session-other', cwd: '/other', createdAt: 40, version: 0 },
      { id: 'session-child', cwd: '/repo', createdAt: 50, version: 0, origin: 'subagent' },
      { id: 'session-new', cwd: '/repo', createdAt: 30, version: 0 },
      { id: 'session-broken', cwd: '/repo', createdAt: 20, version: 0 },
    ] as unknown as SessionHeader[]
    const titles = new Map([
      ['session-old', 'session-old'],
      ['session-new', 'Newest work'],
    ])
    const persistence = {
      list: async (): Promise<SessionHeader[]> => headers,
      inspect: async (id: string): Promise<{ events: SessionEvent[] }> => {
        if (id === 'session-broken') throw new Error('corrupt session log')
        return {
          events: titles.has(id)
            ? [{ type: 'session/title', seq: 0, time: 1, data: { title: titles.get(id) } } as SessionEvent]
            : [],
        }
      },
    }

    await expect(recentWorkspaceSessions(
      persistence,
      '/repo',
      'session-new',
      new AbortController().signal,
      3,
    )).resolves.toEqual([
      { id: 'session-new', title: 'Newest work', createdAt: 30, current: true },
      {
        id: 'session-broken',
        title: 'Unreadable session',
        createdAt: 20,
        current: false,
        unreadable: 'corrupt session log',
      },
      { id: 'session-old', title: 'Untitled session', createdAt: 10, current: false },
    ])
  })

  it('defines list, new, and resume as DSH commands', async () => {
    const definitions = createSessionCommandDefinitions({} as never)
    expect(definitions.map(({ name, description, input }) => ({ name, description, input }))).toEqual([
      { name: 'sessions', description: 'List recent sessions for this workspace', input: undefined },
      { name: 'new', description: 'Start a new session in this workspace', input: undefined },
      { name: 'resume', description: 'Resume a recent or exact session', input: { hint: '<session-id>' } },
    ])
  })

  it('/sessions renders the recent workspace session list', async () => {
    const agent = { id: 'session-new' } as never
    const definitions = createSessionCommandDefinitions({
      canRestart: true,
      list: async () => [
        { id: 'session-new', title: 'Newest work', createdAt: Date.UTC(2026, 7, 13, 18, 30), current: true },
        {
          id: 'session-broken',
          title: 'Unreadable session',
          createdAt: Date.UTC(2026, 7, 13, 12, 0),
          current: false,
          unreadable: 'corrupt session log',
        },
        { id: 'session-old', title: 'Older work', createdAt: Date.UTC(2026, 7, 12, 9, 5), current: false },
      ],
      request: () => {},
    })
    const command = definitions.find(definition => definition.name === 'sessions')

    await expect(command?.handler({ agent, rawInput: '', signal: new AbortController().signal } as never))
      .resolves.toEqual({
        kind: 'success',
        text: [
          'Recent sessions for this workspace:',
          '● 2026-08-13 18:30  Newest work',
          '  session-new',
          '  2026-08-13 12:00  Unreadable session [unreadable]',
          '  session-broken',
          '  2026-08-12 09:05  Older work',
          '  session-old',
        ].join('\n'),
      })
  })

  it('/new queues a launcher restart for a fresh session', async () => {
    const agent = { id: 'session-current' } as never
    const requested: unknown[] = []
    const definitions = createSessionCommandDefinitions({
      canRestart: true,
      list: async () => [],
      request: (_agent, request) => requested.push(request),
    })
    const command = definitions.find(definition => definition.name === 'new')

    await expect(command?.handler({ agent, rawInput: '', signal: new AbortController().signal } as never))
      .resolves.toEqual({ kind: 'success', text: 'Starting a new session…' })
    expect(requested).toEqual([{ kind: 'new' }])
  })

  it('/new refuses to interrupt a running turn', async () => {
    const requested: unknown[] = []
    const definitions = createSessionCommandDefinitions({
      canRestart: true,
      list: async () => [],
      request: (_agent, request) => requested.push(request),
    })
    const command = definitions.find(definition => definition.name === 'new')
    const agent = { id: 'session-current', status: 'running' } as never

    await expect(command?.handler({ agent, rawInput: '', signal: new AbortController().signal } as never))
      .resolves.toEqual({ kind: 'error', text: 'Switch sessions while idle — cancel the current turn first' })
    expect(requested).toEqual([])
  })

  it('/resume without an id queues a picker of other workspace sessions', async () => {
    const agent = { id: 'session-current' } as never
    const requested: unknown[] = []
    const other = { id: 'session-other', title: 'Other work', createdAt: 10, current: false }
    const definitions = createSessionCommandDefinitions({
      canRestart: true,
      list: async () => [
        { id: 'session-current', title: 'Current work', createdAt: 20, current: true },
        {
          id: 'session-broken',
          title: 'Unreadable session',
          createdAt: 15,
          current: false,
          unreadable: 'corrupt session log',
        },
        other,
      ],
      request: (_agent, request) => requested.push(request),
    })
    const command = definitions.find(definition => definition.name === 'resume')

    await expect(command?.handler({ agent, rawInput: '', signal: new AbortController().signal } as never))
      .resolves.toEqual({ kind: 'success' })
    expect(requested).toEqual([{ kind: 'pick', sessions: [other] }])
  })

  it('/resume reports a corrupt exact session without restarting', async () => {
    const agent = { id: 'session-current' } as never
    const requested: unknown[] = []
    const definitions = createSessionCommandDefinitions({
      canRestart: true,
      list: async () => [{
        id: 'session-broken',
        title: 'Unreadable session',
        createdAt: 10,
        current: false,
        unreadable: 'corrupt session log: duplicate seq 409',
      }],
      request: (_agent, request) => requested.push(request),
    })
    const command = definitions.find(definition => definition.name === 'resume')

    await expect(command?.handler({
      agent,
      rawInput: ' session-broken',
      signal: new AbortController().signal,
    } as never)).resolves.toEqual({
      kind: 'error',
      text: 'session "session-broken" is unreadable: corrupt session log: duplicate seq 409',
    })
    expect(requested).toEqual([])
  })

  it('/resume refuses to interrupt a running turn', async () => {
    const requested: unknown[] = []
    const definitions = createSessionCommandDefinitions({
      canRestart: true,
      list: async () => [],
      request: (_agent, request) => requested.push(request),
    })
    const command = definitions.find(definition => definition.name === 'resume')
    const agent = { id: 'session-current', status: 'running' } as never

    await expect(command?.handler({ agent, rawInput: '', signal: new AbortController().signal } as never))
      .resolves.toEqual({ kind: 'error', text: 'Switch sessions while idle — cancel the current turn first' })
    expect(requested).toEqual([])
  })

  it('/resume validates an exact id against the current workspace before restarting', async () => {
    const agent = { id: 'session-current' } as never
    const requested: unknown[] = []
    const current = { id: 'session-current', title: 'Current work', createdAt: 20, current: true }
    const other = { id: 'session-other', title: 'Other work', createdAt: 10, current: false }
    const list = vi.fn(async (_agent: unknown, _signal: AbortSignal, limit?: number) => (
      limit === Number.POSITIVE_INFINITY ? [current, other] : [current]
    ))
    const definitions = createSessionCommandDefinitions({
      canRestart: true,
      list,
      request: (_agent, request) => requested.push(request),
    })
    const command = definitions.find(definition => definition.name === 'resume')
    const signal = new AbortController().signal
    const invocation = { agent, rawInput: ' session-other', signal } as never

    await expect(command?.handler(invocation))
      .resolves.toEqual({ kind: 'success', text: 'Resuming Other work…' })
    expect(list).toHaveBeenCalledWith(agent, signal, Number.POSITIVE_INFINITY)
    expect(requested).toEqual([{ kind: 'resume', id: 'session-other' }])
  })

  it('keeps switch requests scoped to the issuing agent and consumes them once', async () => {
    const coordinator = new SessionCommandCoordinator(
      { list: async () => [], inspect: async () => ({ events: [] }) },
      '/repo',
      true,
    )
    const first = {} as never
    const second = {} as never
    coordinator.request(first, { kind: 'new' })

    expect(coordinator.take(second)).toBeUndefined()
    expect(coordinator.take(first)).toEqual({ kind: 'new' })
    expect(coordinator.take(first)).toBeUndefined()
  })

  it('mounts the three definitions through the DSH command registry', async () => {
    const registered: string[] = []
    const ctx = new Context()
    ctx.provide('sessionPersistence', {
      list: async () => [],
      inspect: async () => ({ events: [] }),
    } as never)
    ctx.provide('commands', {
      register: (definition: { name: string }) => {
        registered.push(definition.name)
        return () => {}
      },
    } as never)
    const fiber = ctx.plugin(TuiSessionCommandService)
    await fiber

    expect(registered).toEqual(['sessions', 'new', 'resume'])
    expect(ctx.dshTuiSessionCommands).toBeDefined()
    await fiber.dispose()
  })
})
