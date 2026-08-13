import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Service, type Context } from '@deepseek-ai/cordis'

export const name = 'dsh-tui-session-commands'

export interface SessionSummary {
  id: string
  title: string
  createdAt: number
  current: boolean
  unreadable?: string
}

interface SessionPersistenceReader {
  list: (signal?: AbortSignal) => Promise<SessionHeader[]>
  inspect: (id: SessionId, signal?: AbortSignal) => Promise<{ events: readonly SessionEvent[] }>
}

export type SessionSwitchRequest =
  | { kind: 'new' }
  | { kind: 'resume'; id: string }
  | { kind: 'pick'; sessions: SessionSummary[] }

export interface SessionCommandBackend {
  list: (agent: Agent, signal: AbortSignal, limit?: number) => Promise<SessionSummary[]>
  request: (agent: Agent, request: SessionSwitchRequest) => void
  canRestart: boolean
}

export class SessionCommandCoordinator implements SessionCommandBackend {
  private readonly requests = new WeakMap<Agent, SessionSwitchRequest>()

  constructor(
    private readonly persistence: SessionPersistenceReader,
    private readonly cwd: string,
    readonly canRestart: boolean,
  ) {}

  list(agent: Agent, signal: AbortSignal, limit = 10): Promise<SessionSummary[]> {
    return recentWorkspaceSessions(this.persistence, this.cwd, agent.id, signal, limit)
  }

  request(agent: Agent, request: SessionSwitchRequest): void {
    this.requests.set(agent, request)
  }

  take(agent: Agent): SessionSwitchRequest | undefined {
    const request = this.requests.get(agent)
    if (request !== undefined) this.requests.delete(agent)
    return request
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshTuiSessionCommands: TuiSessionCommandService
  }
}

function sessionTitle(events: readonly SessionEvent[], sessionId: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as unknown as { type?: string; data?: { title?: unknown } } | undefined
    if (event?.type !== 'session/title') continue
    const title = event.data?.title
    if (typeof title === 'string' && title.trim() !== '' && title.trim() !== sessionId) return title.trim()
  }
  return 'Untitled session'
}

export async function recentWorkspaceSessions(
  persistence: SessionPersistenceReader,
  cwd: string,
  currentId: string,
  signal: AbortSignal,
  limit = 10,
): Promise<SessionSummary[]> {
  const headers = (await persistence.list(signal))
    .filter(header => header.cwd === cwd && header.origin !== 'subagent')
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, Math.max(0, limit))

  return Promise.all(headers.map(async header => {
    try {
      const inspected = await persistence.inspect(header.id, signal)
      return {
        id: header.id,
        title: sessionTitle(inspected.events, header.id),
        createdAt: header.createdAt,
        current: header.id === currentId,
      }
    } catch (error) {
      return {
        id: header.id,
        title: 'Unreadable session',
        createdAt: header.createdAt,
        current: header.id === currentId,
        unreadable: error instanceof Error ? error.message : String(error),
      }
    }
  }))
}

function sessionTimestamp(createdAt: number): string {
  return new Date(createdAt).toISOString().slice(0, 16).replace('T', ' ')
}

function renderSessionList(sessions: readonly SessionSummary[]): string {
  if (sessions.length === 0) return 'No saved sessions for this workspace'
  return [
    'Recent sessions for this workspace:',
    ...sessions.flatMap(session => [
      `${session.current ? '●' : ' '} ${sessionTimestamp(session.createdAt)}  ${session.title}${
        session.unreadable === undefined ? '' : ' [unreadable]'
      }`,
      `  ${session.id}`,
    ]),
  ].join('\n')
}

export function createSessionCommandDefinitions(backend: SessionCommandBackend): CommandDefinition[] {
  return [
    {
      name: 'sessions',
      description: 'List recent sessions for this workspace',
      handler: async ({ agent, signal }) => ({
        kind: 'success',
        text: renderSessionList(await backend.list(agent, signal)),
      }),
    },
    {
      name: 'new',
      description: 'Start a new session in this workspace',
      handler: async ({ agent }) => {
        if (agent.status === 'running') {
          return { kind: 'error', text: 'Switch sessions while idle — cancel the current turn first' }
        }
        if (!backend.canRestart) {
          return { kind: 'error', text: '/new requires the dsh-tui launcher' }
        }
        backend.request(agent, { kind: 'new' })
        return { kind: 'success', text: 'Starting a new session…' }
      },
    },
    {
      name: 'resume',
      description: 'Resume a recent or exact session',
      input: { hint: '<session-id>' },
      handler: async ({ agent, rawInput, signal }) => {
        if (agent.status === 'running') {
          return { kind: 'error', text: 'Switch sessions while idle — cancel the current turn first' }
        }
        if (!backend.canRestart) {
          return { kind: 'error', text: '/resume requires the dsh-tui launcher' }
        }
        const id = rawInput.trim()
        if (id === '') {
          const sessions = (await backend.list(agent, signal))
            .filter(session => !session.current && session.unreadable === undefined)
          if (sessions.length === 0) {
            return { kind: 'error', text: 'No other saved sessions for this workspace' }
          }
          backend.request(agent, { kind: 'pick', sessions })
          return { kind: 'success' }
        }
        const session = (await backend.list(agent, signal, Number.POSITIVE_INFINITY))
          .find(candidate => candidate.id === id)
        if (session === undefined) return { kind: 'error', text: `unknown session "${id}"` }
        if (session.current) return { kind: 'error', text: `session "${id}" is already active` }
        if (session.unreadable !== undefined) {
          return { kind: 'error', text: `session "${id}" is unreadable: ${session.unreadable}` }
        }
        backend.request(agent, { kind: 'resume', id: session.id })
        return { kind: 'success', text: `Resuming ${session.title}…` }
      },
    },
  ]
}

export class TuiSessionCommandService extends Service {
  static inject = ['sessionPersistence', 'commands']
  private readonly coordinator: SessionCommandCoordinator

  constructor(ctx: Context) {
    super(ctx, 'dshTuiSessionCommands')
    this.coordinator = new SessionCommandCoordinator(
      ctx.sessionPersistence,
      process.cwd(),
      typeof process.send === 'function',
    )
    for (const definition of createSessionCommandDefinitions(this.coordinator)) {
      ctx.commands.register(definition)
    }
  }

  take(agent: Agent): SessionSwitchRequest | undefined {
    return this.coordinator.take(agent)
  }
}

export default TuiSessionCommandService
