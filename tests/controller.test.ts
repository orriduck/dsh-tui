import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TuiController, internals } from '../src/controller.js'

function event(type: string, seq: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq, time: seq, data } as SessionEvent
}

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
