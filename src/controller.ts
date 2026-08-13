import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { ResolvedTheme, ThemeSource } from './theme.js'

type ToolTranscriptItem = {
  id: string
  kind: 'tool'
  name: string
  detail: string
  status: 'running' | 'done' | 'error'
}

export type TranscriptItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'system'; text: string }
  | ToolTranscriptItem

interface InteractionPrompt {
  kind: 'approval' | 'question'
  title: string
  detail?: string
  options: string[]
  multiSelect?: boolean
}

interface TuiState {
  items: TranscriptItem[]
  activeTools: ToolTranscriptItem[]
  status: AgentStatus | 'starting'
  title: string
  sessionId: string | undefined
  model: string | undefined
  streamingText: string
  reasoningText: string
  interaction: InteractionPrompt | undefined
  notice: string | undefined
  theme: ResolvedTheme
  themeSource: ThemeSource
}

type Listener = () => void

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return ''
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n')
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if ('content' in record) return contentText(record.content)
  return ''
}

function messageText(value: unknown): string {
  if (value === null || typeof value !== 'object') return ''
  const content = (value as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is Record<string, unknown> => block !== null && typeof block === 'object')
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => String(block.text))
    .join('')
}

function truncate(value: string, max = 220): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

function normalizeAnswer(input: string): string {
  return input.trim().toLocaleLowerCase()
}

export class TuiController {
  private state: TuiState = {
    items: [],
    activeTools: [],
    status: 'starting',
    title: 'New session',
    sessionId: undefined,
    model: undefined,
    streamingText: '',
    reasoningText: '',
    interaction: undefined,
    notice: undefined,
    theme: 'dark',
    themeSource: 'fallback',
  }
  private readonly listeners = new Set<Listener>()
  private agent: Agent | undefined
  private pendingAnswer: ((value: string) => void) | undefined
  private exitRequested = false
  private historyItems: TranscriptItem[] | undefined
  private historyChanged = false

