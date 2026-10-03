/**
 * Traefik Host Coverage Gate
 *
 * Every `Host(\`literal\`)` in compose Traefik labels must be a hostname
 * that the topology resolver KNOWS about — i.e. it's emitted as a domain
 * for some service in the cloud-multi profile (mesh OFF, the production
 * reality).
 *
 * Why this gate:
 *   Traefik labels can't use ${VAR} substitution (Coolify $→$$ escape),
 *   so hostnames are LITERAL. Without a check, drift between
 *   config/services.json and compose labels goes silently undetected
 *   until a route returns 404 in production.
 *
 *   See docs/deploy/TRAEFIK_LABELS.md for the full convention.
 *
 * What's checked:
 *   - For every compose file, every `Host(\`...\`)` literal is extracted
 *   - Each extracted hostname must match a *_DOMAIN var emitted by
 *     `node scripts/lib/derive-domains.mjs --shell --profile=cloud-multi`
 *   - Allowed exceptions tracked in EXCEPTION list (sentinel hosts,
 *     legacy mesh.aisha.internal entries, etc.)
 */
import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const DERIVE_SCRIPT = join(ROOT, "scripts/lib/derive-domains.mjs");

function getComposeFiles(): { name: string; content: string }[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT)
    .filter((n) => n.startsWith("docker-compose.coolify-") && n.endsWith(".yml"))
    .map((n) => ({ name: n, content: readFileSync(join(ROOT, n), "utf-8") }));
}

/**
 * OWNS: topology COVERAGE — every host the resolver emits must be routed.
 * The FORM of a label value is owned by
 * src/tests/gates/coolify-traefik-label-substitution.gate.test.ts.
 *
 * This function deliberately collects only LITERAL hosts. `${VAR}` forms are
 * not "handled elsewhere and therefore fine" — they are DEAD (Coolify escapes
 * `$` -> `$$` in label values, so the router never matches), and the
 * substitution gate rejects them outright. Counting one here would report
 * coverage that does not exist.
 *
 * That is not a hypothetical: until 2026-07-18 this skip said "caught by a
 * separate gate" while the substitution gate enforced the rule on ONE compose
 * file and its header recommended the dead form. Each gate assumed the other
 * covered it; neither did, and 56 dead labels accumulated across 14 files.
 * Keep the two ownerships explicit — never re-introduce a cross-reference that
 * lets a case fall between them.
 */
