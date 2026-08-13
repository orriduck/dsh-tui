import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { applyKnobEvent, type KnobState } from '@deepseek-ai/dsh-permission-presets'
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

/** Folded session permission state: last value of each knob event, null before an override. */
export interface PermissionState {
  preset: string | null
  sandbox: string | null
  approval: string | null
}

/** Optional host services used by the permission surfaces; absent → the UI degrades gracefully. */
export interface PermissionDeps {
  permissionPresets?: {
    names: readonly string[]
  }
  commands?: {
    execute: (agent: Agent, line: string, signal: AbortSignal) => Promise<unknown>
  }
}

/** Human label for a preset name; `danger-full-access` reads as an explicit warning, not color alone. */
export function permissionLabel(name: string): string {
  switch (name) {
    case 'read-only': return 'Read only'
    case 'workspace-write': return 'Workspace write'
    case 'danger-full-access': return 'FULL ACCESS'
    default: return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
}

const EMPTY_KNOBS: KnobState = { preset: null, sandbox: null, approval: null }

export type TranscriptItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'system'; text: string }
  | ToolTranscriptItem

interface InteractionPrompt {
  kind: 'approval' | 'question' | 'permission' | 'permission-confirm'
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
  permission: PermissionState
  /** Display preset: last selected, derived `custom`, or `default` before any override. */
  permissionPreset: string
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
    permission: { preset: null, sandbox: null, approval: null },
    permissionPreset: 'default',
  }
  private readonly listeners = new Set<Listener>()
  private agent: Agent | undefined
  private pendingAnswer: ((value: string) => void) | undefined
  private exitRequested = false
  private historyItems: TranscriptItem[] | undefined
  private historyChanged = false
  private knobs: KnobState = EMPTY_KNOBS

  constructor(
    private readonly onExit: () => Promise<void>,
    private readonly deps: PermissionDeps = {},
  ) {}

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
      case 'permission/preset': {
        this.knobs = applyKnobEvent(this.knobs, event)
        const preset = String(data.preset ?? '')
        this.update({
          permission: this.permissionState(),
          permissionPreset: this.currentPreset(),
          ...(this.state.notice === `Switching permission to ${preset}…`
            ? { notice: undefined }
            : {}),
        })
        break
      }
      case 'sandbox/mode':
      case 'approval/policy': {
        this.knobs = applyKnobEvent(this.knobs, event)
        this.update({
          permission: this.permissionState(),
          permissionPreset: this.currentPreset(),
        })
        break
      }
    }
  }

  private permissionState(): PermissionState {
    return {
      preset: this.knobs.preset,
      sandbox: this.knobs.sandbox,
      approval: this.knobs.approval,
    }
  }

  /** The preset to display: last selected preset, derived `custom`, or `default` before any override. */
  private currentPreset(): string {
    if (this.knobs.preset !== null) return this.knobs.preset
    if (this.knobs.sandbox !== null || this.knobs.approval !== null) return 'custom'
    return 'default'
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
      const permission = this.currentPreset()
      const sandbox = this.state.permission.sandbox ?? 'default'
      const approval = this.state.permission.approval ?? 'default'
      this.append({
        id: `status-${Date.now()}`,
        kind: 'system',
        text: `session ${this.state.sessionId ?? 'starting'} · ${this.state.model ?? 'model pending'} · ${this.state.status} · theme ${this.state.theme} (${this.state.themeSource}) · permission ${permission} · sandbox ${sandbox} · approval ${approval}`,
      })
      return
    }
    if (text === '/permission' || text.startsWith('/permission ')) {
      const raw = text.slice('/permission'.length).trim()
      void this.permissionCommand(raw)
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

  /** `/permission` — bare opens a numbered picker, an argument switches directly (idle only). */
  private async permissionCommand(raw: string | undefined): Promise<void> {
    if (this.agent === undefined) return
    if (this.agent.status === 'running') {
      this.update({ notice: 'Switch permission while idle — cancel the current turn first' })
      return
    }
    const names = this.deps.permissionPresets?.names ?? []
    if (names.length === 0) {
      this.update({ notice: '/permission unavailable (permission presets service missing)' })
      return
    }
    if (raw === undefined || raw === '') {
      await this.permissionPicker(names)
      return
    }
    const name = names.find(candidate => candidate === raw)
    if (name === undefined) {
      this.update({ notice: `unknown preset "${raw}" (available: ${names.join(', ')})` })
      return
    }
    await this.confirmAndSwitch(name)
  }

  private async permissionPicker(names: readonly string[]): Promise<void> {
    const decorated = names.map((name, index) => `${index + 1} ${permissionLabel(name)}`)
    const answer = normalizeAnswer(await this.askForInput({
      kind: 'permission',
      title: 'Permission for this session',
      detail: `current ${permissionLabel(this.currentPreset())}`,
      options: decorated,
    }))
    if (answer === '__cancelled__') return
    const index = Number.parseInt(answer, 10)
    const byNumber = Number.isSafeInteger(index) ? names[index - 1] : undefined
    const byLabel = names.find(name => normalizeAnswer(permissionLabel(name)) === answer || name === answer)
    const name = byNumber ?? byLabel
    if (name === undefined) {
      this.update({ notice: `unknown choice "${answer}"` })
      return
    }
    await this.confirmAndSwitch(name)
  }

  private async confirmAndSwitch(name: string): Promise<void> {
    if (name === 'danger-full-access') {
      const answer = normalizeAnswer(await this.askForInput({
        kind: 'permission-confirm',
        title: 'Enable FULL ACCESS for this session?',
        detail: 'The file sandbox will no longer restrict writes. Approval policy becomes "never"; approval requests are rejected instead of shown. Type FULL ACCESS to confirm, or anything else to cancel.',
        options: ['type FULL ACCESS to confirm', 'anything else to cancel'],
      }))
      if (answer === '__cancelled__' || answer !== 'full access') {
        this.update({ notice: 'Full access cancelled' })
        return
      }
    }
    await this.switchPermission(name)
  }

  /** The official `/permission` command owns the switch: audit events, validation, and transition notices stay in DSH. */
  private async switchPermission(name: string): Promise<void> {
    if (this.agent === undefined) return
    if (this.currentPreset() === name) {
      this.update({ notice: `permission already ${name}` })
      return
    }
    const commands = this.deps.commands
    if (commands === undefined) {
      this.update({ notice: '/permission unavailable (commands service missing)' })
      return
    }
    this.update({ notice: `Switching permission to ${name}…` })
    try {
      const execution = await commands.execute(this.agent, `/permission ${name}`, new AbortController().signal)
      const result = (execution as { result?: { kind?: string; text?: string } } | undefined)?.result
      if (result !== undefined && result.kind === 'error') {
        this.update({ notice: result.text ?? `permission switch to ${name} failed` })
      }
    } catch (error) {
      this.update({ notice: `permission switch failed: ${error instanceof Error ? error.message : String(error)}` })
    }
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
