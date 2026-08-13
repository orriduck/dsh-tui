import { spawn } from 'node:child_process'

type HerdrAgentState = 'idle' | 'working' | 'blocked'

export interface HerdrSnapshot {
  status: 'starting' | 'idle' | 'running'
  interaction: { kind: string } | undefined
  sessionId: string | undefined
  title: string
}

type HerdrCommandRunner = (args: string[]) => Promise<void>

const SOURCE = 'dsh-tui'
const AGENT = 'deepseek'

function runHerdr(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('herdr', args, { env, stdio: 'ignore' })
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish()
    }, 1_000)
    child.once('error', finish)
    child.once('exit', finish)
  })
}

function agentState(snapshot: HerdrSnapshot): HerdrAgentState {
  if (snapshot.interaction !== undefined) return 'blocked'
  if (snapshot.status === 'idle') return 'idle'
  return 'working'
}

export class HerdrBridge {
  readonly enabled: boolean
  private readonly paneId: string
  private readonly runner: HerdrCommandRunner
  private queue: Promise<void> = Promise.resolve()
  private sequence = BigInt(Date.now()) * 1_000_000n
  private lastState: HerdrAgentState | undefined
  private lastSessionId: string | undefined
  private lastTitle: string | undefined
  private disposed = false

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    runner: HerdrCommandRunner = args => runHerdr(args, env),
  ) {
    this.paneId = env.HERDR_PANE_ID?.trim() ?? ''
    this.enabled = env.HERDR_ENV === '1'
      && this.paneId !== ''
      && (env.HERDR_SOCKET_PATH?.trim() ?? '') !== ''
    this.runner = runner
  }

  private enqueue(args: string[]): Promise<void> {
    this.sequence += 1n
    const command = [...args, '--seq', String(this.sequence)]
    this.queue = this.queue.then(() => this.runner(command)).catch(() => {})
    return this.queue
  }

  sync(snapshot: HerdrSnapshot): Promise<void> {
    if (!this.enabled || this.disposed) return this.queue

    const state = agentState(snapshot)
    if (state !== this.lastState) {
      this.lastState = state
      void this.enqueue([
        'pane', 'report-agent', this.paneId,
        '--source', SOURCE, '--agent', AGENT, '--state', state,
      ])
    }

    if (snapshot.sessionId !== undefined && snapshot.sessionId !== this.lastSessionId) {
      this.lastSessionId = snapshot.sessionId
      void this.enqueue([
        'pane', 'report-agent-session', this.paneId,
        '--source', SOURCE, '--agent', AGENT,
        '--agent-session-id', snapshot.sessionId,
      ])
    }

    const title = snapshot.title.trim().slice(0, 120)
    if (snapshot.sessionId !== undefined && title !== '' && title !== this.lastTitle) {
      this.lastTitle = title
      void this.enqueue([
        'pane', 'report-metadata', this.paneId,
        '--source', SOURCE, '--agent', AGENT,
        '--display-agent', 'DeepSeek', '--title', title,
      ])
    }

    return this.queue
  }

  dispose(): Promise<void> {
    if (!this.enabled || this.disposed) return this.queue
    this.disposed = true
    return this.enqueue([
      'pane', 'release-agent', this.paneId,
      '--source', SOURCE, '--agent', AGENT,
    ])
  }
}
