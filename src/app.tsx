import React, { useRef, useState, useSyncExternalStore } from 'react'
import { Box, Static, Text, useBoxMetrics, useCursor, useInput, type DOMElement } from 'ink'
import type { TranscriptItem } from './controller.js'
import {
  applyCompletion,
  completionCandidates,
  completionMenuItems,
  contextUsageLabel,
  TuiController,
  permissionLabel,
} from './controller.js'
import {
  composerCursorPosition,
  editComposerInput,
  type ComposerInputState,
} from './composer-input.js'
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
  const [inputState, setInputState] = useState<ComposerInputState>({ value: '', cursorOffset: 0 })
  const inputStateRef = useRef(inputState)
  const { value, cursorOffset } = inputState
  const composerRef = useRef<DOMElement>(null)
  const composerMetrics = useBoxMetrics(composerRef)
  const { setCursorPosition } = useCursor()
  const completionCycle = useRef<{
    baseValue: string
    match: { start: number; end: number }
    candidates: string[]
    index: number
    renderedValue: string
  } | undefined>(undefined)

  const prompt = state.interaction

  const submit = (text: string): void => {
    completionCycle.current = undefined
    controller.submit(text)
    const next = { value: '', cursorOffset: 0 }
    inputStateRef.current = next
    setInputState(next)
  }

  const replaceValue = (next: string): void => {
    const state = { value: next, cursorOffset: next.length }
    inputStateRef.current = state
    setInputState(state)
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      controller.cancelOrExit()
      return
    }
    if (key.tab && prompt === undefined) {
      const active = completionCycle.current
      if (active !== undefined && active.renderedValue === value) {
        const index = (active.index + 1) % active.candidates.length
        const renderedValue = applyCompletion(active.baseValue, active.match, active.candidates[index] ?? '')
        completionCycle.current = { ...active, index, renderedValue }
        replaceValue(renderedValue)
        return
      }
      const match = completionCandidates(value, state.skills, state.commands)
      if (match !== undefined) {
        const renderedValue = applyCompletion(value, match, match.candidates[0] ?? '')
        completionCycle.current = {
          baseValue: value,
          match,
          candidates: match.candidates,
          index: 0,
          renderedValue,
        }
        replaceValue(renderedValue)
      }
      return
    }
    if (key.tab) return
    if (key.return) {
      submit(inputStateRef.current.value)
      return
    }
    if (key.upArrow || key.downArrow) return
    completionCycle.current = undefined
    const current = inputStateRef.current
    const next = editComposerInput(current.value, current.cursorOffset, input, key)
    inputStateRef.current = next
    setInputState(next)
  })

  const activeCompletion = completionCycle.current?.renderedValue === value
    ? completionCycle.current
    : undefined
  const pendingCompletion = prompt === undefined ? completionCandidates(value, state.skills, state.commands) : undefined
  const completionOptions = activeCompletion?.candidates ?? pendingCompletion?.candidates ?? []
  const selectedCompletion = activeCompletion?.candidates[activeCompletion.index]
  const completionMenu = completionMenuItems(completionOptions, state.skills, selectedCompletion, state.commands)
  const completionCommandWidth = completionMenu.length === 0
    ? 0
    : Math.min(28, Math.max(...completionMenu.map(option => option.command.length)) + 2)
  const promptLabel = prompt === undefined
    ? state.status === 'running' ? 'steer › ' : 'you › '
    : prompt.kind === 'approval' ? 'allow › '
    : prompt.kind === 'permission' || prompt.kind === 'permission-confirm' ? 'permission › '
    : 'answer › '

  setCursorPosition(composerMetrics.hasMeasured
    ? composerCursorPosition(composerMetrics, promptLabel, value, cursorOffset)
    : undefined)

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
          {prompt.optionLayout === 'lines'
            ? prompt.options.map(option => <Text key={option} color={palette.muted}>{option}</Text>)
            : <Text color={palette.muted}>{prompt.options.join('  ·  ')}{prompt.multiSelect === true ? '  (comma separated)' : ''}</Text>}
        </Box>
      )}

      {state.notice === undefined ? null : <Text color={palette.muted}>{state.notice}</Text>}
      <Box
        ref={composerRef}
        marginTop={1}
        flexDirection="column"
        backgroundColor={state.composerBackground ?? palette.composerBackground}
        paddingRight={1}
        paddingY={1}
        width="100%"
      >
        <Box>
          <Text color={prompt === undefined ? palette.user : palette.warning}>{promptLabel}</Text>
          <Box flexGrow={1}>
            <Text>{value}</Text>
          </Box>
        </Box>
      </Box>
      {prompt !== undefined || completionMenu.length === 0 ? null : (
        <Box flexDirection="column" paddingLeft={promptLabel.length} width="100%">
          {completionMenu.map(item => (
            <Box key={item.command} width="100%">
              <Box width={completionCommandWidth}>
                {item.selected ? (
                  <Text
                    bold
                    color={palette.user}
                    wrap="truncate-end"
                  >
                    {item.command}
                  </Text>
                ) : <Text wrap="truncate-end">{item.command}</Text>}
              </Box>
              <Box flexGrow={1}>
                <Text color={item.selected ? palette.user : palette.muted} wrap="truncate-end">
                  {item.description}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}
      <Box flexDirection="column" width="100%">
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
  )
}
