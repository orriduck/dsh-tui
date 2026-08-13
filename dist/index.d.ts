import { Context } from '@deepseek-ai/cordis';

declare const name = "dsh-tui";
declare const inject: string[];
interface Config {
    continueSession?: boolean;
    resumeSessionId?: string;
    initialPrompt?: string;
}
declare function apply(ctx: Context, config: Config): void;

export { type Config, apply, inject, name };
