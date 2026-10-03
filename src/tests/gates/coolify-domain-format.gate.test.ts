/**
 * Coolify Domain Format Gate
 *
 * Validuje contract `scripts/coolify-domain-doctor.mjs` PATCH formátu pro
 * Coolify v4 `docker_compose_domains` API.
 *
 * Failure modes z minulé session:
 *
 * 1. Objektová forma `{"n8n-auth": {...}}` silently mění pomlčky na podtržítka
 *    → auto-generated Traefik routery cílí na neexistující service ID.
 *    Fix: array form `[{"name":"n8n-auth", "domain":"..."}]` zachovává dashes.
 *
 * 2. `name` v contractu MUSÍ matchovat skutečný compose service name (s pomlčkou).
 *    Pokud doctor pošle `n8n_auth` ale compose service je `n8n-auth`, Coolify
 *    nenajde service při auto-gen Traefik labelu → 503.
 *
 * 3. `domain` URL nesmí obsahovat path/query/fragment artifacts (`?`, `#`).
 *
 * 4. Port v URL `https://host:PORT` musí matchovat compose `expose:` deklaraci
 *    daného service'u.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function readSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function getComposeFiles(): { relPath: string; content: string }[] {
  const out: { relPath: string; content: string }[] = [];
  for (const name of readdirSync(ROOT)) {
    if (name.startsWith("docker-compose") && name.endsWith(".yml")) {
      if (name.includes("local")) continue;
      out.push({ relPath: name, content: readSafe(join(ROOT, name)) });
    }
  }
  return out;
}

function parseServiceNames(content: string): string[] {
  const names: string[] = [];
  let inServices = false;
  for (const line of content.split("\n")) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^[a-z][\w-]*:/i.test(line) && !line.startsWith(" ")) {
      inServices = false;
      continue;
    }
    if (inServices) {
      const m = line.match(/^ {2}([a-zA-Z][\w-]*):/);
      if (m) names.push(m[1]);
    }
  }
  return names;
}

function extractServiceBlock(content: string, name: string): string | null {
  const lines = content.split("\n");
  let inServices = false;
  let capturing = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (!inServices) continue;
    if (/^[a-z][\w-]*:/i.test(line) && !line.startsWith(" ")) {
      if (capturing) break;
      inServices = false;
      continue;
    }
    const m = line.match(/^ {2}([a-zA-Z][\w-]*):/);
    if (m) {
      if (capturing) break;
      if (m[1] === name) { capturing = true; out.push(line); continue; }
    }
    if (capturing) {
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      if (indent <= 2 && line.trim() && /^\s{2}[a-zA-Z]/.test(line)) break;
      out.push(line);
    }
  }
  return out.length ? out.join("\n") : null;
}

function exposedPorts(block: string): number[] {
  const out: number[] = [];
  const m = block.match(/expose:\s*\n((?:\s+-\s+["']?\d+["']?\s*\n?)+)/);
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const pm = line.match(/-\s+["']?(\d+)["']?/);
    if (pm) out.push(parseInt(pm[1], 10));
  }
  return out;
}

const DOCTOR = readSafe(join(ROOT, "scripts/coolify-domain-doctor.mjs"));

describe("Coolify domain doctor — array form contract", () => {
  test("doctor file exists", () => {
    expect(existsSync(join(ROOT, "scripts/coolify-domain-doctor.mjs"))).toBe(true);
  });

  test("PATCH body uses array form (not nested object)", () => {
    // Pin the PROPERTY, not the spelling. Coolify's PATCH takes the ARRAY form
    // ([{name, domain}]); its GET returns the nested-object form, which must never be
    // echoed back. This used to be pinned as the literal `docker_compose_domains:
    // contract.domains`, which broke the moment the payload legitimately became a
    // *filtered* array (`routable` — contract.domains minus unroutable `.invalid`
    // sentinels, which Coolify indexes as real hosts and which collide across forks,
    // making it reject the whole payload; prod 2026-07-17). What actually matters:
    // the value is an identifier bound to a contract.domains-derived array — never an
    // object literal.
    expect(
      DOCTOR,
      "PATCH must send docker_compose_domains as an array identifier (not an inline object).",
    ).toMatch(/docker_compose_domains:\s*[A-Za-z_$][\w$]*(?:\.\w+)*\s*[,}]/);
    expect(
      DOCTOR,
      "the PATCHed array must derive from the contract's domains.",
    ).toMatch(/=\s*contract\.domains(?:\.filter\(|\s*[;,])/);
    expect(
      DOCTOR,
      "never send the nested-object form that Coolify's GET returns.",
    ).not.toMatch(/docker_compose_domains:\s*\{/);
  });

  test("contract entries use object-with-name shape", () => {
    const matches = [...DOCTOR.matchAll(/\{\s*name:\s*["']([^"']+)["'],\s*domain:/g)];
    expect(matches.length, "Expected at least one { name, domain } entry").toBeGreaterThanOrEqual(5);
  });
});

describe("Coolify domain doctor — service names", () => {
  const NAME_RE = /\{\s*name:\s*["']([^"']+)["'],\s*domain:/g;
  const entries: { name: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = NAME_RE.exec(DOCTOR)) !== null) {
    entries.push({ name: match[1] });
  }

  test("at least 10 contract entries discovered", () => {
    // 2026-06-10: raised back 5 → 10. The 2026-05-10 lowering assumed KC +
    // observability + admin + messaging route via explicit Traefik labels in
    // compose (domains: [] in the contract). That model was empirically
    // reversed: Coolify escapes $ → $$ in label values, so ${VAR} Traefik
    // labels are dead on Coolify — all aisha domains are registered via
    // docker_compose_domains again (two-plane model: compose ${VAR} labels
    // serve local/e2e, the doctor contract serves Coolify). The contract now
    // carries ~19 populated entries; floor 10 catches a wholesale drop while
    // tolerating intentional single-app moves.
    expect(entries.length).toBeGreaterThanOrEqual(10);
  });

  test("every name matches Coolify-normalized form of a compose service", () => {
    // Coolify parsers.php normalizes compose service names via
    // str()->replace('-','_') before docker_compose_domains lookup.
    // Doctor keys MUST use the normalized (underscore) form for
    // dash-containing services, otherwise Coolify silently skips
    // Traefik label generation → 404.
    const composes = getComposeFiles();
    const allServices = new Set<string>();
    for (const f of composes) for (const s of parseServiceNames(f.content)) allServices.add(s);

    const coolifyNormalize = (n: string) => n.replace(/-/g, "_");
    const normalizedServices = new Set([...allServices].map(coolifyNormalize));

    const orphans = entries.filter((e) => !normalizedServices.has(coolifyNormalize(e.name)));
    expect(
      orphans.map((e) => `${e.name} → no compose service matches (after Coolify dash→underscore normalization)`),
      "Doctor contract references services that don't exist in compose files (after Coolify normalization)",
    ).toEqual([]);
  });
});

describe("Coolify domain doctor — domain URL hygiene", () => {
  const NAME_RE = /\{\s*name:\s*["']([^"']+)["'],\s*domain:\s*`([^`]+)`/g;
  const entries: { name: string; domain: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = NAME_RE.exec(DOCTOR)) !== null) {
    entries.push({ name: m[1], domain: m[2] });
  }

  test("no domain entry contains query or fragment artifacts", () => {
    const bad = entries.filter((e) => /[?#]/.test(e.domain));
    expect(
      bad.map((e) => `${e.name}: ${e.domain} (contains ? or #)`),
      "Domain URLs must be clean — no query strings or fragments",
    ).toEqual([]);
  });

  test("every domain uses https:// (except non-routable .invalid sentinels)", () => {
    // `.invalid` sentinels (RFC 2606) are placeholders for services with NO public
    // listener (mesh-router) — nothing ever dials them, so the https requirement does not
    // apply. They only became visible to this parser once made prefix-unique (a template
    // literal, so it stops 409ing against co-tenants) — the gate was blind to the old
    // bare-string literal, not protecting it.
    const bad = entries.filter((e) => !e.domain.startsWith("https://") && !/\.invalid\b/.test(e.domain));
    expect(bad.map((e) => `${e.name}: ${e.domain}`)).toEqual([]);
  });

  test("port (if present) matches a service expose: declaration", () => {
    const composes = getComposeFiles();
    const violations: string[] = [];

    for (const e of entries) {
      const portMatch = e.domain.match(/:(\d+)$/);
      if (!portMatch) continue;
      const targetPort = parseInt(portMatch[1], 10);

      let block: string | null = null;
      for (const f of composes) {
        const candidate = extractServiceBlock(f.content, e.name);
        if (candidate) { block = candidate; break; }
      }
      if (!block) continue;

      const ports = exposedPorts(block);
      if (ports.length === 0) continue;

      if (!ports.includes(targetPort)) {
        violations.push(
          `${e.name} contract port :${targetPort} doesn't match exposed ports [${ports.join(",")}]`,
        );
      }
    }

    expect(
      violations,
      "Doctor contract port mismatches with compose expose:",
    ).toEqual([]);
  });
});

describe("Coolify domain doctor — dynamic-only domains (no hardcoded hosts)", () => {
  // The whole stack composes hostnames from the env contract (config/domains.env
  // + derived topology), exactly like local-warmup and aisha-cold-start do
  // throughout. EVERY domain-doctor domain value must therefore be assembled
  // dynamically from `${env.VAR}` — never a baked-in literal hostname. The only
  // allowed non-interpolated values are explicit non-routable sentinels
  // (*.invalid) used to suppress Coolify auto-gen for listener-less services.
  //
  // This single check enforces the "only-dynamic variable filling" contract
  // for ALL apps at once (present and future) — adding a new app with a
  // hardcoded host in the contract fails here, no per-app gate needed.

  function isCompliant(domain: string): boolean {
    const dynamic = domain.includes("${env.");
    const sentinel = /\.invalid\b/.test(domain);
    return dynamic || sentinel;
  }

  test("every backtick-literal domain value is env-driven (${env.VAR}) or a .invalid sentinel", () => {
    const violations: string[] = [];
    for (const m of DOCTOR.matchAll(/\{\s*name:\s*["']([^"']+)["'],\s*domain:\s*`([^`]+)`/g)) {
      const [, name, domain] = m;
      if (!isCompliant(domain)) violations.push(`${name}: ${domain}`);
    }
    expect(
      violations,
      "domain-doctor domains MUST be composed from ${env.VAR} (single source of truth = env contract), never hardcoded hostnames",
    ).toEqual([]);
  });

  test("every array-form domain value (e.g. edge-proxy multi-host) is env-driven", () => {
    const violations: string[] = [];
    // Matches `name: "edge-proxy", domain: [ `https://${env.X}`, ... ]`
    for (const m of DOCTOR.matchAll(/name:\s*["']([^"']+)["'],\s*\n?\s*domain:\s*\[([\s\S]*?)\]/g)) {
      const [, name, arrBody] = m;
      for (const lit of arrBody.matchAll(/`([^`]+)`/g)) {
        if (!isCompliant(lit[1])) violations.push(`${name}: ${lit[1]}`);
      }
    }
    expect(
      violations,
      "array-form domain-doctor entries MUST also compose every host from ${env.VAR}",
    ).toEqual([]);
  });
});
