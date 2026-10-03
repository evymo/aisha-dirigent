/**
 * Gate: JWKS se nikdy netahá přes jméno servírované ZVENČÍ.
 *
 * Dosažitelné zevnitř jsou DVĚ cesty a obě jsou v pořádku:
 *   · kontejnerový alias (docker síť) — nutný v BOOTSTRAP cestě
 *   · mesh adresa — privátní overlay; jediná, která přežije vícenodový fleet
 * Vadná je jen ta třetí: veřejné, zvenčí servírované jméno.
 *
 * WHY (measured three times, three different services)
 * ----------------------------------------------------
 * A public (or mesh) hostname dialled from inside a container leaves for the
 * public IP and does not come back. When that hostname is the JWKS endpoint, the
 * failure is always the same shape and always looks like an authorization bug:
 * the JWKS fetch fails, `jose` cannot verify, every token is rejected 401.
 *
 *   2026-07-20  svc-pki-bridge  KEYCLOAK_DOMAIN_DIRECT "via the hairpin".
 *               Measured from the container: https://auth.backend.<mesh-tld>
 *               -> cert mismatch, then 503; http://aisha-keycloak:80 -> OK.
 *               Consequence: /v1/issue rejected every token, so no mesh cert was
 *               ever issued — the mesh could not come up because verifying the
 *               token needed the mesh.
 *   2026-08-04  aisha-gateway   KC_JWKS_URL on https://${KEYCLOAK_DOMAIN}.
 *               Consequence: get_surface_layout 401 for every signed-in user;
 *               the extranet and the web console both rendered empty.
 *   2026-08-04  svc-ai-chat     the same value, the same shape.
 *
 * Three occurrences of one property is not three bugs, it is a missing gate. The
 * fix that keeps working is structural: signing keys are public data and the hop
 * never has to leave the docker network, so the in-cluster alias is correct AND
 * mesh-independent AND hairpin-independent AND needs no certificate.
 *
 * The rule is DIRECTIONAL, and the opposite rule holds on the other side: a
 * browser or a native client MUST use the public domain. This gate therefore
 * never looks at VITE_*, EXPO_PUBLIC_*, NEXT_PUBLIC_* or build args.
 *
 * ⚠️ KDE JE HRANICE MEZI ALIASEM A MESHEM (opraveno 2026-08-04 majitelem)
 * Kontejnerový alias je POVINNÝ jen tam, kde mesh ještě neexistuje — tedy
 * u svc-pki-bridge, který ověřuje token, jímž se mesh certifikát teprve razí.
 * Tam je mesh kruh: ověření by čekalo na mesh, který bez toho ověření nevznikne.
 * Všude jinde (svc-agent-runner, svc-blockchain/ledger) mesh v okamžiku běhu
 * dávno stojí a je to správná cesta — navíc jediná, která funguje, když služby
 * sedí na různých nodech (`ledger` má placement `experimental`, Keycloak
 * `backend`, a docker alias hranici nodu nepřekročí).
 * Původní verze téhle brány vyžadovala in-cluster plošně; bylo to přehnané
 * zobecnění jedné měřené vady a rozbilo by právě vícenodové nasazení.
 *
 * WHAT THIS GATE DELIBERATELY DOES NOT CHECK
 * ------------------------------------------
 * - `*_ISSUER*`, `OAUTH2_PROXY_LOGIN_URL`, `OAUTH2_PROXY_REDIRECT_URL`: these are
 *   not fetches. An issuer is a string compared against the `iss` claim, which
 *   Keycloak mints from KC_HOSTNAME, and a login/redirect URL is where a BROWSER
 *   goes. They must stay public. pki-bridge-public-issuer.gate.test.ts owns that
 *   direction and would fail if this gate "fixed" them.
 * - pki-renewer and pki-init calling the TOKEN endpoint over the public host:
 *   owned by pki-renewer-kc-public-dns.gate.test.ts, which REQUIRES the public
 *   host and FORBIDS a host-gateway pin there — on a split fleet host-gateway:443
 *   serves a self-signed cert (incident 2026-07-17). Different endpoint, opposite
 *   rule, different owner.
 * - Anything under docs/ or any *.md: prose describing this very property must not
 *   be readable as a violation of it. A gate in this repo has already flagged its
 *   own documentation once.
 * - Scripts that run on the HOST (scripts/smoke-*.sh, check-infra.mjs,
 *   cold-start-verify.mjs, e2e/*.spec.ts): they are not in the cluster, so
 *   discovery over the public domain is correct for them.
 *
 * To fix a failure: point the value at ${KEYCLOAK_INTERNAL_URL:-http://aisha-keycloak:80}
 * (see docker-compose.coolify.yml, -realtime.yml, -matrix.yml for the shape), or —
 * for an oauth2-proxy block that must keep the public host — add the extra_hosts pin.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

// src/tests/gates/ -> repo root is THREE levels up.
const ROOT = resolve(__dirname, "../../..");

/** Compose universe, DISCOVERED. `local` variants are generated; `.example` is a sample. */
function composeFiles(): string[] {
  return readdirSync(ROOT).filter(
    (f) =>
      /^docker-compose\..*\.ya?ml$/.test(f) &&
      !f.includes("local") &&
      !f.endsWith(".example"),
  );
}

