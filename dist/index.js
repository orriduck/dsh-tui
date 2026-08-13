#!/usr/bin/env node

// src/index.ts
import { randomUUID } from "crypto";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import { render } from "ink";
import React2 from "react";

// src/app.tsx
import { useState, useSyncExternalStore } from "react";
import { Box, Static, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { jsx, jsxs } from "react/jsx-runtime";
function TranscriptRow({ item }) {
  if (item.kind === "user") {
    return /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: "cyan", children: "\u203A " }),
      /* @__PURE__ */ jsx(Text, { children: item.text })
    ] });
  }
  if (item.kind === "assistant") {
    return /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { color: "green", children: "\u25C6" }),
      " ",
      item.text
    ] }) });
  }
  if (item.kind === "system") {
    return /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
      "  ",
      item.text
    ] }) });
  }
  const marker = item.status === "running" ? "\u25CC" : item.status === "error" ? "\xD7" : "\u2713";
  const color = item.status === "running" ? "yellow" : item.status === "error" ? "red" : "gray";
  return /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsxs(Text, { color, children: [
      marker,
      " ",
      item.name
    ] }),
    item.detail === "" ? null : /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
      "  ",
      item.detail
    ] })
  ] });
}
function App({ controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (key.ctrl && input === "c") controller.cancelOrExit();
  });
  const submit = (text) => {
    controller.submit(text);
    setValue("");
  };
  const prompt = state.interaction;
  const promptLabel = prompt === void 0 ? state.status === "running" ? "steer \u203A " : "you \u203A " : prompt.kind === "approval" ? "allow \u203A " : "answer \u203A ";
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx(Box, { borderStyle: "round", borderColor: "gray", paddingX: 1, children: /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { bold: true, color: "green", children: "dsh-tui" }),
      /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
        " \xB7 ",
        state.title,
        " \xB7 ",
        state.model ?? "loading",
        " \xB7 ",
        state.status
      ] })
    ] }) }),
    /* @__PURE__ */ jsx(Static, { items: state.items, children: (item) => /* @__PURE__ */ jsx(TranscriptRow, { item }, item.id) }),
    state.reasoningText === "" ? null : /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
      "thinking  ",
      state.reasoningText
    ] }) }),
    state.streamingText === "" ? null : /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: "green", children: "\u25C6 " }),
      /* @__PURE__ */ jsx(Text, { children: state.streamingText })
    ] }),
    prompt === void 0 ? null : /* @__PURE__ */ jsxs(Box, { marginTop: 1, flexDirection: "column", borderStyle: "single", borderColor: "yellow", paddingX: 1, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: prompt.title }),
      prompt.detail === void 0 ? null : /* @__PURE__ */ jsx(Text, { children: prompt.detail }),
      /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
        prompt.options.join("  \xB7  "),
        prompt.multiSelect === true ? "  (comma separated)" : ""
      ] })
    ] }),
    state.notice === void 0 ? null : /* @__PURE__ */ jsx(Text, { dimColor: true, children: state.notice }),
    /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: prompt === void 0 ? "cyan" : "yellow", children: promptLabel }),
      /* @__PURE__ */ jsx(TextInput, { value, onChange: setValue, onSubmit: submit })
    ] }),
    /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
      "Ctrl+C ",
      state.status === "running" ? "cancel" : "exit",
      " \xB7 /help"
    ] })
  ] });
}

