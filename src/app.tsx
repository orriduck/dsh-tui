import React, { useRef, useState, useSyncExternalStore } from 'react'
import { Box, Static, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { TranscriptItem } from './controller.js'
import {
  applyCompletion,
  completionCandidates,
  contextUsageLabel,
  internals,
  TuiController,
  permissionLabel,
} from './controller.js'
import type { ThemePalette } from './theme.js'
import { themePalettes } from './theme.js'

function TranscriptRow({ item, palette }: { item: TranscriptItem; palette: ThemePalette }): React.JSX.Element {
  if (item.kind === 'user') {
    return <Box marginTop={1}><Text color={palette.user}>› </Text><Text>{item.text}</Text></Box>
  }
  if (item.kind === 'assistant') {
    return <Box marginTop={1}><Text><Text color={palette.success}>◆</Text> {item.text}</Text></Box>
  }
  if (item.kind === 'system') {
    return <Box><Text color={palette.muted}>  {item.text}</Text></Box>
  }
  const marker = item.status === 'running' ? '◌' : item.status === 'error' ? '×' : '✓'
  const color = item.status === 'running' ? palette.warning : item.status === 'error' ? palette.error : palette.muted
  return (
    <Box>
      <Text color={color}>{marker} {item.name}</Text>
      {item.detail === '' ? null : <Text color={palette.muted}>  {item.detail}</Text>}
    </Box>
  )
}

export function App({ controller }: { controller: TuiController }): React.JSX.Element {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const palette = themePalettes[state.theme]
  const [value, setValue] = useState('')
  const completionCycle = useRef<{
    baseValue: string
    match: { start: number; end: number }
    candidates: string[]
    index: number
    renderedValue: string
  } | undefined>(undefined)

  const prompt = state.interaction

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      controller.cancelOrExit()
      return
    }
    if (!key.tab || prompt !== undefined) return
    const active = completionCycle.current
    if (active !== undefined && active.renderedValue === value) {
      const index = (active.index + 1) % active.candidates.length
      const renderedValue = applyCompletion(active.baseValue, active.match, active.candidates[index] ?? '')
      completionCycle.current = { ...active, index, renderedValue }
      setValue(renderedValue)
      return
    }
    const match = completionCandidates(value, state.skills)
    if (match === undefined) return
    const renderedValue = applyCompletion(value, match, match.candidates[0] ?? '')
    completionCycle.current = {
      baseValue: value,
      match,
      candidates: match.candidates,
      index: 0,
      renderedValue,
    }
    setValue(renderedValue)
  })

  const submit = (text: string): void => {
    completionCycle.current = undefined
    controller.submit(text)
    setValue('')
  }

  const changeValue = (next: string): void => {
    completionCycle.current = undefined
    setValue(next)
  }

  const activeCompletion = completionCycle.current?.renderedValue === value
    ? completionCycle.current
    : undefined
  const pendingCompletion = prompt === undefined ? completionCandidates(value, state.skills) : undefined
  const completionOptions = activeCompletion?.candidates ?? pendingCompletion?.candidates ?? []
  const selectedCompletion = activeCompletion?.candidates[activeCompletion.index]
  const completionPreview = internals.completionPreview(completionOptions, selectedCompletion)
  const promptLabel = prompt === undefined
    ? state.status === 'running' ? 'steer › ' : 'you › '
    : prompt.kind === 'approval' ? 'allow › '
    : prompt.kind === 'permission' || prompt.kind === 'permission-confirm' ? 'permission › '
    : 'answer › '

  const preset = state.permissionPreset
  const fullAccess = preset === 'danger-full-access'
  const showPermission = preset !== 'default' && preset !== 'workspace-write'
  const model = state.model?.split('/').at(-1) ?? 'model pending'

  return (
    <Box flexDirection="column">
      <Static items={state.items}>
        {(item) => <TranscriptRow key={item.id} item={item} palette={palette} />}
      </Static>

      {state.activeTools.map(item => (
        <TranscriptRow key={item.id} item={item} palette={palette} />
      ))}

      {state.reasoningText === '' ? null : (
        <Box marginTop={1}><Text color={palette.muted}>thinking  {state.reasoningText}</Text></Box>
      )}
      {state.streamingText === '' ? null : (
        <Box marginTop={1}><Text color={palette.success}>◆ </Text><Text>{state.streamingText}</Text></Box>
      )}

      {prompt === undefined ? null : (
        <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor={palette.warning} paddingX={1}>
          <Text bold color={palette.warning}>{prompt.title}</Text>
          {prompt.detail === undefined ? null : <Text>{prompt.detail}</Text>}
          <Text color={palette.muted}>{prompt.options.join('  ·  ')}{prompt.multiSelect === true ? '  (comma separated)' : ''}</Text>
        </Box>
      )}

      {state.notice === undefined ? null : <Text color={palette.muted}>{state.notice}</Text>}
      {prompt !== undefined || completionOptions.length === 0 ? null : (
        <Text color={palette.muted}>⇥ {completionPreview}</Text>
      )}
      <Box
        marginTop={1}
        flexDirection="column"
        backgroundColor={palette.composerBackground}
        paddingX={1}
        paddingY={1}
        width="100%"
      >
        <Box>
          <Text color={prompt === undefined ? palette.user : palette.warning}>{promptLabel}</Text>
          <Box flexGrow={1}>
            <TextInput value={value} onChange={changeValue} onSubmit={submit} />
          </Box>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text color={palette.muted}>
            {model}{' · '}{state.status}{' · dsh '}{state.dshVersion ?? 'unknown'}
          </Text>
          {state.dshUpgrade === undefined ? null : (
            <Text color={palette.warning}>
              {'↑ DSH '}{state.dshUpgrade.version}{' available · '}{state.dshUpgrade.command}
            </Text>
          )}
          <Text>
            {showPermission ? (
              <Text color={fullAccess ? palette.warning : palette.muted} bold={fullAccess}>
                {permissionLabel(preset)}{' · '}
              </Text>
            ) : null}
            <Text color={palette.muted}>
              {contextUsageLabel(state.usage, state.contextWindow)}{' · Ctrl+C '}
              {state.status === 'running' ? 'cancel' : 'exit'}{' · /help'}
            </Text>
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