interface Svc {
  file: string;
  name: string;
  body: string;
}

/**
 * Split a compose file into service blocks. A service is a key at EXACTLY two
 * spaces; any key at zero indent (networks:, volumes:, x-anchors) closes it.
 * Comment lines are kept in the body — they are dropped only where they would
 * otherwise produce a finding, never globally, or the block loses its context.
 */
function services(file: string): Svc[] {
  const lines = readFileSync(resolve(ROOT, file), "utf-8").split("\n");
  const out: Svc[] = [];
  let cur: Svc | null = null;
  for (const line of lines) {
    const m = line.match(/^ {2}([a-z][a-z0-9_-]*):\s*$/);
    if (m) {
      if (cur) out.push(cur);
      cur = { file, name: m[1], body: "" };
      continue;
    }
    if (/^[A-Za-z]/.test(line)) {
      if (cur) {
        out.push(cur);
        cur = null;
      }
      continue;
    }
    if (cur) cur.body += line + "\n";
  }
  if (cur) out.push(cur);
  return out;
}

const ALL_SERVICES = composeFiles().flatMap(services);

/** `KEY: value` and `- KEY=value`, comment lines skipped. Prose is never read. */
function envPairs(body: string): { key: string; value: string; line: string }[] {
  const out: { key: string; value: string; line: string }[] = [];
  for (const raw of body.split("\n")) {
    if (raw.trimStart().startsWith("#")) continue;
    const colon = raw.match(/^\s{2,}([A-Z][A-Z0-9_]*):\s*(.+?)\s*$/);
    if (colon) {
      out.push({ key: colon[1], value: colon[2], line: raw.trim() });
      continue;
    }
    const dash = raw.match(/^\s*-\s+([A-Z][A-Z0-9_]*)=(.*)$/);
    if (dash) out.push({ key: dash[1], value: dash[2], line: raw.trim() });
  }
  return out;
}

