import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * Component 4 (AISHA spawns Claude CLI) — E1 DB foundation contract.
 *
 * Guards the execution-plane wiring that lets AISHA enqueue a Claude CLI run:
 *  - agent_runs.kind accepts 'claude_cli_task'
 *  - agent_runs carries an `inputs jsonb` (prompt/story context)
 *  - fn_spawn_claude_cli_run enforces story-scoped spend admission + audit + JIT user
 *  - the cost catalog seed registers a 'claude_cli_task' band
 *
 * Later E2–E7 assertions (monitoring link, runner kind, producer) extend this file.
 */

const ROOT = process.cwd();
function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

describe("Component 4 E1 — claude_cli_task DB foundation", () => {
  const agentRuns = read("aisha/db/sql/tables/agent_runs.sql");
  const spawnFn = read("aisha/db/sql/functions/fn_spawn_claude_cli_run.sql");
  const costSeed = read("aisha/db/seed/core/29_ai_cost_class_catalog.sql");

  test("agent_runs.kind CHECK admits claude_cli_task", () => {
    const kindCheck = agentRuns
      .split("\n")
      .find((l) => l.includes("agent_runs_kind_check"));
    expect(kindCheck, "kind CHECK constraint present").toBeTruthy();
    expect(kindCheck).toContain("'claude_cli_task'");
    // existing kinds must remain (no regression)
    for (const k of ["plugin-exec", "workflow-exec", "repo-agent", "doc-agent"]) {
      expect(kindCheck).toContain(`'${k}'`);
    }
  });

  test("agent_runs carries an inputs jsonb column for the prompt/story context", () => {
    expect(agentRuns).toMatch(/^\s*inputs\s+jsonb\b/m);
  });

  test("fn_spawn_claude_cli_run is SECURITY DEFINER, hardwires the kind, and is grant-scoped", () => {
    expect(spawnFn).toContain("CREATE OR REPLACE FUNCTION public.fn_spawn_claude_cli_run");
    expect(spawnFn).toContain("SECURITY DEFINER");
    expect(spawnFn).toMatch(/SET search_path TO 'public'/);
    // inserts the hardwired kind
    expect(spawnFn).toContain("'claude_cli_task'");
    expect(spawnFn).toMatch(/INSERT INTO public\.agent_runs/);
    // least-privilege grant (no PUBLIC)
    expect(spawnFn).toMatch(/REVOKE ALL ON FUNCTION public\.fn_spawn_claude_cli_run/);
    expect(spawnFn).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_spawn_claude_cli_run.*TO authenticated/s);
  });

  test("fn_spawn_claude_cli_run gates on E0 admission (fn_admit_clow): deny refuses, ask holds, every dispatch journals", () => {
    // Upgraded from the spend-only fn_authorize_task_spend to the composed E0
    // admission (spend + runtime-availability + capability + risk) — same intent
    // (the spawn is admission-gated + refuses loudly), stronger mechanism.
    expect(spawnFn).toContain("fn_admit_clow(");
    // deny → refuse loudly (P0001); ask → the run is created but HELD pending approval.
    expect(spawnFn).toMatch(/v_verdict\s*=\s*'deny'/);
    expect(spawnFn).toContain("ERRCODE = 'P0001'");
    expect(spawnFn).toMatch(/approval_required/);
    // I1 — every dispatch mints the ai_decisions journal row (threaded onto the run).
    expect(spawnFn).toContain("fn_record_execution_decision(");
  });

  test("fn_spawn_claude_cli_run JIT-provisions the caller (FK safety) and audits", () => {
    expect(spawnFn).toContain("ensure_current_user()");
    expect(spawnFn).toMatch(/INSERT INTO public\.audit_journal/);
    expect(spawnFn).toContain("'agent_run.spawned'");
  });

  test("fn_spawn_claude_cli_run requires a prompt in p_inputs", () => {
    expect(spawnFn).toMatch(/p_inputs->>'prompt'/);
    expect(spawnFn).toContain("ERRCODE = '22023'");
  });

  test("cost catalog seed registers a claude_cli_task band", () => {
    const bandLine = costSeed
      .split("\n")
      .find((l) => l.includes("'claude_cli_task'"));
    expect(bandLine, "claude_cli_task band present in catalog seed").toBeTruthy();
    // it should be a 'large' band (long-running, code-changing CLI work)
    expect(bandLine).toContain("'large'");
  });
});

