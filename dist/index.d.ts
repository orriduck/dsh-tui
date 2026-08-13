import { Context } from '@deepseek-ai/cordis';
import { SessionHeader } from '@deepseek-ai/dsh-session';

declare const name = "dsh-tui";
declare const inject: string[];
interface Config {
    continueSession?: boolean;
    resumeSessionId?: string;
    initialPrompt?: string;
}
declare function newestSessionForCwd(headers: readonly SessionHeader[], cwd: string): SessionHeader | undefined;
declare function apply(ctx: Context, config: Config): void;
declare const internals: {
    newestSessionForCwd: typeof newestSessionForCwd;
};

export { type Config, apply, inject, internals, name };
