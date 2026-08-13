export type RestartRequest = { kind: 'new' } | { kind: 'resume'; id: string }

export function parseRestartMessage(value: unknown): RestartRequest | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const message = value as Record<string, unknown>
  if (message.type !== 'dsh-tui/restart') return undefined
  const request = message.request
  if (request === null || typeof request !== 'object') return undefined
  const record = request as Record<string, unknown>
  if (record.kind === 'new') return { kind: 'new' }
  if (record.kind === 'resume' && typeof record.id === 'string' && record.id.trim() !== '') {
    return { kind: 'resume', id: record.id }
  }
  return undefined
}

export function restartArgs(request: RestartRequest): string[] {
  return request.kind === 'new' ? [] : ['--resume', request.id]
}
