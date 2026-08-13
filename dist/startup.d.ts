import { Context } from '@deepseek-ai/cordis';

declare const name = "dsh-tui-startup";
declare const inject: string[];
declare const DSH_TUI_STARTUP_SERVICE = "dshTuiStartup";
interface DshTuiStartupValues {
    continueSession: boolean;
    resumeSessionId?: string;
    initialPrompt?: string;
}
declare function apply(ctx: Context): void;

export { DSH_TUI_STARTUP_SERVICE, type DshTuiStartupValues, apply, inject, name };