function extractHostLiterals(content: string): Set<string> {
  const hosts = new Set<string>();
  for (const m of content.matchAll(/Host\(`([^`$]+)`\)/g)) {
    if (!m[1].includes("$")) hosts.add(m[1]);
  }
  return hosts;
}

/**
 * Every env var derive-domains.mjs reads. The gate builds its expectations from
 * config/profiles/cloud-multi.json.example — the resolver's own documented
 * fallback when no TLD env is set — so ANY ambient value here makes the gate
 * compare real emitted hosts against reference expectations, i.e. test nothing.
 *
 * That is not hypothetical. On 2026-07-19 a pre-push shell had sourced
 * .env-prod-backup (for OPENXPKI_OPERATOR_PASSWORD) and 7 of these 8 keys came
 * with it; the gate then failed with "catalog is incomplete" while the catalog
 * was fine. Same commit, same tree: 4/4 green in a clean shell, 2 failures in a
 * contaminated one. A gate whose verdict depends on the caller's shell is not a
 * gate — it reports the environment, not the code.
 *
 * So the resolver is ALWAYS invoked with these stripped, and a test below pins
 * that independence so it cannot silently come back.
 */
// Imported, not copied: a local list drifts. See derive-domains.mjs.
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";

/** process.env minus every resolver input — the resolver falls back to the .example profile. */
function neutralEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of RESOLVER_ENV_INPUTS) delete env[key];
  return env;
}

function buildResolverHostSetWithEnv(overrides: NodeJS.ProcessEnv = {}): Set<string> {
  const out = execFileSync(
    "node",
    [DERIVE_SCRIPT, "--profile=cloud-multi", "--mesh=off", "--shell"],
    { cwd: ROOT, encoding: "utf-8", env: { ...neutralEnv(), ...overrides } },
  );
  const hosts = new Set<string>();
  for (const line of out.split("\n")) {
    const m = line.match(/^[A-Z][A-Z0-9_]*_DOMAIN=(.+)$/);
    if (m && m[1]) hosts.add(m[1]);
  }
  return hosts;
}

function buildResolverHostSet(): Set<string> {
  return buildResolverHostSetWithEnv();
}

// Hosts allowed to appear in compose Traefik labels even though the
// topology resolver doesn't emit them. Each entry should have a comment
// explaining WHY (sentinel, etc.). Pre-resolver legacy entries removed
// in 2026-05-10 cleanup — those services are now either modeled in the
// catalog (monitoring/dozzle) or not actually present as Host labels
// (livekit/turn are env-var-only references, no compose router).
const HOST_EXCEPTIONS = new Set<string>([
  // Sentinel domains used to suppress Coolify auto-gen routing.
  // (.invalid TLD is reserved per RFC 6761 — unroutable.)
  "edge-proxy-disabled.invalid",
  // (netbird-disabled.invalid removed 2026-07. Od 2026-09-16 veřejné jméno
  // registruje edge-proxy a posílá ho na přímou tvář netbird-proxy — viz
  // coolify-domain-doctor.mjs a netbird-verejna-tvar-obsluhuje-edge.)
  // Admin tooling routes (NocoDB/Appsmith/intranet under admin extra_subdomains or pgadmin alias);
  // not all are modeled as top-level "subdomain" in services.json (pgadmin/db noted as separate concern in core entry).
  "db.aisha.guru",
  "db.backend.aisha.guru",
  "nocodb.aisha.guru",
  "appsmith.aisha.guru",
  "intranet.aisha.guru",
  // Internal bridge / observability / special public aliases that use extra_subdomains or are intentionally labeled
  // with .backend. or specific names; resolver may not emit the exact public form for all label cases.
  "pki-bridge.backend.aisha.guru",
  "keycloak.backend.aisha.guru",
  "langfuse.aisha.guru",
  "dozzle.aisha.guru",
  "call.aisha.guru",
  // Messaging extras (matrix/element/call) and n8n public face are modeled via extra_subdomains/public_aliases
  // in services.json under "messaging" / "orchestration", but the exact emitted set in the gate's resolver
  // may not include every public alias variant used in direct router labels. Listed here as intentional.
  "matrix.aisha.guru",
  "element.aisha.guru",
  "n8n.aisha.guru",
]);

describe("Traefik Host coverage — labels match topology resolver", () => {
  test("every Host(`literal`) in compose labels is a known topology hostname", () => {
    const resolverHosts = buildResolverHostSet();
    const violations: string[] = [];

    for (const file of getComposeFiles()) {
      const literals = extractHostLiterals(file.content);
      for (const host of literals) {
        if (resolverHosts.has(host)) continue;
        if (HOST_EXCEPTIONS.has(host)) continue;
        violations.push(
          `${file.name}: Host(\`${host}\`) is not emitted by the topology resolver. ` +
            `Add this service to config/services.json (subdomain + placement) or, if it's ` +
            `intentional, add the host to HOST_EXCEPTIONS in this gate.`,
        );
      }
    }

    expect(
      violations,
      "Drift between compose Traefik labels and topology resolver:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  test("resolver hostnames cover all required services", () => {
    const resolverHosts = buildResolverHostSet();
    // Reference TLDs read DYNAMICALLY from the .example profile — the same
    // source the resolver falls back to when no TLD env is set. The gate
    // checks coverage of the reference topology without hardcoding domains.
    const example = JSON.parse(
      readFileSync(join(ROOT, "config/profiles/cloud-multi.json.example"), "utf-8"),
    ) as { domain: { public_tld: string; internal_tld: string } };
    const PUB = example.domain.public_tld;
    const INT = example.domain.internal_tld;
    const REQUIRED_HOSTS = [
      `auth.backend.${INT}`,       // keycloak (must-have)
      `pki.backend.${INT}`,        // pki (key rotation)
      `pki-bridge.backend.${INT}`, // pki cert acquisition
      `n8n.backend.${INT}`,        // workflows
      `langfuse.backend.${INT}`,   // observability
      `web.${PUB}`,                // SPA
      `netbird.${PUB}`,            // mesh control
      `cache.${PUB}`,              // pull-through cache
      `api.backend.${INT}`,        // gateway internal
      `api.${PUB}`,                // gateway public alias
    ];

    const missing = REQUIRED_HOSTS.filter((h) => !resolverHosts.has(h));
    expect(
      missing,
      "Required hostnames missing from resolver — catalog is incomplete:\n" +
        missing.join("\n"),
    ).toEqual([]);
  });

  test("web public aliases are operator env, not hardcoded brand routes", () => {
    const example = JSON.parse(
      readFileSync(join(ROOT, "config/profiles/cloud-multi.json.example"), "utf-8"),
    ) as { domain: { public_tld: string } };
    const PUB = example.domain.public_tld;
    const resolverHosts = buildResolverHostSetWithEnv({ AISHA_WEB_PUBLIC_ALIASES: "corp" });

    expect(resolverHosts.has(`web.${PUB}`), "primary web host must remain routed").toBe(true);
    expect(resolverHosts.has(`corp.${PUB}`), "operator-provided web alias must be routed").toBe(true);
  });

  // Negative test for the 2026-07-19 contamination: a shell that happens to
  // carry deployment env must NOT change this gate's verdict. Values below are
  // deliberately unlike any real deployment — if they leak into the resolver
  // the emitted set changes and the assertion fails.
  test("verdict is independent of ambient deployment env", () => {
    const clean = [...buildResolverHostSet()].sort();

    const contaminated = { ...process.env } as NodeJS.ProcessEnv;
    for (const key of RESOLVER_ENV_INPUTS) contaminated[key] = "";
    contaminated.PUBLIC_TLD = "gate-contamination-public.test";
    contaminated.INTERNAL_TLD = "gate-contamination-internal.test";
    contaminated.MESH_TLD = "gate-contamination-mesh.test";
    contaminated.MESH_ENABLED = "true";

    // Re-run the whole helper with the polluted process env in place, exactly
    // as a pre-push shell that sourced an env file would.
    const saved: Record<string, string | undefined> = {};
    for (const key of RESOLVER_ENV_INPUTS) {
      saved[key] = process.env[key];
      process.env[key] = contaminated[key];
    }
    try {
      const underContamination = [...buildResolverHostSet()].sort();
      expect(
        underContamination,
        "resolver env leaked into the gate — buildResolverHostSet must strip RESOLVER_ENV_INPUTS",
      ).toEqual(clean);
      expect(
        underContamination.some((h) => h.includes("gate-contamination")),
        "contaminated TLDs reached the emitted host set",
      ).toBe(false);
    } finally {
      for (const key of RESOLVER_ENV_INPUTS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });

  test("docs/deploy/TRAEFIK_LABELS.md exists and references the resolver", () => {
    const docPath = join(ROOT, "docs/deploy/TRAEFIK_LABELS.md");
    expect(existsSync(docPath), "TRAEFIK_LABELS.md must exist").toBe(true);
    const doc = readFileSync(docPath, "utf-8");
    expect(doc, "doc must explain the literal-hostname constraint").toMatch(
      /literal hostname|literal/i,
    );
    expect(doc, "doc must mention the Coolify $-escape").toMatch(/escape|\$\$/);
    expect(doc, "doc must reference the topology resolver").toMatch(
      /derive-domains|services\.json|profile/i,
    );
  });
});
