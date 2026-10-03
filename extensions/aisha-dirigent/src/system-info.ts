/**
 * System information — dynamic detection of local hardware and runtime.
 *
 * Provides chip, memory, and local LLM runtime info for the AI Models view.
 * All data is gathered dynamically from OS APIs — nothing hardcoded.
 *
 * @module
 */

import { execSync } from "child_process";
import * as os from "os";

/** Chip / CPU information detected at runtime. */
export interface ChipInfo {
  /** e.g. "Apple M2 Pro", "AMD Ryzen 9 7950X", "13th Gen Intel Core i9-13900K" */
  name: string;
  /** Number of logical CPU cores. */
  cores: number;
  /** CPU architecture (arm64, x64, etc.). */
  arch: string;
  /** Total system memory in GB. */
  memoryGb: number;
  /** Whether this is an Apple Silicon chip (unified memory = better for LLM). */
  isAppleSilicon: boolean;
}

/** Runtime information for a local LLM provider. */
export interface LlmRuntimeInfo {
  provider: "ollama" | "docker-desktop" | "vllm";
  version: string | null;
}

/**
 * Detect current chip / CPU info from OS APIs.
 */
export function getChipInfo(): ChipInfo {
  const cpus = os.cpus();
  const model = cpus[0]?.model ?? "Unknown CPU";
  const arch = os.arch();
  const memoryGb = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
  const isAppleSilicon = arch === "arm64" && process.platform === "darwin";

  // On macOS, try to get the marketing chip name (e.g. "Apple M2 Pro")
  let name = model;
  if (isAppleSilicon) {
    try {
      const raw = execSync("sysctl -n machdep.cpu.brand_string", {
        timeout: 2000,
        encoding: "utf8",
      }).trim();
      if (raw) name = raw;
    } catch {
      // fallback to os.cpus() model
    }
  }

  return {
    name,
    cores: cpus.length,
    arch,
    memoryGb,
    isAppleSilicon,
  };
}

/**
 * Detect Ollama version if running locally.
 * Returns null if Ollama is not reachable.
 */
export async function getOllamaVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch("http://localhost:11434/api/version", {
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { version?: string };
      return body.version ?? null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

/**
 * Detect Docker Desktop Model Runner version.
 * Returns null if not reachable.
 */
export async function getDockerDesktopVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch("http://localhost:12434/v1/models", {
        signal: controller.signal,
      });
      // If reachable, it's running — version not always exposed
      return res.ok ? "running" : null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

/**
 * Gather all available LLM runtime info (non-blocking, best-effort).
 */
export async function getLlmRuntimes(): Promise<LlmRuntimeInfo[]> {
  const runtimes: LlmRuntimeInfo[] = [];

  const [ollamaVer, dockerVer] = await Promise.all([
    getOllamaVersion(),
    getDockerDesktopVersion(),
  ]);

  if (ollamaVer) {
    runtimes.push({ provider: "ollama", version: ollamaVer });
  }
  if (dockerVer) {
    runtimes.push({ provider: "docker-desktop", version: dockerVer });
  }

  return runtimes;
}