const unquote = (v: string) => v.replace(/^["']|["']$/g, "");

/** A JWKS/discovery endpoint is recognised by its PATH, not by the variable name. */
const isJwksPath = (v: string) =>
  /\/protocol\/openid-connect\/certs/.test(v) ||
  /\/\.well-known\/openid-configuration/.test(v);

/** Names that are served from OUTSIDE and therefore unreachable from a container. */
const PUBLIC_MARKERS = [
  "${KEYCLOAK_DOMAIN}",
  "${KEYCLOAK_DOMAIN_PUBLIC}",
  "${KEYCLOAK_DOMAIN_DIRECT}",
  "${KEYCLOAK_URL",
  "${AUTH_DOMAIN",
];

/**
 * Mesh adresa. NENÍ to „jméno servírované zvenčí" — je to privátní overlay síť,
 * a pro službu, která NENÍ v bootstrap cestě, je to legitimní (a na vícenodovém
 * fleetu jediná funkční) cesta k JWKS: docker alias hranici nodu nepřekročí,
 * mesh ano. Kruh vzniká jen u toho, kdo mesh certifikát teprve razí.
 */
const isMesh = (v: string) => /\.mesh\./.test(v) || v.includes("${MESH_TLD");

/**
 * In-cluster means: the resolver-issued KEYCLOAK_INTERNAL_URL, or a bare container
 * alias (a host with no dot — docker's own DNS namespace). `https://` anywhere is
 * disqualifying on its own: TLS to a container alias is not a thing we do.
 */
function isReachableFromInside(rawValue: string): boolean {
  const v = unquote(rawValue);
  if (isMesh(v)) return true; // privátní overlay, ne veřejné jméno
  if (v.includes("https://")) return false;
  if (PUBLIC_MARKERS.some((m) => v.includes(m))) return false;
  if (v.startsWith("${KEYCLOAK_INTERNAL_URL")) return true;
  if (/^\$\{KC_JWKS_URL\}?$/.test(v)) return true; // e2e injector, asserted below
  return /^http:\/\/[a-z0-9-]+(:\d+)?(\/|$)/.test(v);
}

// ─── consumer registry: DERIVED from source, never hand-listed ───────────────

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

/**
 * `keycloakInternalUrl: process.env.KEYCLOAK_INTERNAL_URL ?? ...` -> ident => env name.
 *
 * ⛔ 2026-08-24: rozpoznává se i `requireEnv('X', …)`. Do té doby uměl vazbu
 * jen z `process.env.X`, takže když se dvacet služeb převedlo z dosazování
 * (`?? 'http://keycloak:8080'`) na povinnou hodnotu, univerzum téhle brány se
 * scvrklo pod vlastní práh a spadlo tvrzení „univerzum není prázdné".
 *
 * ⭐ Ta brána si tím ale posvítila správně: měřidlo, které hledá podle IDIOMU,
 * mine všechno, co idiom změní — a mlčení by jinak vypadalo jako čisto. Proto
 * tu ten práh je.
 */
function envBindings(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(
    /([A-Za-z_$][\w$]*)\s*[:=]\s*process\.env\.([A-Z0-9_]+)/g,
  )) {
    if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  for (const m of text.matchAll(
    /([A-Za-z_$][\w$]*)\s*[:=]\s*requireEnv\(\s*['"]([A-Z0-9_]+)['"]/g,
  )) {
    if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

/**
 * Which env var a file's JWKS URL is actually BUILT FROM.
 *
 * Coarser matching does not work here, and the reason is worth keeping: asking
 * "does this file mention both the certs path and KEYCLOAK_URL" reports
 * svc-pki-bridge, which is CORRECT code. Its config.ts holds both bases on
 * purpose — `keycloakInternalUrl` for the JWKS fetch and `keycloakUrl` for
 * `expectedIssuer`, which must stay public because it is compared against the
 * `iss` claim. The two differ by exactly one identifier inside one template
 * literal, so that identifier is what gets resolved — no name is ever exempted.
 */
function jwksBaseEnvVars(text: string): string[] {
  const bindings = envBindings(text);
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("*")) continue;
    if (!/\/protocol\/openid-connect\/certs/.test(line)) continue;

    const inline = line.match(/process\.env\.([A-Z0-9_]+)/);
    if (inline) {
      found.push(inline[1]);
      continue;
    }
    const ref = line.match(
      /\$\{\s*(?:this\.|cfg\.|config\.|c\.)?([A-Za-z_$][\w$]*)\s*\}/,
    );
    const env = ref ? bindings.get(ref[1]) : undefined;
    if (env) found.push(env);
  }
  return found;
}

/**
 * Universe: every service that builds a JWKS URL at all, mapped to the env vars
 * it builds it from. Derived from source — a hand-kept list of service names
 * would only ever measure what somebody remembered, and the construction does
 * not always live in config.ts (svc-source-broker builds it in auth-guard.ts).
 */
function jwksBuildingServices(): Map<string, Set<string>> {
  const base = resolve(ROOT, "services");
  const out = new Map<string, Set<string>>();
  if (!existsSync(base)) return out;
  for (const svc of readdirSync(base)) {
    const src = join(base, svc, "src");
    if (!existsSync(src)) continue;
    const vars = new Set<string>();
    for (const f of walk(src)) {
      for (const v of jwksBaseEnvVars(readFileSync(f, "utf-8"))) vars.add(v);
    }
    if (vars.size) out.set(svc, vars);
  }
  return out;
}

const JWKS_BUILDERS = jwksBuildingServices();
const JWKS_FROM_KC_URL = [...JWKS_BUILDERS]
  .filter(([, vars]) => vars.has("KEYCLOAK_URL"))
  .map(([svc]) => svc);

/** Compose blocks that build or name a given service. */
function blocksFor(svcDir: string): Svc[] {
  return ALL_SERVICES.filter(
    (s) =>
      new RegExp(`services/${svcDir}[/"\\s]`).test(s.body) ||
      new RegExp(`container_name:.*${svcDir}\\s*$`, "m").test(s.body),
  );
}

// ─── 1. The universe must not be empty ──────────────────────────────────────

describe("server-side JWKS stays inside the cluster", () => {
  it("the universe is seeded from reality and is not empty", () => {
    // Without this, every `expect(violations).toEqual([])` below would also pass
    // on the day a regex stops matching anything at all.
    expect(composeFiles().length).toBeGreaterThan(10);
    expect(ALL_SERVICES.length).toBeGreaterThan(50);
    // The universe is "services that build a JWKS URL", NOT "services that get it
    // wrong" — the latter is supposed to reach zero, and asserting on it would
    // turn a fully fixed repo into a failing gate.
    expect(JWKS_BUILDERS.size).toBeGreaterThan(5);

    // Rule 4 has its OWN universe and therefore its own emptiness risk. Found the
    // hard way while negative-testing this gate: removing one block's extra_hosts
    // pin left rule 4 green, which read like a broken rule and was actually a
    // correct one (that block also carries `dns:`). Had the oauth2-proxy universe
    // been empty instead, the same green would have been meaningless — and
    // indistinguishable from this.
    const oauthBlocks = ALL_SERVICES.filter((s) =>
      envPairs(s.body).some((p) => p.key === "OAUTH2_PROXY_OIDC_JWKS_URL"),
    );
    expect(oauthBlocks.length).toBeGreaterThan(5);
  });

  // ─── 2. Explicit JWKS URLs ────────────────────────────────────────────────

  it("an explicit JWKS or discovery URL never points at a name served from outside", () => {
    const violations: string[] = [];
    for (const svc of ALL_SERVICES) {
      for (const { key, value, line } of envPairs(svc.body)) {
        if (!isJwksPath(value)) continue;
        // oauth2-proxy keeps the public host by convention; rule 3 owns it.
        if (key.startsWith("OAUTH2_PROXY_")) continue;
        if (/ISSUER/.test(key)) continue;
        if (!isReachableFromInside(value)) {
          violations.push(`${svc.file}: ${svc.name}: ${line}`);
        }
      }
    }
    expect(
      violations,
      "A container dialling one of these leaves for the public IP and never comes " +
        "back; the JWKS fetch fails and every token is rejected 401:\n  " +
        violations.join("\n  "),
    ).toEqual([]);
  });

  // ─── 3. (zrušeno) JWKS odvozené ze základní URL ───────────────────────────
  //
  // Tady stálo tvrzení „služba, která si jwks_uri skládá z KEYCLOAK_URL, musí
  // dostat KEYCLOAK_URL in-cluster". Bylo ŠPATNĚ a majitel to 2026-08-04 vrátil:
  // in-cluster alias je nutný jen v BOOTSTRAP cestě — u svc-pki-bridge, který
  // ověřuje token, jímž se teprve razí mesh certifikát. Přes mesh je to kruh:
  // ověření by čekalo na mesh, který bez toho ověření nevznikne.
  //
  // Ostatní logika (svc-agent-runner, svc-blockchain/ledger) v bootstrapu NENÍ —
  // v okamžiku, kdy ověřuje tokeny, mesh dávno běží. Mesh je u nich navíc JEDINÁ
  // funkční cesta, jakmile je fleet vícenodový: `ledger` má v config/services.json
  // placement `experimental`, Keycloak `backend`, a docker alias hranici nodu
  // nepřekročí. Vynucovat u nich in-cluster by tedy rozbilo přesně to nasazení,
  // pro které je mesh postavený.
  //
  // Zbylá dvě tvrzení stačí: co je EXPLICITNÍ JWKS URL, musí být dosažitelné
  // zevnitř (pravidlo 2), a oauth2-proxy, který si nechává veřejný host, musí
  // nést mechanismus, jak si ho přeložit (pravidlo 4). Staticky se navíc nedá
  // rozhodnout, kam `${KEYCLOAK_URL}` ukáže — resolver ho pod MESH_ENABLED vydá
  // jako mesh adresu — takže tvrzení o něm bylo i neměřitelné.

  // ─── 4. oauth2-proxy keeps the public host, but must be able to resolve it ──

  it("an oauth2-proxy that keeps the public host can still resolve it from inside", () => {
    const violations: string[] = [];
    for (const svc of ALL_SERVICES) {
      const pairs = envPairs(svc.body);
      const keepsPublicJwks = pairs.some(
        (p) =>
          p.key === "OAUTH2_PROXY_OIDC_JWKS_URL" &&
          PUBLIC_MARKERS.some((m) => unquote(p.value).includes(m)),
      );
      if (!keepsPublicJwks) continue;

      const body = svc.body
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#"))
        .join("\n");
      const hasHostPin = /extra_hosts:/.test(body) && /host-gateway/.test(body);
      const hasMeshDns = /^\s+dns:/m.test(body);
      if (!hasHostPin && !hasMeshDns) {
        violations.push(`${svc.file}: ${svc.name}`);
      }
    }
    expect(
      violations,
      "oauth2-proxy fetches JWKS server-side. Keeping the public host is the " +
        "convention here, but then the block must carry the mechanism that makes " +
        "that name resolvable from inside — an extra_hosts host-gateway pin or a " +
        "mesh dns: resolver. Without either, the proxy answers 500 on every " +
        "request the moment its profile is enabled:\n  " +
        violations.join("\n  "),
    ).toEqual([]);
  });
});
