#!/usr/bin/env node

// src/bin.ts
import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// src/restart.ts
function parseRestartMessage(value) {
  if (value === null || typeof value !== "object") return void 0;
  const message = value;
  if (message.type !== "dsh-tui/restart") return void 0;
  const request = message.request;
  if (request === null || typeof request !== "object") return void 0;
  const record = request;
  if (record.kind === "new") return { kind: "new" };
  if (record.kind === "resume" && typeof record.id === "string" && record.id.trim() !== "") {
    return { kind: "resume", id: record.id };
  }
  return void 0;
}
function restartArgs(request) {
  return request.kind === "new" ? [] : ["--resume", request.id];
}

// src/bin.ts
var packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
var dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
var profileManifest = join(dshHome, "profiles", "tui", "package.json");
var installedManifest = join(dshHome, "profiles", "tui", "node_modules", "dsh-tui", "package.json");
var packageVersion = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version;
function profileHasTui() {
  if (!existsSync(profileManifest)) return false;
  try {
    const manifest = JSON.parse(readFileSync(profileManifest, "utf8"));
    const installed = JSON.parse(readFileSync(installedManifest, "utf8"));
    return manifest.dependencies?.["dsh-tui"] !== void 0 && manifest.dsh?.profile?.bundles?.includes("dsh-tui") === true && installed.version === packageVersion;
  } catch {
    return false;
  }
}
if (!profileHasTui()) {
  process.stderr.write("dsh-tui: setting up the local DSH tui profile...\n");
  const install = spawnSync(
    "dsh",
    ["plugin", "--profile", "tui", "add", `file:${packageRoot}`],
    { stdio: "inherit" }
  );
  if (install.error !== void 0) {
    process.stderr.write(`dsh-tui: could not run dsh: ${install.error.message}
`);
    process.exit(127);
  }
  if (install.status !== 0) process.exit(install.status ?? 1);
}
function launch(args) {
  let restart;
  const child = spawn("dsh", ["--profile", "tui", ...args], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: process.env
  });
  child.on("message", (message) => {
    restart ??= parseRestartMessage(message);
  });
  child.on("error", (error) => {
    process.stderr.write(`dsh-tui: could not run dsh: ${error.message}
`);
    process.exitCode = 127;
  });
  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    if (restart !== void 0 && code === 0) {
      process.stdout.write("\x1B[2J\x1B[H");
      launch(restartArgs(restart));
      return;
    }
    process.exitCode = code ?? 1;
  });
}
launch(process.argv.slice(2));
//# sourceMappingURL=bin.js.map