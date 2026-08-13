import stringWidth from 'string-width'

interface ComposerMetrics {
  left: number
  top: number
}

interface InputKey {
  leftArrow?: boolean
  rightArrow?: boolean
  backspace?: boolean
  delete?: boolean
}

export interface ComposerInputState {
  value: string
  cursorOffset: number
}

export function composerCursorPosition(
  composer: ComposerMetrics,
  prompt: string,
  value: string,
  cursorOffset: number,
): { x: number; y: number } {
  const beforeCursor = value.slice(0, Math.max(0, Math.min(cursorOffset, value.length)))
  return {
    x: composer.left + stringWidth(prompt + beforeCursor),
    y: composer.top + 1,
  }
}

export function editComposerInput(
  value: string,
  cursorOffset: number,
  input: string,
  key: InputKey,
): ComposerInputState {
  const offset = Math.max(0, Math.min(cursorOffset, value.length))
  if (key.leftArrow === true) return { value, cursorOffset: Math.max(0, offset - 1) }
  if (key.rightArrow === true) return { value, cursorOffset: Math.min(value.length, offset + 1) }
  if (key.backspace === true || key.delete === true) {
    if (offset === 0) return { value, cursorOffset: 0 }
    return {
      value: value.slice(0, offset - 1) + value.slice(offset),
      cursorOffset: offset - 1,
    }
  }
  if (input === '') return { value, cursorOffset: offset }
  return {
    value: value.slice(0, offset) + input + value.slice(offset),
    cursorOffset: offset + input.length,
  }
}
