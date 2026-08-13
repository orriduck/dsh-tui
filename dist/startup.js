#!/usr/bin/env node

// src/startup.ts
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";
import { Command } from "commander";
var name = "dsh-tui-startup";
var inject = ["cmdlineArgs"];
var DSH_TUI_STARTUP_SERVICE = "dshTuiStartup";
function command() {
  return new Command().name("dsh-tui").description("A small terminal UI for DeepSeek Harness.").helpOption("-h, --help", "show this help").option("-c, --continue", "resume the newest session for the current directory").option("-r, --resume <session-id>", "resume a session by id").argument("[prompt...]", "optional first prompt").addHelpText("after", `
Examples:
  dsh-tui                         start a new session here
  dsh-tui -c                      continue the latest session here
  dsh-tui "fix the failing test"  start and send a prompt
`);
}
function apply(ctx) {
  const program = command();
  program.action(() => {
    const options = program.opts();
    if (options.continue === true && options.resume !== void 0) {
      program.error("error: --continue and --resume cannot be used together");
    }
    const prompt = program.args.join(" ").trim();
    ctx.provide(DSH_TUI_STARTUP_SERVICE, {
      continueSession: options.continue === true,
      ...options.resume === void 0 ? {} : { resumeSessionId: options.resume },
      ...prompt === "" ? {} : { initialPrompt: prompt }
    });
  });
  parseCmdline(ctx, program);
}
export {
  DSH_TUI_STARTUP_SERVICE,
  apply,
  inject,
  name
};
//# sourceMappingURL=startup.js.map