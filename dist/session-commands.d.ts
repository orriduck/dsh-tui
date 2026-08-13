import { SessionHeader, SessionId, SessionEvent } from '@deepseek-ai/dsh-session';
import { CommandDefinition } from '@deepseek-ai/dsh-commands';
import { Agent } from '@deepseek-ai/dsh-agent';
import { Service, Context } from '@deepseek-ai/cordis';

declare const name = "dsh-tui-session-commands";
interface SessionSummary {
    id: string;
    title: string;
    createdAt: number;
    current: boolean;
    unreadable?: string;
}
interface SessionPersistenceReader {
    list: (signal?: AbortSignal) => Promise<SessionHeader[]>;
    inspect: (id: SessionId, signal?: AbortSignal) => Promise<{
        events: readonly SessionEvent[];
    }>;
}
type SessionSwitchRequest = {
    kind: 'new';
} | {
    kind: 'resume';
    id: string;
} | {
    kind: 'pick';
    sessions: SessionSummary[];
};
interface SessionCommandBackend {
    list: (agent: Agent, signal: AbortSignal, limit?: number) => Promise<SessionSummary[]>;
    request: (agent: Agent, request: SessionSwitchRequest) => void;
    canRestart: boolean;
}
declare class SessionCommandCoordinator implements SessionCommandBackend {
    private readonly persistence;
    private readonly cwd;
    readonly canRestart: boolean;
    private readonly requests;
    constructor(persistence: SessionPersistenceReader, cwd: string, canRestart: boolean);
    list(agent: Agent, signal: AbortSignal, limit?: number): Promise<SessionSummary[]>;
    request(agent: Agent, request: SessionSwitchRequest): void;
    take(agent: Agent): SessionSwitchRequest | undefined;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        dshTuiSessionCommands: TuiSessionCommandService;
    }
}
declare function recentWorkspaceSessions(persistence: SessionPersistenceReader, cwd: string, currentId: string, signal: AbortSignal, limit?: number): Promise<SessionSummary[]>;
declare function createSessionCommandDefinitions(backend: SessionCommandBackend): CommandDefinition[];
declare class TuiSessionCommandService extends Service {
    static inject: string[];
    private readonly coordinator;
    constructor(ctx: Context);
    take(agent: Agent): SessionSwitchRequest | undefined;
}

export { type SessionCommandBackend, SessionCommandCoordinator, type SessionSummary, type SessionSwitchRequest, TuiSessionCommandService, createSessionCommandDefinitions, TuiSessionCommandService as default, name, recentWorkspaceSessions };
