import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { Command } from 'commander'

export const name = 'dsh-tui-startup'
export const inject = ['cmdlineArgs']
export const DSH_TUI_STARTUP_SERVICE = 'dshTuiStartup'

export interface DshTuiStartupValues {
  continueSession: boolean
  resumeSessionId?: string
  initialPrompt?: string
}

function command(): Command {
  return new Command()
    .name('dsh-tui')
    .description('A small terminal UI for DeepSeek Harness.')
    .helpOption('-h, --help', 'show this help')
    .option('-c, --continue', 'resume the newest session for the current directory')
    .option('-r, --resume <session-id>', 'resume a session by id')
    .argument('[prompt...]', 'optional first prompt')
    .addHelpText('after', `
Examples:
  dsh-tui                         start a new session here
  dsh-tui -c                      continue the latest session here
  dsh-tui "fix the failing test"  start and send a prompt
`)
}

export function apply(ctx: Context): void {
  const program = command()
  program.action(() => {
    const options = program.opts<{ continue?: boolean; resume?: string }>()
    if (options.continue === true && options.resume !== undefined) {
      program.error('error: --continue and --resume cannot be used together')
    }
    const prompt = program.args.join(' ').trim()
    ctx.provide(DSH_TUI_STARTUP_SERVICE, {
      continueSession: options.continue === true,
      ...(options.resume === undefined ? {} : { resumeSessionId: options.resume }),
      ...(prompt === '' ? {} : { initialPrompt: prompt }),
    } satisfies DshTuiStartupValues)
  })
  parseCmdline(ctx, program)
}