describe("Component 4 E3 — claude agent base image", () => {
  const dockerfile = read("Dockerfile.agent-claude");
  const entrypointPath = join(ROOT, "docker/agent-claude/entrypoint.sh");
  const entrypoint = read("docker/agent-claude/entrypoint.sh");

  test("Dockerfile.agent-claude installs the official Claude Code CLI and bakes no secrets", () => {
    expect(dockerfile).toContain("@anthropic-ai/claude-code");
    expect(dockerfile).toContain("docker/agent-claude/entrypoint.sh");
    // runs non-root
    expect(dockerfile).toMatch(/USER\s+agent/);
    // must NOT bake an API key / token into the image
    expect(dockerfile).not.toMatch(/ANTHROPIC_API_KEY\s*=/);
    expect(dockerfile).not.toMatch(/(sk-ant-|AISHA_MCP_TOKEN\s*=)/);
  });

  test("entrypoint launches a headless streaming Claude run", () => {
    expect(entrypoint).toMatch(/claude -p/);
    expect(entrypoint).toContain("--output-format stream-json");
    expect(entrypoint).toContain("--verbose"); // required with stream-json in -p mode
  });

  test("entrypoint links the live session to the run (exports AISHA_AGENT_RUN_ID for the relay)", () => {
    expect(entrypoint).toMatch(/export AISHA_AGENT_RUN_ID=/);
    expect(entrypoint).toMatch(/AISHA_RUN_ID/);
  });

  test("entrypoint resolves a prompt and gates git push behind an explicit opt-in", () => {
    expect(entrypoint).toMatch(/AISHA_PROMPT/);
    expect(entrypoint).toMatch(/AISHA_GIT_PUSH/);
    // push is opt-in (default off) so a misconfigured run can't push silently
    expect(entrypoint).toMatch(/\$\{AISHA_GIT_PUSH:-0\}/);
  });

  test("entrypoint is executable", () => {
    expect(existsSync(entrypointPath)).toBe(true);
    // owner execute bit set
    expect(statSync(entrypointPath).mode & 0o100).toBe(0o100);
  });
});

