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

// src/controller.ts
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { applyKnobEvent } from "@deepseek-ai/dsh-permission-presets";
function permissionLabel(name2) {
  switch (name2) {
    case "read-only":
      return "Read only";
    case "workspace-write":
      return "Workspace write";
    case "danger-full-access":
      return "FULL ACCESS";
    default:
      return name2.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
var EMPTY_KNOBS = { preset: null, sandbox: null, approval: null };
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
  constructor(onExit, deps = {}) {
    this.onExit = onExit;
    this.deps = deps;
  }
  onExit;
  deps;
  state = {
    items: [],
    activeTools: [],
    status: "starting",
    title: "New session",
    sessionId: void 0,
    model: void 0,
    streamingText: "",
    reasoningText: "",
    interaction: void 0,
    notice: void 0,
    theme: "dark",
    themeSource: "fallback",
    permission: { preset: null, sandbox: null, approval: null },
    permissionPreset: "default"
  };
  listeners = /* @__PURE__ */ new Set();
  agent;
  pendingAnswer;
  exitRequested = false;
  historyItems;
  historyChanged = false;
  knobs = EMPTY_KNOBS;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.state;
  notify() {
    for (const listener of this.listeners) listener();
  }
  update(patch) {
    this.state = { ...this.state, ...patch };
    if (this.historyItems !== void 0) {
      this.historyChanged = true;
      return;
    }
    this.notify();
  }
  append(item, patch = {}) {
    if (this.historyItems !== void 0) {
      this.historyItems.push(item);
      this.update(patch);
      return;
    }
    this.update({ ...patch, items: [...this.state.items, item] });
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
  setTheme(theme) {
    this.update({
      theme: theme.resolved,
      themeSource: theme.source
    });
  }
  loadHistory(events) {
    if (events.length === 0) return;
    this.historyItems = [...this.state.items];
    this.historyChanged = false;
    try {
      for (const event of events) this.ingest(event);
    } finally {
      const items = this.historyItems;
      const changed = this.historyChanged;
      this.historyItems = void 0;
      this.historyChanged = false;
      this.state = { ...this.state, items };
      if (changed) this.notify();
    }
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
        if (finalText !== "") {
          this.append(
            { id: `event-${event.seq}`, kind: "assistant", text: finalText },
            { streamingText: "", reasoningText: "" }
          );
        } else {
          this.update({ streamingText: "", reasoningText: "" });
        }
        break;
      }
      case "tool/call": {
        const callId = String(data.callId ?? event.seq);
        const toolName = String(data.name ?? "tool");
        const detail = typeof data.arguments === "string" ? truncate(data.arguments) : "";
        const item = {
          id: `tool-${callId}`,
          kind: "tool",
          name: toolName,
          detail,
          status: "running"
        };
        this.update({ activeTools: [...this.state.activeTools, item] });
        break;
      }
      case "tool/result": {
        const message = data.message;
        const source = message?.source;
        const callId = String(source?.callId ?? data.callId ?? "");
        const id = `tool-${callId}`;
        const resultText = truncate(contentText(message));
        const failed = data.error !== void 0;
        const pending = this.state.activeTools.find((item) => item.id === id);
        if (pending === void 0) break;
        const completed = {
          id,
          kind: "tool",
          name: pending.name,
          detail: resultText || pending.detail,
          status: failed ? "error" : "done"
        };
        this.append(completed, {
          activeTools: this.state.activeTools.filter((item) => item.id !== id)
        });
        break;
      }
      case "turn/end": {
        const reason = data.reason;
        const patch = { streamingText: "", reasoningText: "" };
        if (reason?.kind === "error") {
          const error = reason.error;
          this.append(
            {
              id: `event-${event.seq}`,
              kind: "system",
              text: `Turn failed: ${String(error?.message ?? "unknown error")}`
            },
            patch
          );
        } else {
          this.update(patch);
        }
        break;
      }
      case "permission/preset": {
        this.knobs = applyKnobEvent(this.knobs, event);
        const preset = String(data.preset ?? "");
        this.update({
          permission: this.permissionState(),
          permissionPreset: this.currentPreset(),
          ...this.state.notice === `Switching permission to ${preset}\u2026` ? { notice: void 0 } : {}
        });
        break;
      }
      case "sandbox/mode":
      case "approval/policy": {
        this.knobs = applyKnobEvent(this.knobs, event);
        this.update({
          permission: this.permissionState(),
          permissionPreset: this.currentPreset()
        });
        break;
      }
    }
  }
  permissionState() {
    return {
      preset: this.knobs.preset,
      sandbox: this.knobs.sandbox,
      approval: this.knobs.approval
    };
  }
  /** The preset to display: last selected preset, derived `custom`, or `default` before any override. */
  currentPreset() {
    if (this.knobs.preset !== null) return this.knobs.preset;
    if (this.knobs.sandbox !== null || this.knobs.approval !== null) return "custom";
    return "default";
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
      const permission = this.currentPreset();
      const sandbox = this.state.permission.sandbox ?? "default";
      const approval = this.state.permission.approval ?? "default";
      this.append({
        id: `status-${Date.now()}`,
        kind: "system",
        text: `session ${this.state.sessionId ?? "starting"} \xB7 ${this.state.model ?? "model pending"} \xB7 ${this.state.status} \xB7 theme ${this.state.theme} (${this.state.themeSource}) \xB7 permission ${permission} \xB7 sandbox ${sandbox} \xB7 approval ${approval}`
      });
      return;
    }
    if (text === "/permission" || text.startsWith("/permission ")) {
      const raw = text.slice("/permission".length).trim();
      void this.permissionCommand(raw);
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
  /** `/permission` — bare opens a numbered picker, an argument switches directly (idle only). */
  async permissionCommand(raw) {
    if (this.agent === void 0) return;
    if (this.agent.status === "running") {
      this.update({ notice: "Switch permission while idle \u2014 cancel the current turn first" });
      return;
    }
    const names = this.deps.permissionPresets?.names ?? [];
    if (names.length === 0) {
      this.update({ notice: "/permission unavailable (permission presets service missing)" });
      return;
    }
    if (raw === void 0 || raw === "") {
      await this.permissionPicker(names);
      return;
    }
    const name2 = names.find((candidate) => candidate === raw);
    if (name2 === void 0) {
      this.update({ notice: `unknown preset "${raw}" (available: ${names.join(", ")})` });
      return;
    }
    await this.confirmAndSwitch(name2);
  }
  async permissionPicker(names) {
    const decorated = names.map((name3, index2) => `${index2 + 1} ${permissionLabel(name3)}`);
    const answer = normalizeAnswer(await this.askForInput({
      kind: "permission",
      title: "Permission for this session",
      detail: `current ${permissionLabel(this.currentPreset())}`,
      options: decorated
    }));
    if (answer === "__cancelled__") return;
    const index = Number.parseInt(answer, 10);
    const byNumber = Number.isSafeInteger(index) ? names[index - 1] : void 0;
    const byLabel = names.find((name3) => normalizeAnswer(permissionLabel(name3)) === answer || name3 === answer);
    const name2 = byNumber ?? byLabel;
    if (name2 === void 0) {
      this.update({ notice: `unknown choice "${answer}"` });
      return;
    }
    await this.confirmAndSwitch(name2);
  }
  async confirmAndSwitch(name2) {
    if (name2 === "danger-full-access") {
      const answer = normalizeAnswer(await this.askForInput({
        kind: "permission-confirm",
        title: "Enable FULL ACCESS for this session?",
        detail: 'The file sandbox will no longer restrict writes. Approval policy becomes "never"; approval requests are rejected instead of shown. Type FULL ACCESS to confirm, or anything else to cancel.',
        options: ["type FULL ACCESS to confirm", "anything else to cancel"]
      }));
      if (answer === "__cancelled__" || answer !== "full access") {
        this.update({ notice: "Full access cancelled" });
        return;
      }
    }
    await this.switchPermission(name2);
  }
  /** The official `/permission` command owns the switch: audit events, validation, and transition notices stay in DSH. */
  async switchPermission(name2) {
    if (this.agent === void 0) return;
    if (this.currentPreset() === name2) {
      this.update({ notice: `permission already ${name2}` });
      return;
    }
    const commands = this.deps.commands;
    if (commands === void 0) {
      this.update({ notice: "/permission unavailable (commands service missing)" });
      return;
    }
    this.update({ notice: `Switching permission to ${name2}\u2026` });
    try {
      const execution = await commands.execute(this.agent, `/permission ${name2}`, new AbortController().signal);
      const result = execution?.result;
      if (result !== void 0 && result.kind === "error") {
        this.update({ notice: result.text ?? `permission switch to ${name2} failed` });
      }
    } catch (error) {
      this.update({ notice: `permission switch failed: ${error instanceof Error ? error.message : String(error)}` });
    }
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

// src/theme.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { spawnSync } from "child_process";
var themePalettes = {
  dark: {
    brand: "magentaBright",
    user: "cyanBright",
    success: "greenBright",
    error: "redBright",
    warning: "yellowBright",
    muted: "gray",
    border: "gray"
  },
  light: {
    brand: "magenta",
    user: "cyan",
    success: "green",
    error: "red",
    warning: "yellow",
    muted: "gray",
    border: "gray"
  }
};
function parsePreference(value, label) {
  if (value === "system" || value === "light" || value === "dark") return value;
  throw new Error(`${label} must be one of "system", "light", or "dark"`);
}
function themeConfigPath(env = process.env) {
  const dshHome = env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(dshHome, "tui.json");
}
function loadThemePreference(env = process.env) {
  const configPath = themeConfigPath(env);
  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true, mode: 448 });
    try {
      writeFileSync(configPath, '{\n  "theme": "system"\n}\n', { flag: "wx", mode: 384 });
    } catch (error) {
      const code = error.code;
      if (code !== "EEXIST") throw error;
    }
  }
  const environment = env.DSH_TUI_THEME;
  if (environment !== void 0) {
    return {
      preference: parsePreference(environment, "DSH_TUI_THEME"),
      configPath,
      explicitEnvironment: true
    };
  }
  let document;
  try {
    document = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read theme config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`theme config ${configPath} must contain a JSON object`);
  }
  const configured = parsePreference(document.theme ?? "system", `${configPath}: theme`);
  return { preference: configured, configPath, explicitEnvironment: false };
}
function normalizedChannel(hex) {
  const parsed = Number.parseInt(hex, 16);
  const maximum = 16 ** hex.length - 1;
  if (!Number.isFinite(parsed) || maximum <= 0) return void 0;
  return parsed / maximum;
}
function relativeLuminance(red, green, blue) {
  const linear = (channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}
function parseOsc11Theme(response) {
  const rgb = /(?:\u001B\]11;)?rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(response);
  let channels;
  if (rgb !== null) {
    const red = normalizedChannel(rgb[1]);
    const green = normalizedChannel(rgb[2]);
    const blue = normalizedChannel(rgb[3]);
    if (red !== void 0 && green !== void 0 && blue !== void 0) channels = [red, green, blue];
  } else {
    const hex = /(?:\u001B\]11;)?#([0-9a-f]{6})/i.exec(response)?.[1];
    if (hex !== void 0) {
      channels = [
        Number.parseInt(hex.slice(0, 2), 16) / 255,
        Number.parseInt(hex.slice(2, 4), 16) / 255,
        Number.parseInt(hex.slice(4, 6), 16) / 255
      ];
    }
  }
  if (channels === void 0) return void 0;
  return relativeLuminance(...channels) >= 0.4 ? "light" : "dark";
}
async function probeTerminalTheme(input = process.stdin, output = process.stdout, timeoutMs = 100) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") return void 0;
  return new Promise((resolve) => {
    const wasRaw = input.isRaw === true;
    const wasPaused = input.isPaused();
    let buffer = "";
    let settled = false;
    let timer;
    const finish = (theme) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off("data", onData);
      if (!wasRaw) input.setRawMode(false);
      if (wasPaused) input.pause();
      resolve(theme);
    };
    const onData = (chunk) => {
      buffer += chunk.toString();
      const theme = parseOsc11Theme(buffer);
      if (theme !== void 0) finish(theme);
    };
    input.setRawMode(true);
    input.on("data", onData);
    input.resume();
    timer = setTimeout(() => finish(void 0), timeoutMs);
    output.write("\x1B]11;?\x1B\\");
  });
}
function colorFgBgTheme(value) {
  const background = Number.parseInt(value?.split(";").at(-1) ?? "", 10);
  if (!Number.isSafeInteger(background) || background < 0 || background > 15) return void 0;
  return background === 0 || background >= 1 && background <= 6 || background === 8 ? "dark" : "light";
}
function macOSSystemTheme() {
  if (process.platform !== "darwin") return void 0;
  const result = spawnSync("/usr/bin/defaults", ["read", "-g", "AppleInterfaceStyle"], {
    encoding: "utf8",
    timeout: 250,
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.error !== void 0) return void 0;
  return result.status === 0 && result.stdout.trim().toLocaleLowerCase() === "dark" ? "dark" : "light";
}
async function resolveTheme(env = process.env) {
  const loaded = loadThemePreference(env);
  if (loaded.preference !== "system") {
    return {
      resolved: loaded.preference,
      source: loaded.explicitEnvironment ? "env" : "config"
    };
  }
  const terminal = await probeTerminalTheme();
  if (terminal !== void 0) {
    return { resolved: terminal, source: "terminal" };
  }
  const colorEnvironment = colorFgBgTheme(env.COLORFGBG);
  if (colorEnvironment !== void 0) {
    return { resolved: colorEnvironment, source: "terminal" };
  }
  const system = macOSSystemTheme();
  return {
    resolved: system ?? "dark",
    source: system === void 0 ? "fallback" : "system"
  };
}

// src/app.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function TranscriptRow({ item, palette }) {
  if (item.kind === "user") {
    return /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: palette.user, children: "\u203A " }),
      /* @__PURE__ */ jsx(Text, { children: item.text })
    ] });
  }
  if (item.kind === "assistant") {
    return /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { color: palette.success, children: "\u25C6" }),
      " ",
      item.text
    ] }) });
  }
  if (item.kind === "system") {
    return /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsxs(Text, { color: palette.muted, children: [
      "  ",
      item.text
    ] }) });
  }
  const marker = item.status === "running" ? "\u25CC" : item.status === "error" ? "\xD7" : "\u2713";
  const color = item.status === "running" ? palette.warning : item.status === "error" ? palette.error : palette.muted;
  return /* @__PURE__ */ jsxs(Box, { children: [
    /* @__PURE__ */ jsxs(Text, { color, children: [
      marker,
      " ",
      item.name
    ] }),
    item.detail === "" ? null : /* @__PURE__ */ jsxs(Text, { color: palette.muted, children: [
      "  ",
      item.detail
    ] })
  ] });
}
function App({ controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const palette = themePalettes[state.theme];
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (key.ctrl && input === "c") controller.cancelOrExit();
  });
  const submit = (text) => {
    controller.submit(text);
    setValue("");
  };
  const prompt = state.interaction;
  const promptLabel = prompt === void 0 ? state.status === "running" ? "steer \u203A " : "you \u203A " : prompt.kind === "approval" ? "allow \u203A " : prompt.kind === "permission" || prompt.kind === "permission-confirm" ? "permission \u203A " : "answer \u203A ";
  const preset = state.permissionPreset;
  const fullAccess = preset === "danger-full-access";
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx(Box, { borderStyle: "round", borderColor: palette.border, paddingX: 1, children: /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { bold: true, color: palette.brand, children: "dsh-tui" }),
      /* @__PURE__ */ jsxs(Text, { color: palette.muted, children: [
        " \xB7 ",
        state.title,
        " \xB7 ",
        state.model ?? "loading",
        " \xB7 ",
        state.status
      ] })
    ] }) }),
    /* @__PURE__ */ jsx(Static, { items: state.items, children: (item) => /* @__PURE__ */ jsx(TranscriptRow, { item, palette }, item.id) }),
    state.activeTools.map((item) => /* @__PURE__ */ jsx(TranscriptRow, { item, palette }, item.id)),
    state.reasoningText === "" ? null : /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsxs(Text, { color: palette.muted, children: [
      "thinking  ",
      state.reasoningText
    ] }) }),
    state.streamingText === "" ? null : /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: palette.success, children: "\u25C6 " }),
      /* @__PURE__ */ jsx(Text, { children: state.streamingText })
    ] }),
    prompt === void 0 ? null : /* @__PURE__ */ jsxs(Box, { marginTop: 1, flexDirection: "column", borderStyle: "single", borderColor: palette.warning, paddingX: 1, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, color: palette.warning, children: prompt.title }),
      prompt.detail === void 0 ? null : /* @__PURE__ */ jsx(Text, { children: prompt.detail }),
      /* @__PURE__ */ jsxs(Text, { color: palette.muted, children: [
        prompt.options.join("  \xB7  "),
        prompt.multiSelect === true ? "  (comma separated)" : ""
      ] })
    ] }),
    state.notice === void 0 ? null : /* @__PURE__ */ jsx(Text, { color: palette.muted, children: state.notice }),
    /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: prompt === void 0 ? palette.user : palette.warning, children: promptLabel }),
      /* @__PURE__ */ jsx(TextInput, { value, onChange: setValue, onSubmit: submit })
    ] }),
    /* @__PURE__ */ jsxs(Text, { color: palette.muted, children: [
      preset === "default" ? null : /* @__PURE__ */ jsxs(Text, { color: fullAccess ? palette.warning : palette.muted, bold: fullAccess, children: [
        permissionLabel(preset),
        " \xB7 "
      ] }),
      "Ctrl+C ",
      state.status === "running" ? "cancel" : "exit",
      " \xB7 /help"
    ] })
  ] });
}

