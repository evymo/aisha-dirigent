#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import { ROOT } from "./config.mjs";

function ensureDirectory(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export async function runCommand(command, args = [], options = {}) {
  const capture = options.capture === true;
  const cwd = options.cwd ?? ROOT;
  const env = { ...process.env, ...options.env };
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    let stdout = "";
    let stderr = "";

    if (capture) {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        command,
        args,
        code: code ?? 1,
        ok: code === 0,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

export async function runShell(command, options = {}) {
  const isWindows = process.platform === "win32";
  if (isWindows) {
    return runCommand("cmd", ["/d", "/s", "/c", command], options);
  }

  return runCommand("/bin/zsh", ["-lc", command], options);
}

export function writeAuditTrace(workflow, trace) {
  const auditDir = path.join(ROOT, ".evymo", "audit");
  ensureDirectory(auditDir);

  const runId = trace.runId ?? "unknown-run";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(auditDir, `${stamp}-${workflow}-${runId}.json`);

  writeFileSync(filePath, JSON.stringify(trace, null, 2) + "\n");
  return filePath;
}
