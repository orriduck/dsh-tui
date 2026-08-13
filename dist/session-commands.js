#!/usr/bin/env node

// src/session-commands.ts
import { Service } from "@deepseek-ai/cordis";
var name = "dsh-tui-session-commands";
var SessionCommandCoordinator = class {
  constructor(persistence, cwd, canRestart) {
    this.persistence = persistence;
    this.cwd = cwd;
    this.canRestart = canRestart;
  }
  persistence;
  cwd;
  canRestart;
  requests = /* @__PURE__ */ new WeakMap();
  list(agent, signal, limit = 10) {
    return recentWorkspaceSessions(this.persistence, this.cwd, agent.id, signal, limit);
  }
  request(agent, request) {
    this.requests.set(agent, request);
  }
  take(agent) {
    const request = this.requests.get(agent);
    if (request !== void 0) this.requests.delete(agent);
    return request;
  }
};
function sessionTitle(events, sessionId) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "session/title") continue;
    const title = event.data?.title;
    if (typeof title === "string" && title.trim() !== "" && title.trim() !== sessionId) return title.trim();
  }
  return "Untitled session";
}
async function recentWorkspaceSessions(persistence, cwd, currentId, signal, limit = 10) {
  const headers = (await persistence.list(signal)).filter((header) => header.cwd === cwd && header.origin !== "subagent").sort((left, right) => right.createdAt - left.createdAt).slice(0, Math.max(0, limit));
  return Promise.all(headers.map(async (header) => {
    try {
      const inspected = await persistence.inspect(header.id, signal);
      return {
        id: header.id,
        title: sessionTitle(inspected.events, header.id),
        createdAt: header.createdAt,
        current: header.id === currentId
      };
    } catch (error) {
      return {
        id: header.id,
        title: "Unreadable session",
        createdAt: header.createdAt,
        current: header.id === currentId,
        unreadable: error instanceof Error ? error.message : String(error)
      };
    }
  }));
}
function sessionTimestamp(createdAt) {
  return new Date(createdAt).toISOString().slice(0, 16).replace("T", " ");
}
function renderSessionList(sessions) {
  if (sessions.length === 0) return "No saved sessions for this workspace";
  return [
    "Recent sessions for this workspace:",
    ...sessions.flatMap((session) => [
      `${session.current ? "\u25CF" : " "} ${sessionTimestamp(session.createdAt)}  ${session.title}${session.unreadable === void 0 ? "" : " [unreadable]"}`,
      `  ${session.id}`
    ])
  ].join("\n");
}
function createSessionCommandDefinitions(backend) {
  return [
    {
      name: "sessions",
      description: "List recent sessions for this workspace",
      handler: async ({ agent, signal }) => ({
        kind: "success",
        text: renderSessionList(await backend.list(agent, signal))
      })
    },
    {
      name: "new",
      description: "Start a new session in this workspace",
      handler: async ({ agent }) => {
        if (agent.status === "running") {
          return { kind: "error", text: "Switch sessions while idle \u2014 cancel the current turn first" };
        }
        if (!backend.canRestart) {
          return { kind: "error", text: "/new requires the dsh-tui launcher" };
        }
        backend.request(agent, { kind: "new" });
        return { kind: "success", text: "Starting a new session\u2026" };
      }
    },
    {
      name: "resume",
      description: "Resume a recent or exact session",
      input: { hint: "<session-id>" },
      handler: async ({ agent, rawInput, signal }) => {
        if (agent.status === "running") {
          return { kind: "error", text: "Switch sessions while idle \u2014 cancel the current turn first" };
        }
        if (!backend.canRestart) {
          return { kind: "error", text: "/resume requires the dsh-tui launcher" };
        }
        const id = rawInput.trim();
        if (id === "") {
          const sessions = (await backend.list(agent, signal)).filter((session2) => !session2.current && session2.unreadable === void 0);
          if (sessions.length === 0) {
            return { kind: "error", text: "No other saved sessions for this workspace" };
          }
          backend.request(agent, { kind: "pick", sessions });
          return { kind: "success" };
        }
        const session = (await backend.list(agent, signal, Number.POSITIVE_INFINITY)).find((candidate) => candidate.id === id);
        if (session === void 0) return { kind: "error", text: `unknown session "${id}"` };
        if (session.current) return { kind: "error", text: `session "${id}" is already active` };
        if (session.unreadable !== void 0) {
          return { kind: "error", text: `session "${id}" is unreadable: ${session.unreadable}` };
        }
        backend.request(agent, { kind: "resume", id: session.id });
        return { kind: "success", text: `Resuming ${session.title}\u2026` };
      }
    }
  ];
}
var TuiSessionCommandService = class extends Service {
  static inject = ["sessionPersistence", "commands"];
  coordinator;
  constructor(ctx) {
    super(ctx, "dshTuiSessionCommands");
    this.coordinator = new SessionCommandCoordinator(
      ctx.sessionPersistence,
      process.cwd(),
      typeof process.send === "function"
    );
    for (const definition of createSessionCommandDefinitions(this.coordinator)) {
      ctx.commands.register(definition);
    }
  }
  take(agent) {
    return this.coordinator.take(agent);
  }
};
var session_commands_default = TuiSessionCommandService;
export {
  SessionCommandCoordinator,
  TuiSessionCommandService,
  createSessionCommandDefinitions,
  session_commands_default as default,
  name,
  recentWorkspaceSessions
};
//# sourceMappingURL=session-commands.js.map