// src/herdr.ts
import { spawn } from "child_process";
var SOURCE = "dsh-tui";
var AGENT = "deepseek";
function runHerdr(args, env) {
  return new Promise((resolve) => {
    const child = spawn("herdr", args, { env, stdio: "ignore" });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, 1e3);
    child.once("error", finish);
    child.once("exit", finish);
  });
}
function agentState(snapshot) {
  if (snapshot.interaction !== void 0) return "blocked";
  if (snapshot.status === "idle") return "idle";
  return "working";
}
var HerdrBridge = class {
  enabled;
  paneId;
  runner;
  queue = Promise.resolve();
  sequence = BigInt(Date.now()) * 1000000n;
  lastState;
  lastSessionId;
  lastTitle;
  disposed = false;
  constructor(env = process.env, runner = (args) => runHerdr(args, env)) {
    this.paneId = env.HERDR_PANE_ID?.trim() ?? "";
    this.enabled = env.HERDR_ENV === "1" && this.paneId !== "" && (env.HERDR_SOCKET_PATH?.trim() ?? "") !== "";
    this.runner = runner;
  }
  enqueue(args) {
    this.sequence += 1n;
    const command = [...args, "--seq", String(this.sequence)];
    this.queue = this.queue.then(() => this.runner(command)).catch(() => {
    });
    return this.queue;
  }
  sync(snapshot) {
    if (!this.enabled || this.disposed) return this.queue;
    const state = agentState(snapshot);
    if (state !== this.lastState) {
      this.lastState = state;
      void this.enqueue([
        "pane",
        "report-agent",
        this.paneId,
        "--source",
        SOURCE,
        "--agent",
        AGENT,
        "--state",
        state
      ]);
    }
    if (snapshot.sessionId !== void 0 && snapshot.sessionId !== this.lastSessionId) {
      this.lastSessionId = snapshot.sessionId;
      void this.enqueue([
        "pane",
        "report-agent-session",
        this.paneId,
        "--source",
        SOURCE,
        "--agent",
        AGENT,
        "--agent-session-id",
        snapshot.sessionId
      ]);
    }
    const title = snapshot.title.trim().slice(0, 120);
    if (snapshot.sessionId !== void 0 && title !== "" && title !== this.lastTitle) {
      this.lastTitle = title;
      void this.enqueue([
        "pane",
        "report-metadata",
        this.paneId,
        "--source",
        SOURCE,
        "--agent",
        AGENT,
        "--display-agent",
        "DeepSeek",
        "--title",
        title
      ]);
    }
    return this.queue;
  }
  dispose() {
    if (!this.enabled || this.disposed) return this.queue;
    this.disposed = true;
    return this.enqueue([
      "pane",
      "release-agent",
      this.paneId,
      "--source",
      SOURCE,
      "--agent",
      AGENT
    ]);
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
  let newest;
  for (const header of headers) {
    if (header.cwd !== cwd || header.origin === "subagent") continue;
    if (newest === void 0 || header.createdAt > newest.createdAt) newest = header;
  }
  return newest;
}
async function run(ctx, config) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("dsh-tui needs an interactive terminal; use the headless profile for scripts");
  }
  const theme = await resolveTheme();
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
  const herdr = new HerdrBridge();
  const permissionPresets = ctx.get("permissionPresets");
  const commands = ctx.get("commands");
  const controller = new TuiController(async () => {
    if (handle !== void 0) {
      if (handle.agent.status === "running") handle.agent.cancel({ kind: "user" });
      await handle.agent.whenIdle();
      await sessions.flush(handle.agent.session);
    }
    ink?.unmount();
    await herdr.dispose();
    appExit(0);
  }, {
    ...permissionPresets === void 0 ? {} : { permissionPresets: { names: permissionPresets.names } },
    ...commands === void 0 ? {} : {
      commands: {
        execute: (agent, line, signal) => commands.execute(agent, line, signal)
      }
    }
  });
  controller.setTheme(theme);
  const disposeHerdr = controller.subscribe(() => {
    void herdr.sync(controller.snapshot());
  });
  void herdr.sync(controller.snapshot());
  ctx.effect(() => async () => {
    disposeHerdr();
    await herdr.dispose();
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
  controller.loadHistory(handle.agent.session.events);
  controller.bindAgent(handle.agent);
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
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map