#!/usr/bin/env node
/**
 * @aisha/ide-bridge CLI — entry point for `npx aisha-ide-bridge <cmd>`.
 *
 * Subcommands:
 *   init      — interactive first-run; writes ~/.aisha-ide-bridge.json
 *                config (service URL, workspaceId, IDE, rootDir). Does
 *                NOT store the JWT to disk — caller still supplies it
 *                via env / OS keychain.
 *   sync      — one-shot REST fetch + safeWrite + exit. No daemon.
 *   daemon    — start the long-running bridge with WS reconnect-with-
 *                backoff. Default subcommand when no arg given.
 *   uninstall — remove config + leave last-written file in place (user
 *                can edit freely or restore from backup).
 *
 * Token sourcing precedence:
 *   1. `AISHA_IDE_BRIDGE_TOKEN` env var (explicit, suitable for CI/dev)
 *   2. Keychain lookup is NOT in this CLI — operators wire their own
 *      keychain plumbing (macOS Keychain / libsecret / Windows Cred
 *      Manager) and export to AISHA_IDE_BRIDGE_TOKEN, OR pass
 *      tokenProvider programmatically when embedding the library.
 *
 * Per `feedback_agent_on_user_machine_safety.md`:
 *   - JWT NEVER written to a plaintext file on disk by this CLI
 *   - Service URL + IDE + workspaceId ARE config-persisted (no secrets)
 *   - First-run is opt-in (user must run `init` explicitly)
 *
 * Exit codes:
 *   0 — success
 *   1 — usage / config error
 *   2 — runtime error (network, auth, file)
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { IdeBridge, SUPPORTED_IDES, type SupportedIde, type BridgeLogger } from "./bridge.js";

/* eslint-disable security/detect-non-literal-fs-filename -- all fs ops target CONFIG_PATH, a module-level constant (homedir + literal filename); the rule false-positives on the variable identifier */

const CONFIG_PATH = path.join(os.homedir(), ".aisha-ide-bridge.json");

interface PersistedConfig {
  serviceUrl: string;
  ide: SupportedIde;
  workspaceId: string | null;
  rootDir: string;
  outputPath?: string;
}

const TOKEN_ENV = "AISHA_IDE_BRIDGE_TOKEN";

const LOGGER: BridgeLogger = {
  info: (msg) => {
    // CLI logger: structured but human-readable on stderr
    process.stderr.write(`[ide-bridge] ${stringify(msg)}\n`);
  },
  warn: (msg) => {
    process.stderr.write(`[ide-bridge:warn] ${stringify(msg)}\n`);
  },
  error: (msg) => {
    process.stderr.write(`[ide-bridge:error] ${stringify(msg)}\n`);
  },
};

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function readPersistedConfig(): PersistedConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as PersistedConfig;
  } catch {
    return null;
  }
}

