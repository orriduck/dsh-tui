import { describe, expect, it } from 'vitest'
import { composerCursorPosition, editComposerInput } from '../src/composer-input.js'

describe('composer input', () => {
  it('positions the real terminal cursor inside the composer using display width', () => {
    expect(composerCursorPosition(
      { left: 0, top: 7 },
      'you › ',
      '你好a',
      2,
    )).toEqual({ x: 10, y: 8 })
  })

  it('edits at the controlled cursor offset', () => {
    expect(editComposerInput('abcd', 2, '', { leftArrow: true }))
      .toEqual({ value: 'abcd', cursorOffset: 1 })
    expect(editComposerInput('abcd', 2, '你', {}))
      .toEqual({ value: 'ab你cd', cursorOffset: 3 })
    expect(editComposerInput('abcd', 2, '', { backspace: true }))
      .toEqual({ value: 'acd', cursorOffset: 1 })
  })
})
