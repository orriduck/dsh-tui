import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../src/app.js'
import { TuiController } from '../src/controller.js'

const flush = async (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('App composer input', () => {
  it('applies consecutive key events against the latest controlled value', async () => {
    const controller = new TuiController(async () => {})
    const terminal = render(<App controller={controller} />)

    terminal.stdin.write('abc')
    terminal.stdin.write('\u007f\u007f')
    await flush()

    expect(terminal.lastFrame()).toContain('\nyou › a\n')
    expect(terminal.lastFrame()).toContain('\nmodel pending · starting · dsh unknown\n')
    terminal.unmount()
  })
})