function writePersistedConfig(cfg: PersistedConfig): void {
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

function getToken(): string {
  const t = process.env[TOKEN_ENV];
  if (!t || t.length === 0) {
    throw new Error(
      `Missing JWT: set ${TOKEN_ENV} env var (token MUST NOT be written to disk per safety contract).`,
    );
  }
  return t;
}

function makeBridge(cfg: PersistedConfig): IdeBridge {
  return new IdeBridge({
    serviceUrl: cfg.serviceUrl,
    workspaceId: cfg.workspaceId,
    ide: cfg.ide,
    rootDir: cfg.rootDir,
    outputPath: cfg.outputPath,
    tokenProvider: async () => getToken(),
    logger: LOGGER,
  });
}

function isSupportedIde(s: string): s is SupportedIde {
  return (SUPPORTED_IDES as ReadonlyArray<string>).includes(s);
}

function printUsage(): void {
  process.stderr.write(
    `Usage: aisha-ide-bridge <command>

Commands:
  init       Interactive first-run setup (writes ${CONFIG_PATH})
  sync       One-shot REST sync + exit
  daemon     Long-running daemon with WS reconnect-with-backoff (default)
  uninstall  Remove config (does NOT touch already-written IDE files)

Env:
  ${TOKEN_ENV}   Required for sync/daemon — JWT from Keycloak

Per safety contract, the JWT is NEVER written to disk by this CLI.
Use your OS keychain / 1Password / Doppler and export to ${TOKEN_ENV}.
`,
  );
}

async function cmdInit(args: ReadonlyArray<string>): Promise<number> {
  // Non-interactive init: read flags. (Stdin prompts kept out of scope
  // — CI/scripted callers prefer flags; an `init --interactive` mode is
  // a separate follow-up).
  const flags = parseFlags(args);
  const serviceUrl = flags.get("service-url") ?? process.env["AISHA_IDE_BRIDGE_SERVICE_URL"];
  const ide = flags.get("ide");
  const workspaceId = flags.get("workspace") ?? null;
  const rootDir = flags.get("root") ?? process.cwd();
  const outputPath = flags.get("output");

  if (!serviceUrl) {
    process.stderr.write("error: --service-url is required (or AISHA_IDE_BRIDGE_SERVICE_URL env)\n");
    return 1;
  }
  if (!ide || !isSupportedIde(ide)) {
    process.stderr.write(
      `error: --ide is required and must be one of: ${SUPPORTED_IDES.join(", ")}\n`,
    );
    return 1;
  }

  const cfg: PersistedConfig = {
    serviceUrl,
    ide,
    workspaceId,
    rootDir: path.resolve(rootDir),
    ...(outputPath ? { outputPath } : {}),
  };
  writePersistedConfig(cfg);
  process.stdout.write(`Wrote config to ${CONFIG_PATH}\n`);
  process.stdout.write(`Next: export ${TOKEN_ENV}=<jwt> && aisha-ide-bridge sync\n`);
  return 0;
}

async function cmdSync(): Promise<number> {
  const cfg = readPersistedConfig();
  if (!cfg) {
    process.stderr.write(`error: no config found. Run 'aisha-ide-bridge init …' first.\n`);
    return 1;
  }
  try {
    const bridge = makeBridge(cfg);
    const result = await bridge.syncOnce();
    process.stdout.write(
      `Sync OK: outcome=${result.outcome}, path=${result.absolutePath}, ` +
        `preservedUserSection=${String(result.preservedUserSection)}\n`,
    );
    return 0;
  } catch (err) {
    LOGGER.error(err);
    return 2;
  }
}

async function cmdDaemon(): Promise<number> {
  const cfg = readPersistedConfig();
  if (!cfg) {
    process.stderr.write(`error: no config found. Run 'aisha-ide-bridge init …' first.\n`);
    return 1;
  }
  const bridge = makeBridge(cfg);
  await bridge.start();
  LOGGER.info({ msg: "Daemon started", ide: cfg.ide, workspaceId: cfg.workspaceId });

  const shutdown = (): void => {
    LOGGER.info({ msg: "Shutting down" });
    bridge.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Hold the process open — bridge owns its own timers/sockets.
  return new Promise<number>(() => {
    // never resolves; daemon runs until SIGTERM/SIGINT
  });
}

async function cmdUninstall(): Promise<number> {
  if (existsSync(CONFIG_PATH)) {
    unlinkSync(CONFIG_PATH);
    process.stdout.write(`Removed ${CONFIG_PATH}\n`);
  }
  process.stdout.write(
    `Note: IDE instruction files were NOT touched. Restore from .aisha/backups/ if needed.\n`,
  );
  return 0;
}

function parseFlags(args: ReadonlyArray<string>): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const eqIdx = key.indexOf("=");
    if (eqIdx !== -1) {
      m.set(key.slice(0, eqIdx), key.slice(eqIdx + 1));
    } else {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        m.set(key, next);
        i++;
      } else {
        m.set(key, "true");
      }
    }
  }
  return m;
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd ?? "daemon") {
    case "init":
      return cmdInit(rest);
    case "sync":
      return cmdSync();
    case "daemon":
      return cmdDaemon();
    case "uninstall":
      return cmdUninstall();
    case "help":
    case "--help":
    case "-h":
      printUsage();
      return 0;
    default:
      process.stderr.write(`Unknown command: ${cmd ?? ""}\n`);
      printUsage();
      return 1;
  }
}

void main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    LOGGER.error(err);
    process.exit(2);
  },
);