  constructor(private readonly onExit: () => Promise<void>) {}

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): TuiState => this.state

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private update(patch: Partial<TuiState>): void {
    this.state = { ...this.state, ...patch }
    if (this.historyItems !== undefined) {
      this.historyChanged = true
      return
    }
    this.notify()
  }

  private append(item: TranscriptItem, patch: Partial<TuiState> = {}): void {
    if (this.historyItems !== undefined) {
      this.historyItems.push(item)
      this.update(patch)
      return
    }
    this.update({ ...patch, items: [...this.state.items, item] })
  }

  bindAgent(agent: Agent): void {
    this.agent = agent
    this.update({
      sessionId: agent.id,
      model: [agent.options.provider, agent.options.model].filter(Boolean).join('/'),
      status: agent.status,
    })
  }

  setStatus(status: AgentStatus): void {
    this.update({ status })
  }

  setTheme(theme: { resolved: ResolvedTheme; source: ThemeSource }): void {
    this.update({
      theme: theme.resolved,
      themeSource: theme.source,
    })
  }

  loadHistory(events: readonly SessionEvent[]): void {
    if (events.length === 0) return
    this.historyItems = [...this.state.items]
    this.historyChanged = false
    try {
      for (const event of events) this.ingest(event)
    } finally {
      const items = this.historyItems
      const changed = this.historyChanged
      this.historyItems = undefined
      this.historyChanged = false
      this.state = { ...this.state, items }
      if (changed) this.notify()
    }
  }

  ingest(event: SessionEvent): void {
    const data = event.data as Record<string, unknown>
    const eventType: string = event.type
    switch (eventType) {
      case 'session/title': {
        const title = typeof data.title === 'string' ? data.title : undefined
        if (title !== undefined) this.update({ title })
        break
      }
      case 'user/message': {
        const source = data.source as Record<string, unknown> | undefined
        const text = messageText(data)
        if (source?.kind === 'user' && text !== '') {
          this.append({ id: `event-${event.seq}`, kind: 'user', text })
        }
        break
      }
      case 'assistant/chunk': {
        const chunk = data.chunk as Record<string, unknown> | undefined
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          this.update({ streamingText: this.state.streamingText + chunk.text })
        } else if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') {
          this.update({ reasoningText: this.state.reasoningText + chunk.text })
        }
        break
      }
      case 'assistant/message': {
        const text = messageText(data.message)
        const finalText = text || this.state.streamingText
        if (finalText !== '') {
          this.append(
            { id: `event-${event.seq}`, kind: 'assistant', text: finalText },
            { streamingText: '', reasoningText: '' },
          )
        } else {
          this.update({ streamingText: '', reasoningText: '' })
        }
        break
      }
      case 'tool/call': {
        const callId = String(data.callId ?? event.seq)
        const toolName = String(data.name ?? 'tool')
        const detail = typeof data.arguments === 'string' ? truncate(data.arguments) : ''
        const item: ToolTranscriptItem = {
          id: `tool-${callId}`,
          kind: 'tool',
          name: toolName,
          detail,
          status: 'running',
        }
        this.update({ activeTools: [...this.state.activeTools, item] })
        break
      }
      case 'tool/result': {
        const message = data.message as Record<string, unknown> | undefined
        const source = message?.source as Record<string, unknown> | undefined
        const callId = String(source?.callId ?? data.callId ?? '')
        const id = `tool-${callId}`
        const resultText = truncate(contentText(message))
        const failed = data.error !== undefined
        const pending = this.state.activeTools.find(item => item.id === id)
        if (pending === undefined) break
        const completed: ToolTranscriptItem = {
          id,
          kind: 'tool',
          name: pending.name,
          detail: resultText || pending.detail,
          status: failed ? 'error' : 'done',
        }
        this.append(completed, {
          activeTools: this.state.activeTools.filter(item => item.id !== id),
        })
        break
      }
      case 'turn/end': {
        const reason = data.reason as Record<string, unknown> | undefined
        const patch = { streamingText: '', reasoningText: '' }
        if (reason?.kind === 'error') {
          const error = reason.error as Record<string, unknown> | undefined
          this.append(
            {
              id: `event-${event.seq}`,
              kind: 'system',
              text: `Turn failed: ${String(error?.message ?? 'unknown error')}`,
            },
            patch,
          )
        } else {
          this.update(patch)
        }
        break
      }
    }
  }

  submit(input: string): void {
    if (this.pendingAnswer !== undefined) {
      this.pendingAnswer(input)
      return
    }
    const text = input.trim()
    if (text === '') return
    if (text === '/quit' || text === '/exit') {
      void this.exit()
      return
    }
    if (text === '/cancel') {
      this.cancel()
      return
    }
    if (text === '/help') {
      this.append({
        id: `help-${Date.now()}`,
        kind: 'system',
        text: '/help  /status  /cancel  /quit · Enter while running steers the current turn · Ctrl+C cancels, then exits when idle',
      })
      return
    }
    if (text === '/status') {
      this.append({
        id: `status-${Date.now()}`,
        kind: 'system',
        text: `session ${this.state.sessionId ?? 'starting'} · ${this.state.model ?? 'model pending'} · ${this.state.status} · theme ${this.state.theme} (${this.state.themeSource})`,
      })
      return
    }
    if (this.agent === undefined) return
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
    if (this.agent.status === 'running') this.agent.steer(message)
    else this.agent.followup(message)
    this.update({ notice: undefined })
  }

  cancel(): void {
    if (this.agent?.status === 'running') {
      this.agent.cancel({ kind: 'user' })
      this.update({ notice: 'Cancelling current turn…' })
    }
  }

  cancelOrExit(): void {
    if (this.agent?.status === 'running') this.cancel()
    else void this.exit()
  }

  private async exit(): Promise<void> {
    if (this.exitRequested) return
    this.exitRequested = true
    this.update({ notice: 'Saving session…' })
    await this.onExit()
  }

  private askForInput(prompt: InteractionPrompt, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (value: string): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        this.pendingAnswer = undefined
        this.update({ interaction: undefined, notice: undefined })
        resolve(value)
      }
      const abort = (): void => finish('__cancelled__')
      this.pendingAnswer = finish
      this.update({ interaction: prompt, notice: undefined })
      if (signal?.aborted === true) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    })
  }

  async requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
    const answer = normalizeAnswer(await this.askForInput({
      kind: 'approval',
      title: `Allow ${request.toolName}?`,
      ...(request.reason === undefined ? {} : { detail: request.reason }),
      options: ['y allow once', 'n reject'],
    }, request.signal))
    if (answer === '__cancelled__' || answer === 'c' || answer === 'cancel') return 'cancelled'
    if (answer === 'y' || answer === 'yes' || answer === 'allow') return 'allowed-once'
    return 'rejected'
  }

  async askQuestions(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    const answers: AskUserQuestionAnswerItem[] = []
    for (const question of request.questions) {
      answers.push(await this.askQuestion(question, request.signal))
    }
    return { answers }
  }

  private async askQuestion(question: AskUserQuestionItem, signal?: AbortSignal): Promise<AskUserQuestionAnswerItem> {
    const labels = question.options?.map(option => option.label) ?? []
    const decorated = labels.map((label, index) => `${index + 1} ${label}`)
    const raw = await this.askForInput({
      kind: 'question',
      title: question.header ?? question.question,
      ...(question.detail === undefined ? {} : { detail: question.detail }),
      options: decorated.length === 0 ? ['type an answer'] : decorated,
      ...(question.multiSelect === true ? { multiSelect: true } : {}),
    }, signal)
    if (raw === '__cancelled__') return { id: question.id, selected: [] }
    const parts = question.multiSelect === true ? raw.split(',') : [raw]
    const selected: string[] = []
    for (const part of parts) {
      const value = part.trim()
      const number = Number.parseInt(value, 10)
      const byNumber = Number.isSafeInteger(number) ? labels[number - 1] : undefined
      const byLabel = labels.find(label => normalizeAnswer(label) === normalizeAnswer(value))
      const match = byNumber ?? byLabel
      if (match !== undefined && !selected.includes(match)) selected.push(match)
    }
    return selected.length > 0
      ? { id: question.id, selected }
      : { id: question.id, selected: [], custom: raw.trim() }
  }
}

export const internals = { contentText, messageText, truncate, normalizeAnswer }