// src/controller.ts
import { createUserMessage } from "@deepseek-ai/dsh-llm";
function contentText(value) {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n");
  const record = value;
  if (typeof record.text === "string") return record.text;
  if ("content" in record) return contentText(record.content);
  return "";
}
function messageText(value) {
  if (value === null || typeof value !== "object") return "";
  const content = value.content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block !== null && typeof block === "object").filter((block) => block.type === "text" && typeof block.text === "string").map((block) => String(block.text)).join("");
}
function truncate(value, max = 220) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}\u2026`;
}
function normalizeAnswer(input) {
  return input.trim().toLocaleLowerCase();
}
var TuiController = class {
  constructor(onExit) {
    this.onExit = onExit;
  }
  onExit;
  state = {
    items: [],
    status: "starting",
    title: "New session",
    sessionId: void 0,
    model: void 0,
    streamingText: "",
    reasoningText: "",
    interaction: void 0,
    notice: void 0
  };
  listeners = /* @__PURE__ */ new Set();
  agent;
  pendingAnswer;
  exitRequested = false;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.state;
  update(patch) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  append(item) {
    this.update({ items: [...this.state.items, item] });
  }
  bindAgent(agent) {
    this.agent = agent;
    this.update({
      sessionId: agent.id,
      model: [agent.options.provider, agent.options.model].filter(Boolean).join("/"),
      status: agent.status
    });
  }
  setStatus(status) {
    this.update({ status });
  }
  loadHistory(events) {
    for (const event of events) this.ingest(event);
  }
  ingest(event) {
    const data = event.data;
    const eventType = event.type;
    switch (eventType) {
      case "session/title": {
        const title = typeof data.title === "string" ? data.title : void 0;
        if (title !== void 0) this.update({ title });
        break;
      }
      case "user/message": {
        const source = data.source;
        const text = messageText(data);
        if (source?.kind === "user" && text !== "") {
          this.append({ id: `event-${event.seq}`, kind: "user", text });
        }
        break;
      }
      case "assistant/chunk": {
        const chunk = data.chunk;
        if (chunk?.type === "text-delta" && typeof chunk.text === "string") {
          this.update({ streamingText: this.state.streamingText + chunk.text });
        } else if (chunk?.type === "reasoning-delta" && typeof chunk.text === "string") {
          this.update({ reasoningText: this.state.reasoningText + chunk.text });
        }
        break;
      }
      case "assistant/message": {
        const text = messageText(data.message);
        const finalText = text || this.state.streamingText;
        if (finalText !== "") this.append({ id: `event-${event.seq}`, kind: "assistant", text: finalText });
        this.update({ streamingText: "", reasoningText: "" });
        break;
      }
      case "tool/call": {
        const callId = String(data.callId ?? event.seq);
        const toolName = String(data.name ?? "tool");
        const detail = typeof data.arguments === "string" ? truncate(data.arguments) : "";
        this.append({ id: `tool-${callId}`, kind: "tool", name: toolName, detail, status: "running" });
        break;
      }
      case "tool/result": {
        const callId = String(data.callId ?? "");
        const id = `tool-${callId}`;
        const resultText = truncate(contentText(data.message));
        const failed = data.error !== void 0;
        const items = this.state.items.map((item) => item.id === id && item.kind === "tool" ? { ...item, detail: resultText || item.detail, status: failed ? "error" : "done" } : item);
        this.update({ items });
        break;
      }
      case "turn/end": {
        const reason = data.reason;
        if (reason?.kind === "error") {
          const error = reason.error;
          this.append({
            id: `event-${event.seq}`,
            kind: "system",
            text: `Turn failed: ${String(error?.message ?? "unknown error")}`
          });
        }
        this.update({ streamingText: "", reasoningText: "" });
        break;
      }
    }
  }
  submit(input) {
    if (this.pendingAnswer !== void 0) {
      this.pendingAnswer(input);
      return;
    }
    const text = input.trim();
    if (text === "") return;
    if (text === "/quit" || text === "/exit") {
      void this.exit();
      return;
    }
    if (text === "/cancel") {
      this.cancel();
      return;
    }
    if (text === "/help") {
      this.append({
        id: `help-${Date.now()}`,
        kind: "system",
        text: "/help  /status  /cancel  /quit \xB7 Enter while running steers the current turn \xB7 Ctrl+C cancels, then exits when idle"
      });
      return;
    }
    if (text === "/status") {
      this.append({
        id: `status-${Date.now()}`,
        kind: "system",
        text: `session ${this.state.sessionId ?? "starting"} \xB7 ${this.state.model ?? "model pending"} \xB7 ${this.state.status}`
      });
      return;
    }
    if (this.agent === void 0) return;
    const message = createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" }
    });
    if (this.agent.status === "running") this.agent.steer(message);
    else this.agent.followup(message);
    this.update({ notice: void 0 });
  }
  cancel() {
    if (this.agent?.status === "running") {
      this.agent.cancel({ kind: "user" });
      this.update({ notice: "Cancelling current turn\u2026" });
    }
  }
  cancelOrExit() {
    if (this.agent?.status === "running") this.cancel();
    else void this.exit();
  }
  async exit() {
    if (this.exitRequested) return;
    this.exitRequested = true;
    this.update({ notice: "Saving session\u2026" });
    await this.onExit();
  }
  askForInput(prompt, signal) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        this.pendingAnswer = void 0;
        this.update({ interaction: void 0, notice: void 0 });
        resolve(value);
      };
      const abort = () => finish("__cancelled__");
      this.pendingAnswer = finish;
      this.update({ interaction: prompt, notice: void 0 });
      if (signal?.aborted === true) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }
  async requestApproval(request) {
    const answer = normalizeAnswer(await this.askForInput({
      kind: "approval",
      title: `Allow ${request.toolName}?`,
      ...request.reason === void 0 ? {} : { detail: request.reason },
      options: ["y allow once", "n reject"]
    }, request.signal));
    if (answer === "__cancelled__" || answer === "c" || answer === "cancel") return "cancelled";
    if (answer === "y" || answer === "yes" || answer === "allow") return "allowed-once";
    return "rejected";
  }
  async askQuestions(request) {
    const answers = [];
    for (const question of request.questions) {
      answers.push(await this.askQuestion(question, request.signal));
    }
    return { answers };
  }
  async askQuestion(question, signal) {
    const labels = question.options?.map((option) => option.label) ?? [];
    const decorated = labels.map((label, index) => `${index + 1} ${label}`);
    const raw = await this.askForInput({
      kind: "question",
      title: question.header ?? question.question,
      ...question.detail === void 0 ? {} : { detail: question.detail },
      options: decorated.length === 0 ? ["type an answer"] : decorated,
      ...question.multiSelect === true ? { multiSelect: true } : {}
    }, signal);
    if (raw === "__cancelled__") return { id: question.id, selected: [] };
    const parts = question.multiSelect === true ? raw.split(",") : [raw];
    const selected = [];
    for (const part of parts) {
      const value = part.trim();
      const number = Number.parseInt(value, 10);
      const byNumber = Number.isSafeInteger(number) ? labels[number - 1] : void 0;
      const byLabel = labels.find((label) => normalizeAnswer(label) === normalizeAnswer(value));
      const match = byNumber ?? byLabel;
      if (match !== void 0 && !selected.includes(match)) selected.push(match);
    }
    return selected.length > 0 ? { id: question.id, selected } : { id: question.id, selected: [], custom: raw.trim() };
  }
};

// src/index.ts
var name = "dsh-tui";
var inject = [
  "agentDefaultModel",
  "agents",
  "sessions",
  "sessionPersistence",
  "userQuestions"
];
function newestSessionForCwd(headers, cwd) {
  return headers.filter((header) => header.cwd === cwd && header.origin !== "subagent").sort((left, right) => right.createdAt - left.createdAt)[0];
}
async function run(ctx, config) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("dsh-tui needs an interactive terminal; use the headless profile for scripts");
  }
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  const persistence = ctx.get("sessionPersistence");
  const userQuestions = ctx.get("userQuestions");
  const appExit = ctx.get("appExit");
  if (agents === void 0 || defaultModel === void 0 || sessions === void 0 || persistence === void 0 || userQuestions === void 0 || appExit === void 0) return;
  let ink;
  let handle;
  const controller = new TuiController(async () => {
    if (handle !== void 0) {
      if (handle.agent.status === "running") handle.agent.cancel({ kind: "user" });
      await handle.agent.whenIdle();
      await sessions.flush(handle.agent.session);
    }
    ink?.unmount();
    appExit(0);
  });
  const disposeQuestions = userQuestions.registerProvider({
    ask: (request) => controller.askQuestions(request)
  });
  const disposeApproval = ctx.on("approval/request", (request, next) => {
    if (handle === void 0 || request.agent !== handle.agent) return next();
    return controller.requestApproval(request);
  }, { prepend: true });
  const selection = defaultModel.currentSelection();
  const setup = (agentCtx) => {
    const selected = { current: selection, assembled: void 0 };
    installModelSelection(agentCtx, selected);
  };
  let resumeId = config.resumeSessionId;
  if (resumeId === void 0 && config.continueSession === true) {
    const previous = newestSessionForCwd(await persistence.list(), process.cwd());
    resumeId = previous?.id;
  }
  handle = resumeId === void 0 ? await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup
  }) : await agents.resume({
    resumeSessionId: SessionId(resumeId),
    agentOptions: { provider: selection.provider, model: selection.model },
    setup
  });
  await handle.agent.whenIdle();
  controller.bindAgent(handle.agent);
  controller.loadHistory(handle.agent.session.events);
  const disposeStatus = handle.agent.ctx.on("agent/status", ({ agent, status }) => {
    if (agent === handle?.agent) controller.setStatus(status);
  });
  const disposeEvents = handle.agent.ctx.on("session/event", (session, event) => {
    if (session === handle?.agent.session) controller.ingest(event);
  });
  ink = render(React2.createElement(App, { controller }), { exitOnCtrlC: false });
  if (config.initialPrompt !== void 0) controller.submit(config.initialPrompt);
  ctx.effect(() => async () => {
    disposeEvents();
    disposeStatus();
    disposeApproval();
    disposeQuestions();
    ink?.unmount();
    if (handle !== void 0) await handle.dispose();
  });
}
function apply(ctx, config) {
  const appExit = ctx.get("appExit");
  void run(ctx, config).catch((error) => {
    process.stderr.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}
`);
    appExit?.(1);
  });
}
var internals = { newestSessionForCwd };
export {
  apply,
  inject,
  internals,
  name
};
//# sourceMappingURL=index.js.map