import { describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { appClaimedHosts } from "../../../scripts/lib/fqdn-owners.mjs";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf-8");

describe("cold-start systemic hardening", () => {
  test("completed waves survive a transient final reporting fetch", () => {
    const source = read("scripts/aisha-redeploy.mjs");
    expect(source).toMatch(
      /try \{\s*const finalApps = await fetchApps\(\);\s*printStatusTable\(finalApps\);\s*\} catch \(error\) \{[\s\S]{0,180}Final status table unavailable/,
    );
  });

  test("deadline with a non-terminal deployment fails closed as timeout", () => {
    const source = read("scripts/aisha-redeploy.mjs");
    expect(source).toMatch(/const timedOutDeployments = \[\.\.\.deployments\.entries\(\)\]/);
    expect(source).toMatch(/status: "timeout"/);
    const fallback = source.slice(source.indexOf("const timedOutDeployments"), source.indexOf("// ── Gate checks"));
    expect(fallback).toContain("ok: false");
  });

  test("Phase C messages use the phase boundaries printed by aisha-redeploy", () => {
    const source = read("scripts/aisha-cold-start.sh");
    const phase = source.slice(source.indexOf("Phase C: deploying"), source.indexOf("# ── Phase D:"));
    expect(phase).toContain("${AISHA_WAVE_PHASE_C_FROM}-${AISHA_WAVE_PHASE_C_UNTIL}");
    expect(phase).not.toContain("Wave 4 completed");
    expect(phase).not.toContain("Wave 4 did not complete");
  });

  test("PKI JWKS delivery delegates to the project-scoped canonical bulk sync", () => {
    const source = read("scripts/pki-bootstrap-jwks-sync.mjs");
    expect(source).toContain("scripts/coolify-sync-envs.sh");
    expect(source).toContain("KEYS: 'PKI_BOOTSTRAP_JWKS'");
    expect(source).toContain("REDEPLOY: DRY ? '0' : '1'");
    expect(source).not.toMatch(/fetch\(`\$\{coolifyUrl\}\/api\/v1\/applications/);
    const coldStart = read("scripts/aisha-cold-start.sh");
    expect(coldStart).toContain('MANIFEST_FILE="$MANIFEST" node "${REPO_ROOT}/scripts/pki-bootstrap-jwks-sync.mjs"');
  });

  test("Keycloak seed sanitizer removes documentation keys recursively", () => {
    const dir = mkdtempSync(join(tmpdir(), "aisha-kc-sanitize-"));
    try {
      const input = join(dir, "input.json");
      const output = join(dir, "output.json");
      writeFileSync(input, JSON.stringify({
        _comment: "root",
        realm: "example",
        clients: [{ clientId: "web", _note: "client", protocolMappers: [{ name: "roles", _comment_mapper: "nested" }] }],
      }));
      const run = spawnSync("python3", [join(ROOT, "keycloak/sanitize-keycloak-seed.py"), input, output]);
      expect(run.status, run.stderr.toString()).toBe(0);
      expect(JSON.parse(readFileSync(output, "utf-8"))).toEqual({
        realm: "example",
        clients: [{ clientId: "web", protocolMappers: [{ name: "roles" }] }],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("comma-separated docker_compose_domains claim every host", () => {
    const hosts = appClaimedHosts({
      docker_compose_domains: [{
        name: "edge-proxy",
        domain: "https://auth.example.test,https://api.example.test:443",
      }],
    });
    expect([...hosts].sort()).toEqual(["api.example.test", "auth.example.test"]);
  });

  test("all Coolify ingress routers are generated; custom service is tenant-scoped", () => {
    const violations: string[] = [];
    for (const file of readdirSync(ROOT).filter((name) => name.startsWith("docker-compose.coolify") && name.endsWith(".yml"))) {
      const source = read(file);
      source.split("\n").forEach((line, index) => {
        if (/traefik\.http\.(routers|middlewares)\./.test(line)) violations.push(`${file}:${index + 1}:${line.trim()}`);
        if (/traefik\.http\.services\./.test(line) && !line.includes("${APP_NAME_PREFIX") ) {
          violations.push(`${file}:${index + 1}:${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  test("domain contract follows extracted apps and never sends an edge sentinel", () => {
    const doctor = read("scripts/coolify-domain-doctor.mjs");
    for (const app of ["aisha-pgadmin", "aisha-monitoring", "aisha-source-broker", "aisha-extranet", "aisha-livekit"]) {
      expect(doctor).toContain(`app: "${app}"`);
    }
    const core = doctor.slice(doctor.indexOf('{ app: "aisha-core"'), doctor.indexOf('{ app: "aisha-pgadmin"'));
    expect(core).not.toContain("pgadmin-auth");
    const deployInit = read("scripts/coolify-deploy-init.sh");
    expect(deployInit).not.toContain("mesh-router-disabled.invalid");
  });

  test("deploy-init dry-run is mutation-free and never reveals value prefixes", () => {
    const source = read("scripts/coolify-deploy-init.sh");
    const selfHeal = source.slice(source.indexOf("# NETBIRD SELF-HEAL"), source.indexOf("# STACK DEPLOYMENT LOOP"));
    expect(selfHeal).toMatch(/if \[ "\$DRY_RUN" = "1" \][\s\S]+elif[\s\S]+netbird-bootstrap\.sh/);
    expect(selfHeal.indexOf('if [ "$DRY_RUN" = "1" ]')).toBeLessThan(selfHeal.indexOf("netbird-bootstrap.sh\" </dev/null"));
    expect(source).not.toMatch(/\$\{value:0:\d+\}/);
    expect(source).not.toMatch(/\$\{COOLIFY_API_TOKEN:0:\d+\}/);
    expect(source).not.toMatch(/\$\{WEBHOOK_URL:0:\d+\}/);
    expect(source).toContain("would be upserted (value redacted)");
  });

  test("deploy-init discovers extracted apps and guards optional direct domains", () => {
    const source = read("scripts/coolify-deploy-init.sh");
    const discovery = source.slice(source.indexOf("stack_jq_filter()"), source.indexOf("# Per-stack UUIDs"));
    expect(discovery).toContain('extranet)    echo');
    expect(discovery).toContain('test(\\"coolify-extranet');
    expect(source).toContain('if [ -n "${GRAFANA_DOMAIN:-}" ]');
    expect(source).toContain('if [ -n "${DOZZLE_DOMAIN:-}" ]');
    expect(source).not.toContain('${GRAFANA_DOMAIN:?');
    expect(source).not.toContain('${DOZZLE_DOMAIN:?');
    const uuidRegistry = source.slice(source.indexOf("set_stack_uuid()"), source.indexOf("# ── Argument parsing"));
    expect(uuidRegistry).toContain('extranet)      UUID_EXTRANET="$2"');
    expect(source).toContain('registry)      echo "docker-compose.coolify-registry.yml"');
  });

  test("deploy-init normalizes the GitHub API URL and owner/repository path (no guessing)", () => {
    const source = read("scripts/coolify-deploy-init.sh");
    expect(source).toContain("normalize_github_coordinates()");
    expect(source).toContain('GITHUB_API_URL="${GITHUB_API_URL%/}"');
    expect(source).toContain('repo="${repo%.git}"');
    // A declared value that is not owner/repo is a declaration error → fail, never a guess.
    expect(source).toMatch(/nemá tvar owner\/repo[\s\S]{0,120}exit 1/);
    expect(source).not.toMatch(/GITHUB_REPOSITORY="\$\{GITHUB_REPOSITORY:-[^}]/);
    expect(source.indexOf("normalize_github_coordinates\n\nload_topology_env")).toBeGreaterThan(
      source.lastIndexOf('load_env_file "$PROJECT_ROOT/.env.coolify"'),
    );
  });

  test("deployment watcher recognizes the Coolify 4.3 server_name alias", () => {
    const source = read("scripts/coolify-deploy-watch.mjs");
    const normalizer = source.slice(source.indexOf("function normalizeDeployment"), source.indexOf("async function fetchGlobalDeployments"));
    expect(normalizer).toMatch(/app_name:[^\n]+raw\?\.server_name[^\n]+\|\| ""/);
  });

  test("optional federation compose is structurally validated even when disabled", () => {
    const preflight = read("scripts/preflight-compose.sh");
    expect(preflight).toContain('structural_only+=("$f")');
    expect(preflight).toContain('config -q --no-interpolate');
    const broker = read("docker-compose.coolify-source-broker.yml");
    expect(broker).not.toMatch(/^volumes:\s*\n\s*networks:/m);
  });
});
