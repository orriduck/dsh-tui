import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { render, type Instance } from 'ink'
import React from 'react'
import { App } from './app.js'
import { TuiController } from './controller.js'
import { resolveTheme } from './theme.js'

export const name = 'dsh-tui'
export const inject = [
  'agentDefaultModel',
  'agents',
  'sessions',
  'sessionPersistence',
  'userQuestions',
]

export interface Config {
  continueSession?: boolean
  resumeSessionId?: string
  initialPrompt?: string
}

function newestSessionForCwd(headers: readonly SessionHeader[], cwd: string): SessionHeader | undefined {
  return headers
    .filter(header => header.cwd === cwd && header.origin !== 'subagent')
    .sort((left, right) => right.createdAt - left.createdAt)[0]
}

async function run(ctx: Context, config: Config): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('dsh-tui needs an interactive terminal; use the headless profile for scripts')
  }
  const theme = await resolveTheme()
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  const persistence = ctx.get('sessionPersistence')
  const userQuestions = ctx.get('userQuestions')
  const appExit = ctx.get('appExit')
  if (agents === undefined || defaultModel === undefined || sessions === undefined
      || persistence === undefined || userQuestions === undefined || appExit === undefined) return

  let ink: Instance | undefined
  let handle: Awaited<ReturnType<typeof agents.create>> | undefined
  const controller = new TuiController(async () => {
    if (handle !== undefined) {
      if (handle.agent.status === 'running') handle.agent.cancel({ kind: 'user' })
      await handle.agent.whenIdle()
      await sessions.flush(handle.agent.session)
    }
    ink?.unmount()
    appExit(0)
  })
  controller.setTheme(theme)

  const disposeQuestions = userQuestions.registerProvider({
    ask: request => controller.askQuestions(request),
  })
  const disposeApproval = ctx.on('approval/request', (request: ApprovalRequest, next) => {
    if (handle === undefined || request.agent !== handle.agent) return next()
    return controller.requestApproval(request)
  }, { prepend: true })

  const selection = defaultModel.currentSelection()
  const setup = (agentCtx: Context): void => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
  }

  let resumeId = config.resumeSessionId
  if (resumeId === undefined && config.continueSession === true) {
    const previous = newestSessionForCwd(await persistence.list(), process.cwd())
    resumeId = previous?.id
  }

  handle = resumeId === undefined
    ? await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      })
    : await agents.resume({
        resumeSessionId: SessionId(resumeId),
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      })

  await handle.agent.whenIdle()
  controller.bindAgent(handle.agent)
  controller.loadHistory(handle.agent.session.events)

  const disposeStatus = handle.agent.ctx.on('agent/status', ({ agent, status }) => {
    if (agent === handle?.agent) controller.setStatus(status)
  })
  const disposeEvents = handle.agent.ctx.on('session/event', (session, event) => {
    if (session === handle?.agent.session) controller.ingest(event)
  })

  ink = render(React.createElement(App, { controller }), { exitOnCtrlC: false })
  if (config.initialPrompt !== undefined) controller.submit(config.initialPrompt)

  ctx.effect(() => async () => {
    disposeEvents()
    disposeStatus()
    disposeApproval()
    disposeQuestions()
    ink?.unmount()
    if (handle !== undefined) await handle.dispose()
  })
}

export function apply(ctx: Context, config: Config): void {
  const appExit = ctx.get('appExit')
  void run(ctx, config).catch((error: unknown) => {
    process.stderr.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    appExit?.(1)
  })
}

export const internals = { newestSessionForCwd }
