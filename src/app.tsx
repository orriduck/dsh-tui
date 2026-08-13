import React, { useState, useSyncExternalStore } from 'react'
import { Box, Static, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { TranscriptItem } from './controller.js'
import { TuiController, permissionLabel } from './controller.js'
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

  useInput((input, key) => {
    if (key.ctrl && input === 'c') controller.cancelOrExit()
  })

  const submit = (text: string): void => {
    controller.submit(text)
    setValue('')
  }

  const prompt = state.interaction
  const promptLabel = prompt === undefined
    ? state.status === 'running' ? 'steer › ' : 'you › '
    : prompt.kind === 'approval' ? 'allow › '
    : prompt.kind === 'permission' || prompt.kind === 'permission-confirm' ? 'permission › '
    : 'answer › '

  const preset = state.permissionPreset
  const fullAccess = preset === 'danger-full-access'

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={palette.border} paddingX={1}>
        <Text>
          <Text bold color={palette.brand}>dsh-tui</Text>
          <Text color={palette.muted}> · {state.title} · {state.model ?? 'loading'} · {state.status}</Text>
        </Text>
      </Box>

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
      <Box marginTop={1}>
        <Text color={prompt === undefined ? palette.user : palette.warning}>{promptLabel}</Text>
        <TextInput value={value} onChange={setValue} onSubmit={submit} />
      </Box>
      <Text color={palette.muted}>
        {preset === 'default' ? null : (
          <Text color={fullAccess ? palette.warning : palette.muted} bold={fullAccess}>
            {permissionLabel(preset)}{' · '}
          </Text>
        )}
        {'Ctrl+C '}{state.status === 'running' ? 'cancel' : 'exit'}{' · /help'}
      </Text>
    </Box>
  )
}