describe("Component 4 E4 — svc-agent-runner claude_cli_task backend", () => {
  const runs = read("services/svc-agent-runner/src/routes/runs.ts");
  const backend = read("services/svc-agent-runner/src/backends/claude-cli.ts");
  const cfg = read("services/svc-agent-runner/src/config.ts");
  const runnerDockerfile = read("Dockerfile.svc-agent-runner");
  const execCompose = read("docker-compose.coolify-exec.yml");

  test("runner accepts claude_cli_task and routes it through the spawn RPC + ClaudeCliBackend", () => {
    expect(runs).toMatch(/validKinds\s*=\s*\[[^\]]*'claude_cli_task'/s);
    expect(runs).toContain("fn_spawn_claude_cli_run");
    expect(runs).toContain("ClaudeCliBackend");
    // plugin path must remain on enqueue_agent_run (no regression)
    expect(runs).toContain("enqueue_agent_run");
  });

  test("claude_cli_task gets its own (large) timeout ceiling, not the plugin maxTimeout", () => {
    // claude path uses the DYNAMIC caps timeout; the plugin path keeps config.maxTimeoutMs
    expect(runs).toMatch(/caps!?\.cliTimeoutMs/);
    expect(runs).toContain("config.maxTimeoutMs");
  });

  test("ClaudeCliBackend klonuje repo per běh (clone → bind HOSTITELSKÉ cesty R/W → smazání)", () => {
    // Od 2026-09-24: žádný sdílený base-repo ani worktrees (nikdo ho neplnil, :ro
    // mount git worktree add znemožnil). Dítě dostává v Binds cestu HOSTITELE —
    // runner sám pracuje v pevném adresáři kontejneru (Coolify ${ v cíli svazku odmítá).
    expect(backend).toMatch(/'clone',\s*'--filter=blob:none'/);
    expect(backend).not.toMatch(/worktree',\s*'add'/);
    expect(backend).toContain("pripojeniBehu(await mountyRunneru()");
    expect(backend).toContain("mounts: [mount]");
    expect(backend).not.toContain("cesty.hostitel");
    // token ke klonu jen v env procesu, ne v argumentech ani v URL
    expect(backend).toContain("GIT_CONFIG_VALUE_0");
    expect(backend).not.toMatch(/https?:\/\/[^'`\s]*\$\{[^}]*[Tt]oken/);
  });

  test("ClaudeCliBackend injects the relay + LLM-routing env from config (no hardcoded URLs/tokens/keys)", () => {
    // env keys are present...
    for (const k of ["AISHA_AGENT_RUN_ID", "AISHA_GATEWAY_URL", "AISHA_MCP_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY"]) {
      expect(backend).toContain(k);
    }
    // ...and their VALUES come from config, never literal URLs/keys
    expect(backend).toContain("config.agentGatewayUrl");
    expect(backend).toContain("config.anthropicBaseUrl");
    expect(backend).not.toMatch(/https?:\/\/[a-z0-9.-]+\.(guru|cz|network|com)/i);
    expect(backend).not.toMatch(/sk-ant-/);
  });

  test("E4 config knobs are entirely env-driven (no fixed prod values, secrets default empty)", () => {
    for (const knob of [
      "AGENT_RUNS_DIR", "AGENT_GIT_REMOTE", "AGENT_CLAUDE_IMAGE", "CLAUDE_CLI_TIMEOUT_MS",
      "ANTHROPIC_BASE_URL", "AGENT_GIT_TOKEN",
    ]) {
      expect(cfg, `${knob} must be read from process.env`).toContain(`process.env.${knob}`);
    }
    // secrets must NOT carry a non-empty literal default
    expect(cfg).toMatch(/agentMcpToken:[^\n]*\?\?\s*''/);
  });

  // 2026-10-02 (pověření poskytovatelů v administraci): API klíč Anthropic NENÍ knob
  // configu načtený při startu — čte se V OKAMŽIKU BĚHU z trezoru instance (čtečka
  // @aisha/security, administrace „Poskytovatelé AI a tokeny"), aby si každý fork
  // nastavil vlastní a výměna platila bez restartu. Literál klíče dál nikde.
  test("ANTHROPIC_API_KEY se čte při běhu ze čtečky pověření, ne z configu načteného při startu", () => {
    expect(cfg).not.toContain("process.env.ANTHROPIC_API_KEY");
    expect(backend).toMatch(/credentials\.getMany\(/);
    expect(backend).toContain("'ANTHROPIC_API_KEY'");
    expect(backend).toMatch(/optional\('ANTHROPIC_API_KEY',\s*auth\.anthropicApiKey/);
  });

  test("runner image installs git; exec compose mounts the instance runs dir onto the runner's container dir", () => {
    expect(runnerDockerfile).toMatch(/apk add[^\n]*git/);
    // Zdroj = per-instance hostitelská cesta (${AGENT_RUNS_DIR}), cíl = TÝŽ pevný
    // adresář, se kterým runner počítá (config.agentRunsContainerDir) — jediný
    // kontrakt mezi compose a kódem, proto se čte z configu, ne opisuje.
    const cilKontejneru = /agentRunsContainerDir:\s*'([^']+)'/.exec(cfg)?.[1];
    expect(cilKontejneru, "config.agentRunsContainerDir chybí").toBeDefined();
    expect(execCompose).toContain(`agent-runs:${cilKontejneru}:rw`);
    expect(execCompose).toContain("Dockerfile.agent-claude");
    expect(execCompose).toContain("agent-claude-tag:");
    // sdílený base-repo je pryč (běh si repo klonuje sám)
    expect(execCompose).not.toMatch(/base-repo|AGENT_REPO_PATH/);
  });
});

describe("Component 4 E2 — monitoring link (agent_run_id propagation)", () => {
  const relayTemplate = read("scripts/ide-adapters/templates/claude-overlay/aisha-supervisor-relay.mjs.txt");
  const relayGenerated = read(".claude/hooks/aisha-supervisor-relay.mjs");
  const route = read("services/svc-ai-chat/src/routes/dirigent-supervisor.ts");

  test("relay template reads AISHA_AGENT_RUN_ID and puts agent_run_id in the live_session payload", () => {
    expect(relayTemplate).toContain("process.env.AISHA_AGENT_RUN_ID");
    expect(relayTemplate).toMatch(/agent_run_id:\s*agentRunId/);
    // optional source override for spawned runs
    expect(relayTemplate).toContain("process.env.AISHA_SOURCE");
  });

  test("generated relay carries the propagation (overlay regenerated, not hand-edited)", () => {
    expect(relayGenerated).toContain("AISHA_AGENT_RUN_ID");
    expect(relayGenerated).toMatch(/agent_run_id:\s*agentRunId/);
  });

  test("dispatch route forwards agent_run_id through to fn_upsert_agent_live_session", () => {
    // typed on the inbound context
    expect(route).toMatch(/agent_run_id\?:\s*string\s*\|\s*null/);
    // passed to the RPC (the column + RPC param already exist)
    expect(route).toContain("p_agent_run_id: args.agent_run_id");
    // forwarded from the relay body (untrusted user_id still overridden by JWT)
    expect(route).toMatch(/agent_run_id:\s*ls\.agent_run_id\s*\?\?\s*null/);
  });
});

describe("Component 4 E7 — local verification harness", () => {
  const harnessPath = join(ROOT, "scripts/e2e/claude-cli-local-test.sh");
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

  test("reproducible local harness exists, is executable, and is env-driven (no hardcoded values)", () => {
    expect(existsSync(harnessPath)).toBe(true);
    expect(statSync(harnessPath).mode & 0o100).toBe(0o100);
    const harness = read("scripts/e2e/claude-cli-local-test.sh");
    // exercises the full loop
    expect(harness).toContain("fn_spawn_claude_cli_run");
    expect(harness).toContain("fn_upsert_agent_live_session");
    expect(harness).toContain("list_active_agent_sessions");
    expect(harness).toContain("Dockerfile.agent-claude");
    // config-driven knobs (no fixed DB/image/gateway literals)
    for (const knob of ["CLAUDE_CLI_TEST_DB", "CLAUDE_CLI_TEST_IMAGE", "CLAUDE_CLI_TEST_GATEWAY"]) {
      expect(harness).toContain(knob);
    }
  });

  test("npm script test:claude-cli:local is wired", () => {
    expect(pkg.scripts["test:claude-cli:local"]).toContain("claude-cli-local-test.sh");
  });
});

describe("Component 4 E5 — auth model (subscription → local LLM → api_key)", () => {
  const cfg = read("services/svc-agent-runner/src/config.ts");
  const backend = read("services/svc-agent-runner/src/backends/claude-cli.ts");

  test("auth knobs are env-driven with a per-run override", () => {
    for (const k of ["AGENT_AUTH_MODE", "AGENT_LOCAL_LLM_URL"]) {
      expect(cfg, `${k} must be read from process.env`).toContain(`process.env.${k}`);
    }
    expect(backend).toMatch(/inputs\.auth_mode\s*\?\?\s*config\.agentAuthMode/);
  });

  // 2026-10-02: token předplatného je POVĚŘENÍ, které runtime deklaruje
  // (ai_runtime_registry.credential_env_var: cli:claude-cli → AGENT_CLAUDE_OAUTH_TOKEN)
  // a čte se při běhu z trezoru instance — config ho při startu z env nenačítá.
  test("token předplatného = pověření runtime, čtené při běhu (ne z configu)", () => {
    expect(cfg).not.toContain("process.env.AGENT_CLAUDE_OAUTH_TOKEN");
    expect(backend).toMatch(/credentialNameForRuntime\(`cli:\$\{cliSlug\}`\)/);
    expect(backend).toMatch(/const auth = await resolveRunAuth\(inputs\)/);
  });

  test("SUBSCRIPTION is the CLI's primary auth — OAuth token (no API key, no credits)", () => {
    // the subscription path injects the long-lived OAuth token, not an API key
    expect(backend).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(backend).toMatch(/optional\('CLAUDE_CODE_OAUTH_TOKEN',\s*auth\.runtimeCredential/);
    expect(backend).toMatch(/authMode === 'subscription'/);
    // a ~/.claude mount is still supported (Linux hosts)
    expect(backend).toContain("/home/agent/.claude:ro");
  });

  test("LOCAL LLM is the fallback when there is no subscription/key", () => {
    expect(backend).toMatch(/authMode === 'local_llm'/);
    expect(backend).toContain("config.localLlmBaseUrl");
  });

  test("auto resolution walks subscription → local LLM → api_key", () => {
    expect(backend).toMatch(
      /hasSubscription\s*\?\s*'subscription'\s*:\s*hasLocalLlm\s*\?\s*'local_llm'\s*:\s*'api_key'/,
    );
  });
});

describe("Component 4 E6 — spawn governance default (operator-tunable, not hardcoded in code)", () => {
  const devPolicy = read("aisha/db/seed/dev/02_dev_spend_policy.sql");

  test("dev seed registers a claude_cli_task spend policy so the dev spawn loop is autonomous", () => {
    expect(devPolicy).toContain("'claude_cli_task'");
    // it allows a normal run (the $8 band) — i.e. an auto_allow threshold above it
    expect(devPolicy).toMatch(/'claude_cli_task',\s*10\.00/);
  });

  test("n8n WF_DIRIGENT_CLI_SPAWNER is a valid workflow that POSTs the runner a claude_cli_task", () => {
    const wf = JSON.parse(read("n8n/workflows/WF_DIRIGENT_CLI_SPAWNER.json")) as {
      name: string;
      nodes: Array<{ name: string; type: string; parameters: Record<string, unknown> }>;
      connections: Record<string, unknown>;
    };
    expect(wf.name).toBe("WF_DIRIGENT_CLI_SPAWNER");
    // trigger → build → POST runner → audit → respond, fully connected
    expect(wf.nodes.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(wf.connections).length).toBeGreaterThanOrEqual(3);
    const http = wf.nodes.find((n) => n.type.includes("httpRequest"));
    expect(http, "spawner must POST the agent runner").toBeTruthy();
    expect(String(http!.parameters.url)).toMatch(/\/runs/);
    // the run request carries the claude kind; image is omitted (runner defaults it — no literal)
    const blob = JSON.stringify(wf);
    expect(blob).toContain("claude_cli_task");
    expect(blob).not.toMatch(/aisha-agent-claude:[a-z]/); // no hardcoded image tag in the workflow
  });
});

describe("Component 4 E8/E9/E13 — async runner + real cancel + story injection", () => {
  const backend = read("services/svc-agent-runner/src/backends/claude-cli.ts");
  const runs = read("services/svc-agent-runner/src/routes/runs.ts");

  test("E8 — backend is async (prepare/monitor split, in-flight registry)", () => {
    expect(backend).toMatch(/async prepare\(/);
    expect(backend).toMatch(/async monitor\(/);
    expect(backend).toMatch(/RUNNING\s*=\s*new Map/);
  });

  test("E8 — claude route returns 202 immediately + monitors in the background (no HTTP block)", () => {
    expect(runs).toMatch(/status\(202\)/);
    expect(runs).toMatch(/cli\.prepare\(/);
    expect(runs).toMatch(/void cli\.monitor\(/);
    // plugin path stays synchronous (no regression)
    expect(runs).toMatch(/getBackend\(profile\)\.execute/);
  });

  test("E9 — cancel terminates the live container + run clone, route wires it", () => {
    // Měří tělo cancel(), ne celý soubor: výskyt jména kdekoli jinde by prošel
    // i s cancel(), který klon běhu po sobě nechá.
    const zacatek = backend.indexOf("static async cancel(");
    expect(zacatek, "static async cancel( nenalezeno").toBeGreaterThanOrEqual(0);
    const konec = backend.indexOf("\n  }\n", zacatek);
    expect(konec, "konec těla cancel() nenalezen").toBeGreaterThan(zacatek);
    const telo = backend.slice(zacatek, konec);
    expect(telo).toContain("killContainer");
    expect(telo).toContain("removeRunDir");
    expect(runs).toContain("ClaudeCliBackend.cancel");
    expect(runs).toContain("container_killed");
  });

  test("E13 — story context injected into the worktree (.aisha/story.json + CLAUDE.md brief)", () => {
    expect(backend).toContain("injectStoryContext");
    expect(backend).toContain("story.json");
    expect(backend).toContain("run-context.md");
    expect(backend).not.toMatch(/appendFile\([^;]*CLAUDE\.md/s);
    expect(backend).toMatch(/acceptance_criteria/);
  });
});

describe("Component 4 E10 — Dirigent spawn surface (real producer UI)", () => {
  const hook = read("src/hooks/useSpawnClaudeRun.ts");
  const button = read("src/components/admin/mission-control/SpawnClaudeRunButton.tsx");
  const strip = read("src/components/admin/mission-control/AgentSessionsStrip.tsx");
  const locales = ["en", "cs", "de", "fr", "ru", "th"] as const;

  test("useSpawnClaudeRun calls the universal producer RPC with story-scoped inputs, image omitted", () => {
    expect(hook).toContain('aisha.rpc("fn_spawn_claude_cli_run"');
    // image intentionally empty — the runner defaults it (no hardcoded image tag in the UI)
    expect(hook).toMatch(/p_image:\s*""/);
    expect(hook).toMatch(/p_source:\s*"dirigent:ui"/);
    // story-scoped inputs incl. the dynamic auth_mode (default auto → subscription→local→key)
    for (const k of ["story_id", "prompt", "auth_mode"]) {
      expect(hook, `p_inputs.${k}`).toContain(k);
    }
    expect(hook).toMatch(/authMode\s*\?\?\s*"auto"/);
  });

  test("SpawnClaudeRunButton is a real producer surface wired to the hook", () => {
    expect(button).toContain("useSpawnClaudeRun");
    expect(button).toContain('data-test="spawn-claude-run"');
    expect(button).toMatch(/spawn\.mutate\(/);
    // i18n-driven, no hardcoded English in the JSX
    expect(button).toMatch(/t\("missionControl\.spawnClaude\.button"\)/);
  });

  test("AgentSessionsStrip mounts the producer button (one surface for monitor + spawn)", () => {
    expect(strip).toContain("SpawnClaudeRunButton");
    expect(strip).toMatch(/<SpawnClaudeRunButton\s*\/>/);
  });

  test("spawnClaude i18n block is present in every locale (no missing translations)", () => {
    for (const loc of locales) {
      const seg = JSON.parse(read(`src/i18n/segments/${loc}/missionControl.json`)) as {
        missionControl?: { spawnClaude?: Record<string, string> };
        spawnClaude?: Record<string, string>;
      };
      const sc = seg.missionControl?.spawnClaude ?? seg.spawnClaude;
      expect(sc, `${loc} spawnClaude block`).toBeTruthy();
      for (const k of ["button", "title", "description", "promptLabel", "submit", "success", "error"]) {
        expect(String(sc![k] ?? ""), `${loc}.spawnClaude.${k}`).not.toBe("");
      }
    }
  });
});

describe("Component 4 E14 — GOAL 2 autonomous supervisor (runaway → nudge)", () => {
  const fn = read("aisha/db/sql/functions/fn_detect_agent_runaway.sql");
  const wf = JSON.parse(read("n8n/workflows/WF_DIRIGENT_AGENT_WATCHDOG.json")) as {
    name: string;
    nodes: Array<{ name: string; type: string; parameters: Record<string, unknown> }>;
    connections: Record<string, unknown>;
  };

  test("fn_detect_agent_runaway is SECURITY DEFINER, grant-scoped, thresholds are arguments (not literals)", () => {
    expect(fn).toContain("CREATE OR REPLACE FUNCTION public.fn_detect_agent_runaway");
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toMatch(/SET search_path TO 'public'/);
    // operator-tunable thresholds, no policy baked as a constant
    for (const arg of ["p_max_runtime_minutes", "p_max_tokens", "p_max_cost"]) {
      expect(fn, arg).toContain(arg);
    }
    expect(fn).toMatch(/REVOKE ALL ON FUNCTION public\.fn_detect_agent_runaway/);
    expect(fn).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_detect_agent_runaway.*TO service_role/s);
  });

  test("it is admin/service-role gated — a regular authenticated caller cannot enumerate other users' sessions", () => {
    // SECURITY DEFINER + scans ALL live sessions → must guard (security.gate SEC_DEF_NO_AUTH).
    expect(fn).toContain("is_admin_or_staff");
    expect(fn).toMatch(/'service_role'/);
    expect(fn).toMatch(/RAISE EXCEPTION[^;]*service_role[^;]*ERRCODE = '42501'/s);
  });

  test("it rolls up cost via the CANONICAL session join (ai_trace_events.run_id = ai_run_id)", () => {
    // must match list_active_agent_sessions / finish_ai_run — NOT a fragile session_id-in-request_summary join
    expect(fn).toMatch(/ate\.run_id\s*=\s*s\.ai_run_id/);
    expect(fn).not.toMatch(/request_summary->>'session_id'/);
    expect(fn).toContain("cost_json");
  });

  test("it queues an idempotent advisory nudge (event_origin=agent_watchdog), never blocks", () => {
    expect(fn).toMatch(/INSERT INTO public\.dirigent_nudges/);
    expect(fn).toContain("'agent_watchdog'");
    // idempotent: one un-consumed watchdog nudge per session within the window
    expect(fn).toMatch(/EXISTS\s*\(/);
    expect(fn).toMatch(/metadata->>'session_id'\s*=\s*v_row\.session_id/);
    // advisory only — severity warn, never an error/abort
    expect(fn).toContain("'warn'");
  });

  test("WF_DIRIGENT_AGENT_WATCHDOG drives it on a schedule with env-driven thresholds (rpcParams)", () => {
    expect(wf.name).toBe("WF_DIRIGENT_AGENT_WATCHDOG");
    expect(wf.nodes.some((n) => n.type.includes("scheduleTrigger"))).toBe(true);
    const rpc = wf.nodes.find((n) => n.type.includes("aishaRpc"));
    expect(rpc, "watchdog must call the detector via aishaRpc").toBeTruthy();
    expect(rpc!.parameters.functionName).toBe("fn_detect_agent_runaway");
    // aishaRpc reads rpcParams (not functionParams) — known node contract
    expect(rpc!.parameters).toHaveProperty("rpcParams");
    expect(rpc!.parameters).not.toHaveProperty("functionParams");
    // thresholds come from $env, not hardcoded in the workflow
    const rpcParams = String(rpc!.parameters.rpcParams);
    for (const env of ["AGENT_WATCHDOG_MAX_RUNTIME_MIN", "AGENT_WATCHDOG_MAX_TOKENS", "AGENT_WATCHDOG_MAX_COST_USD"]) {
      expect(rpcParams, env).toContain(env);
    }
    expect(Object.keys(wf.connections).length).toBeGreaterThanOrEqual(2);
  });
});

describe("Component 4 E15 — producer→executor claim + story goal-eval loop", () => {
  const claim = read("aisha/db/sql/functions/claim_queued_claude_run.sql");
  const poller = read("services/svc-agent-runner/src/poller.ts");
  const runs = read("services/svc-agent-runner/src/routes/runs.ts");

  test("claim_queued_claude_run is a SKIP LOCKED job-queue claim, service_role only", () => {
    expect(claim).toContain("CREATE OR REPLACE FUNCTION public.claim_queued_claude_run");
    expect(claim).toContain("SECURITY DEFINER");
    expect(claim).toMatch(/FOR UPDATE SKIP LOCKED/);
    // queued → running transition
    expect(claim).toMatch(/status\s*=\s*'queued'/);
    expect(claim).toMatch(/SET status = 'running'/);
    // grace window keeps the synchronous POST /runs path's own fresh rows
    expect(claim).toMatch(/p_grace_seconds/);
    // returns the execution context incl. inputs jsonb
    expect(claim).toMatch(/RETURNS TABLE[^$]*inputs jsonb/s);
    // least privilege — only the runner claims
    expect(claim).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_queued_claude_run.*TO service_role/s);
    expect(claim).not.toMatch(/TO authenticated/);
  });

  test("the runner poller claims, executes async, finalizes and evaluates the story goal", () => {
    expect(poller).toContain("claim_queued_claude_run");
    expect(poller).toMatch(/cli\.prepare\(/);
    expect(poller).toMatch(/cli\.monitor\(/);
    expect(poller).toContain("update_agent_run_status");
    // E15 — on success with a story, close the self-* loop
    expect(poller).toContain("evaluate_story_self");
    expect(poller).toMatch(/result\.exitCode === 0/);
  });

  test("the synchronous POST /runs path also closes the goal loop (parity with the poller)", () => {
    expect(runs).toContain("evaluate_story_self");
  });

  test("poller cadence + kill-switch are DYNAMIC — re-read each tick, not a fixed cadence", () => {
    // the self-rescheduling loop re-resolves caps every tick (runtime-tunable)
    expect(poller).toContain("getRunnerCaps");
    expect(poller).toMatch(/caps\.pollEnabled/);    // runtime kill-switch
    expect(poller).toMatch(/caps\.pollIntervalMs/); // runtime cadence
    // config.claudePollIntervalMs remains only as the scheduling fail-safe
    expect(poller).toContain("config.claudePollIntervalMs");
  });
});

describe("Component 4 SAFETY — runaway container-spawn prevention", () => {
  const cfg = read("services/svc-agent-runner/src/config.ts");
  const poller = read("services/svc-agent-runner/src/poller.ts");
  const backend = read("services/svc-agent-runner/src/backends/claude-cli.ts");
  const runs = read("services/svc-agent-runner/src/routes/runs.ts");
  const server = read("services/svc-agent-runner/src/server.ts");
  const reconcile = read("services/svc-agent-runner/src/reconcile.ts");
  const spawnFn = read("aisha/db/sql/functions/fn_spawn_claude_cli_run.sql");
  const execCompose = read("docker-compose.coolify-exec.yml");
  const entrypoint = read("docker/agent-claude/entrypoint.sh");
  const localPresets = read("config/local-presets.mjs");

  test("the auto-drain poller is OFF by default — env-ABSENT must NOT arm it", () => {
    // === 'true' (opt-in), never !== 'false' (the original on-by-default footgun)
    expect(cfg).toMatch(/claudePollEnabled:\s*process\.env\.CLAUDE_POLL_ENABLED\s*===\s*'true'/);
    expect(cfg).not.toMatch(/CLAUDE_POLL_ENABLED\s*!==\s*'false'/);
    // compose + dev presets pin it false-by-default (two layers agree)
    expect(execCompose).toMatch(/CLAUDE_POLL_ENABLED:\s*\$\{CLAUDE_POLL_ENABLED:-false\}/);
    expect(localPresets).toMatch(/CLAUDE_POLL_ENABLED:\s*"false"/);
  });

  test("a hard max-concurrent cap exists and GATES the claim (poller refuses at capacity)", () => {
    expect(cfg).toMatch(/maxConcurrentClaudeRuns/);
    expect(cfg).toMatch(/MAX_CONCURRENT_CLAUDE_RUNS/);
    // Math.max(1, …) → 0/garbage means 1, never "unlimited"
    expect(cfg).toMatch(/Math\.max\(\s*1\s*,[^)]*MAX_CONCURRENT_CLAUDE_RUNS/);
    // backend exposes the live count from the in-memory RUNNING map
    expect(backend).toMatch(/static activeCount\(\)/);
    // poller skips the claim at capacity (the load-bearing gate): reads the live
    // count, compares to the DYNAMIC cap (caps.maxConcurrent), returns before claim.
    expect(poller).toMatch(/ClaudeCliBackend\.activeCount\(\)/);
    expect(poller).toMatch(/>=\s*caps\.maxConcurrent/);
    // POST /runs (the second executor) is capped too → 429, no bypass
    expect(runs).toMatch(/activeCount\(\)\s*>=\s*caps!?\.maxConcurrent/);
    expect(runs).toMatch(/status\(429\)/);
  });

  test("all runner caps are DYNAMIC — system_config('agent_runner') overrides env at runtime", () => {
    const runtimeCfg = read("services/svc-agent-runner/src/runtime-config.ts");
    const seed = read("aisha/db/seed/core/07_system_config.sql");
    // the resolver reads the platform's dynamic-config getter for the agent_runner key
    expect(runtimeCfg).toMatch(/get_system_config/);
    expect(runtimeCfg).toContain("agent_runner");
    // DB value WINS; the env layer (config.ts) is only the bootstrap/fail-safe
    expect(runtimeCfg).toMatch(/config\.maxConcurrentClaudeRuns/);
    expect(runtimeCfg).toMatch(/config\.claudePollEnabled/);
    // poller + POST /runs consume the RESOLVED caps, not the static config field
    expect(poller).toMatch(/getRunnerCaps/);
    expect(runs).toMatch(/getRunnerCaps/);
    // poller loop re-reads each tick so poll_enabled/interval/cap tune live
    expect(poller).toMatch(/await getRunnerCaps\(\)/);
    // fn_spawn resolves its queue ceiling from the SAME DB config (not a literal)
    expect(spawnFn).toMatch(/get_system_config\('agent_runner'\)/);
    expect(spawnFn).toMatch(/max_inflight/);
    // seeded with safe defaults, never clobbered on re-seed (operator tuning survives)
    expect(seed).toContain("'agent_runner'");
    expect(seed).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
  });

  test("containers are labeled + reconciled on startup (orphans are findable & reaped)", () => {
    // labels make a crashed-process orphan discoverable across restarts
    expect(backend).toContain("aisha.run_id");
    expect(backend).toContain("aisha.managed_by");
    // boot reconciler runs BEFORE the poller is armed
    expect(server).toContain("reconcileOrphans");
    expect(server).toMatch(/reconcileOrphans\([^)]*\)[\s\S]*startClaudePoller/);
    expect(reconcile).toMatch(/listManagedContainers|aisha\.managed_by/);
    expect(reconcile).toContain("update_agent_run_status"); // finalize phantom 'running' rows
  });

  test("fn_spawn bounds the backlog at the source (one-active-per-story + queue ceiling)", () => {
    expect(spawnFn).toMatch(/already active for story/);
    expect(spawnFn).toMatch(/p_max_inflight/);
    expect(spawnFn).toMatch(/queue depth at limit/);
  });

  test("the agent container self-terminates at EXEC_TIMEOUT_MS (orphan can't bill forever)", () => {
    expect(entrypoint).toMatch(/timeout\s+--signal=TERM[^\n]*claude -p|timeout[^\n]*EXEC_TIMEOUT|TIMEOUT_S=/);
    expect(entrypoint).toContain("EXEC_TIMEOUT_MS");
  });

  test("per-container memory default is sane (not the 2g runaway multiplier, not 256m OOM)", () => {
    expect(cfg).toMatch(/execMemoryLimit:\s*process\.env\.EXEC_MEMORY_LIMIT\s*\?\?\s*'1g'/);
    // host budget cap is co-located in the exec compose
    expect(execCompose).toMatch(/MAX_CONCURRENT_CLAUDE_RUNS:\s*\$\{MAX_CONCURRENT_CLAUDE_RUNS:-\d+\}/);
  });
});
