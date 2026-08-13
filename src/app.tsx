import React, { useState, useSyncExternalStore } from 'react'
import { Box, Static, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { TranscriptItem } from './controller.js'
import { TuiController } from './controller.js'

function TranscriptRow({ item }: { item: TranscriptItem }): React.JSX.Element {
  if (item.kind === 'user') {
    return <Box marginTop={1}><Text color="cyan">› </Text><Text>{item.text}</Text></Box>
  }
  if (item.kind === 'assistant') {
    return <Box marginTop={1}><Text><Text color="green">◆</Text> {item.text}</Text></Box>
  }
  if (item.kind === 'system') {
    return <Box><Text dimColor>  {item.text}</Text></Box>
  }
  const marker = item.status === 'running' ? '◌' : item.status === 'error' ? '×' : '✓'
  const color = item.status === 'running' ? 'yellow' : item.status === 'error' ? 'red' : 'gray'
  return (
    <Box>
      <Text color={color}>{marker} {item.name}</Text>
      {item.detail === '' ? null : <Text dimColor>  {item.detail}</Text>}
    </Box>
  )
}

export function App({ controller }: { controller: TuiController }): React.JSX.Element {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot)
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
    : prompt.kind === 'approval' ? 'allow › ' : 'answer › '

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text>
          <Text bold color="green">dsh-tui</Text>
          <Text dimColor> · {state.title} · {state.model ?? 'loading'} · {state.status}</Text>
        </Text>
      </Box>

      <Static items={state.items}>
        {(item) => <TranscriptRow key={item.id} item={item} />}
      </Static>

      {state.reasoningText === '' ? null : (
        <Box marginTop={1}><Text dimColor>thinking  {state.reasoningText}</Text></Box>
      )}
      {state.streamingText === '' ? null : (
        <Box marginTop={1}><Text color="green">◆ </Text><Text>{state.streamingText}</Text></Box>
      )}

      {prompt === undefined ? null : (
        <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">{prompt.title}</Text>
          {prompt.detail === undefined ? null : <Text>{prompt.detail}</Text>}
          <Text dimColor>{prompt.options.join('  ·  ')}{prompt.multiSelect === true ? '  (comma separated)' : ''}</Text>
        </Box>
      )}

      {state.notice === undefined ? null : <Text dimColor>{state.notice}</Text>}
      <Box marginTop={1}>
        <Text color={prompt === undefined ? 'cyan' : 'yellow'}>{promptLabel}</Text>
        <TextInput value={value} onChange={setValue} onSubmit={submit} />
      </Box>
      <Text dimColor>Ctrl+C {state.status === 'running' ? 'cancel' : 'exit'} · /help</Text>
    </Box>
  )
}
