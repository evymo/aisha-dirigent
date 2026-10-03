/**
 * Local container-name namespacing — per-implementation stack coexistence
 *
 * The local-warmup stack (project = LOCAL_STACK, per-IMPLEMENTATION — see
 * scripts/lib/local-stack-name.mjs), the e2e stack (project
 * evymo-ai-orchestrator) and OTHER implementations' local stacks inherit the
 * SAME `container_name: aisha-*` from the shared docker-compose.coolify*.yml
 * files. Docker container names are GLOBAL, so such stacks could not run at the
 * same time (name collision — repeatedly blocked work when a parallel session
 * held the e2e stack).
 *
 * scripts/local-compose-gen.mjs namespaces every container_name to
 * `${LOCAL_STACK}__<orig>` (globally unique per implementation) while preserving
 * the original name as an alias on the LOCAL_STACK network, so in-network URLs
 * (http://aisha-keycloak:80 …) keep resolving. This gate asserts the pure
 * transform + that the generator runs it LAST (after the KC resolver, which
 * keys on the original name) + that the per-implementation stack-name default
 * stays in parity across the mjs SoT and its shell consumers ("jedna instance
 * dané implementace" — never collide with another implementation's stack).
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { namespaceContainerNames } from "../../../scripts/lib/container-namespacing.mjs";
import { LOCAL_STACK, LOCAL_STACK_PREFIX } from "../../../scripts/lib/local-stack-name.mjs";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");
const PREFIX = LOCAL_STACK_PREFIX;
const NET = LOCAL_STACK;

// Sonda musí umět obě podoby nepřítomnosti: „docker tu NENÍ" (exec hned hodí
// výjimku) i „docker tu je, ale NEODPOVÍDÁ" (démon zaseknutý — na macOS běžné).
// Bez `timeout` uměla jen tu první: `docker version` se nikdy nevrátil,
// `execFileSync` čekal donekonečna a protože sada bran nemá per-test limit,
// zastavilo se CELÉ `test:gates`. A `test:gates` pouští pre-push hook, takže
// zaseknutý démon znamenal, že se z takového stroje NEDÁ PUSHNOUT.
// Naměřeno 2026-08-03: běh stál 15+ minut na 960. řádku, jediná brána bez
// výsledku byla tahle; `docker ps` na témž stroji neodpověděl ani za 30 s.
// Timeout dělá ze zaseknutého démona totéž co z chybějícího: přeskočeno.
//
// ⭐ Tutéž vadu našly 2026-08-04 nezávisle DVĚ session — druhá měřením
// „které soubory bran nikdy nedoběhly": z 493 doběhlo 492 a tenhle jediný
// držel celou sadu. Vlastnost, kterou to připíná: dotaz na dostupnost je
// OTÁZKA, a otázka bez možné záporné odpovědi není otázka.
function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "pipe",
      timeout: 10_000,
      killSignal: "SIGKILL",
    });
    return true;
  } catch {
    return false;
  }
}

function sampleDoc() {
  return {
    services: {
      keycloak: { container_name: "aisha-keycloak", networks: [NET], environment: { KEYCLOAK_URL: "http://aisha-keycloak:80" } },
      gateway: { container_name: "aisha-gateway", networks: { [NET]: null }, environment: { KC_JWKS_URL: "http://aisha-keycloak:80/realms/aisha/protocol/openid-connect/certs" } },
      db: { container_name: "aisha-db", networks: [NET] },
      noname: { image: "x" }, // no container_name — must be untouched
    },
  };
}

describe("Local container-name namespacing", () => {
  test("namespaces every container_name + preserves the original as a local-network alias", () => {
    const doc = namespaceContainerNames(sampleDoc(), PREFIX);
    expect(doc.services.keycloak.container_name).toBe(`${PREFIX}aisha-keycloak`);
    expect(doc.services.keycloak.networks[NET].aliases).toEqual(["aisha-keycloak"]);
    expect(doc.services.gateway.container_name).toBe(`${PREFIX}aisha-gateway`);
    expect(doc.services.gateway.networks[NET].aliases).toEqual(["aisha-gateway"]);
    expect(doc.services.db.container_name).toBe(`${PREFIX}aisha-db`);
    expect(doc.services.db.networks[NET].aliases).toEqual(["aisha-db"]);
  });

  test("in-network URLs (referencing the original name) keep resolving via the alias", () => {
    const doc = namespaceContainerNames(sampleDoc(), PREFIX);
    // URLs are NOT rewritten — they keep the original name, which the alias serves.
    expect(doc.services.gateway.environment.KC_JWKS_URL).toBe("http://aisha-keycloak:80/realms/aisha/protocol/openid-connect/certs");
    expect(doc.services.keycloak.environment.KEYCLOAK_URL).toBe("http://aisha-keycloak:80");
    expect(doc.services.keycloak.networks[NET].aliases).toContain("aisha-keycloak");
  });

  test("services without a container_name are untouched", () => {
    const doc = namespaceContainerNames(sampleDoc(), PREFIX);
    expect(doc.services.noname.container_name).toBeUndefined();
    expect(doc.services.noname).toEqual({ image: "x" });
  });

  test("idempotent — re-running does not double-prefix or double-alias", () => {
    let doc = namespaceContainerNames(sampleDoc(), PREFIX);
    doc = namespaceContainerNames(doc, PREFIX);
    expect(doc.services.keycloak.container_name).toBe(`${PREFIX}aisha-keycloak`);
    expect(doc.services.keycloak.networks[NET].aliases).toEqual(["aisha-keycloak"]);
  });

  test("every container_name is project-local → no global collision with other stacks", () => {
    const doc = namespaceContainerNames(sampleDoc(), PREFIX);
    for (const svc of Object.values(doc.services) as Array<{ container_name?: string }>) {
      if (!svc.container_name) continue;
      expect(
        svc.container_name.startsWith(PREFIX),
        `"${svc.container_name}" must not collide with other stacks' bare aisha-* names`,
      ).toBe(true);
    }
  });

  test("generator wires the namespacing pass LAST (after applyHostClientAuthFix)", () => {
    const gen = read("scripts/local-compose-gen.mjs");
    expect(gen).toMatch(/import \{ namespaceContainerNames \} from "\.\/lib\/container-namespacing\.mjs"/);
    const idxFix = gen.indexOf("applyHostClientAuthFix(merged)");
    const idxNs = gen.indexOf("namespaceContainerNames(merged");
    expect(idxFix, "applyHostClientAuthFix call present").toBeGreaterThan(-1);
    expect(idxNs, "namespacing must run AFTER the KC resolver (which keys on the original name)").toBeGreaterThan(idxFix);
  });

  test("services using network_mode (e.g. core-mesh-ingress sidecar) never get networks added — avoids 'mutually exclusive network_mode + networks' compose error", () => {
    // This catches exactly the class of bug that broke `warmup:local --preset minimum`:
    // core-mesh-ingress uses network_mode: "service:netbird-agent" to share netns for mesh ingress.
    // Namespacing (and transform) must not inject `networks: { [LOCAL_STACK]: ... }`.
    const docWithNetworkMode = {
      services: {
        "netbird-agent": { container_name: "aisha-netbird-agent", networks: [NET] },
        "core-mesh-ingress": {
          container_name: "aisha-core-mesh-ingress",
          network_mode: "service:netbird-agent",
          // no networks in source — must stay that way
        },
      },
    };
    const result = namespaceContainerNames(docWithNetworkMode, PREFIX);
    expect(result.services["core-mesh-ingress"].network_mode).toBe("service:netbird-agent");
    expect(result.services["core-mesh-ingress"].networks).toBeUndefined();
    // container_name still gets namespaced (for coexistence), but no networks
    expect(result.services["core-mesh-ingress"].container_name).toBe(`${PREFIX}aisha-core-mesh-ingress`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-implementation stack-name SoT + shell parity.
//
// The stack name is per-IMPLEMENTATION (one local instance per implementation;
// other implementations' stacks — e.g. upstream evymo's `aisha-local` — are
// off-limits). The mjs SoT is scripts/lib/local-stack-name.mjs; shell scripts
// cannot import it and duplicate the default as ${AISHA_LOCAL_STACK:-<slug>}.
// This block keeps every duplicate in lockstep and bans hardcoded stack-name
// literals in the generator/namespacing code.
// ─────────────────────────────────────────────────────────────────────────────
describe("per-implementation local stack name — SoT + parity", () => {
  const lib = read("scripts/lib/local-stack-name.mjs");
  const libDefault = lib.match(/AISHA_LOCAL_STACK \|\| "([a-z][a-z0-9_-]*)"/)?.[1];

  test("mjs SoT declares a valid default slug", () => {
    expect(libDefault, "default slug parseable from local-stack-name.mjs").toBeTruthy();
    expect(LOCAL_STACK === libDefault || !!process.env.AISHA_LOCAL_STACK).toBe(true);
  });

  test("stack name je jméno TÉHLE implementace — nikdy cizí", () => {
    // Invariant je „jmenuj SE SÁM", ne „nejmenuj se aisha-local". Do 2026-08-11
    // tu stálo `expect(libDefault).not.toBe("aisha-local")` — forkové tvrzení
    // zavlečené do generické šablony: v upstreamu, který `aisha-local` JE, to
    // padá vždycky. A ve forku to zakazovalo jen JEDNO cizí jméno; fork, který
    // by si vzal slug jiného forku, by prošel.
    //
    // Jméno se odvozuje z instances/ — týž zdroj jako u ostatních identit
    // (viz scripts/split-rule-gate.mjs). Upstream tam má jen `_default` ⇒
    // `aisha-local` je jeho VLASTNÍ jméno a je správně; fork tam má svůj
    // adresář ⇒ musí mít `<slug>-local`, jinak by sahal na cizí kontejnery.
    const vlastni = (() => {
      try {
        return readdirSync(join(ROOT, "instances"), { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
          .map((e) => e.name)[0];
      } catch {
        return undefined;
      }
    })();
    const ocekavany = vlastni ? `${vlastni}-local` : "aisha-local";
    expect(
      libDefault,
      vlastni
        ? `strom deklaruje implementaci '${vlastni}', ale lokální stack se jmenuje '${libDefault}' — sahal by na cizí kontejnery`
        : `generická šablona (instances/ nese jen _default) má mít stack 'aisha-local', ne '${libDefault}'`,
    ).toBe(ocekavany);
  });

  test.each([
    "scripts/local-warmup.sh",
    "scripts/e2e/claude-cli-local-test.sh",
    "scripts/test/omni-local-verify.sh",
    "scripts/rag/czech-doc-analyze.sh",
  ])("shell consumer %s duplicates the SoT default verbatim", (rel) => {
    expect(read(rel)).toContain(`\${AISHA_LOCAL_STACK:-${libDefault}}`);
  });

  test("run-devstack.mjs falls back through AISHA_LOCAL_STACK to the SoT default", () => {
    const src = read("scripts/e2e/run-devstack.mjs");
    expect(src).toContain("process.env.AISHA_LOCAL_STACK");
    expect(src).toContain(`"${libDefault}"`);
  });

  test("no hardcoded stack-name string literals left in the generator/namespacing code", () => {
    for (const rel of ["scripts/local-compose-gen.mjs", "scripts/lib/container-namespacing.mjs"]) {
      const src = read(rel);
      expect(src, `${rel} must derive the stack name from local-stack-name.mjs`).not.toContain('"aisha-local"');
      expect(src, `${rel} must not hardcode the current default either`).not.toContain(`"${libDefault}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Divergent-duplicate SERVICE-KEY namespacing (distinct from container_name
// namespacing above). Several stacks define a service with the same KEY but
// DIFFERENT config — the canonical case is `pki-init` (runs
// issue-netbird-mesh-cert.sh in netbird, copies a CA bundle in langfuse, builds
// a combined bundle in observability). A naive merge does last-wins and silently
// drops every variant but one. The generator namespaces divergent INIT
// containers per stack (<stack>__pki-init) and rewrites same-file references;
// long-lived divergent services (redis, netbird-agent) are hostname-reached and
// stay shared.
// ─────────────────────────────────────────────────────────────────────────────
describe("local-compose-gen — divergent-duplicate service-key namespacing", () => {
  const gen = read("scripts/local-compose-gen.mjs");

  test("generator namespaces divergent INIT services and rewrites same-file refs", () => {
    expect(gen, "must scan for divergent duplicates across stacks").toMatch(
      /diffServiceConfig\(first,\s*d\.def\)/,
    );
    expect(gen, "must namespace divergent service keys per stack").toContain("namespaceServiceKey");
    expect(gen, "must rewrite same-file references for renamed peers").toContain("rewriteServiceRefs");
    // Init-only restriction: long-lived services (redis, netbird-agent) are
    // hostname-reached and must NOT be split into per-stack instances.
    expect(gen, "must restrict namespacing to init/one-shot containers (restart 'no')").toMatch(
      /restart\s*===\s*["']no["']/,
    );
    for (const ref of ["depends_on", "network_mode", "volumes_from"]) {
      expect(gen, `rewriteServiceRefs must handle ${ref}`).toContain(ref);
    }
  });

  test.skipIf(!dockerAvailable())(
    "real --preset full render namespaces pki-init with no dangling refs",
    () => {
      execFileSync("node", ["scripts/local-compose-gen.mjs", "--preset", "full"], {
        cwd: ROOT,
        stdio: "pipe",
      });
      const generated = JSON.parse(
        readFileSync(join(ROOT, "docker-compose.local.generated.json"), "utf8"),
      ) as { name?: string; services: Record<string, Record<string, unknown>> };
      const keys = Object.keys(generated.services);

      // The rendered project name must be THIS implementation's stack.
      expect(generated.name).toBe(LOCAL_STACK);

      // Every divergent pki-init variant must be namespaced — no bare survivor.
      const pkiKeys = keys.filter((k) => k === "pki-init" || k.endsWith("__pki-init"));
      expect(pkiKeys.length, "at least two namespaced pki-init instances expected").toBeGreaterThan(1);
      expect(keys, "no bare 'pki-init' key — every divergent variant is namespaced").not.toContain(
        "pki-init",
      );

      // No depends_on / network_mode reference may dangle after namespacing.
      const keySet = new Set(keys);
      const dangling: string[] = [];
      for (const [name, svc] of Object.entries(generated.services)) {
        const dep = svc.depends_on as string[] | Record<string, unknown> | undefined;
        const deps = Array.isArray(dep) ? dep : dep ? Object.keys(dep) : [];
        for (const d of deps) if (!keySet.has(d)) dangling.push(`${name}.depends_on → ${d}`);
        const nm = svc.network_mode;
        if (typeof nm === "string" && nm.startsWith("service:")) {
          const target = nm.slice("service:".length);
          if (!keySet.has(target)) dangling.push(`${name}.network_mode → ${target}`);
        }
      }
      expect(dangling, `dangling references after namespacing: ${dangling.join(", ")}`).toHaveLength(0);
    },
  );
});
