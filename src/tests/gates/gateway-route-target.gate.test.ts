import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Gateway route-target contract gate.
 *
 * The gateway `/functions/v1/:name` proxy (services/gateway/src/routes/functions.ts)
 * forwards each request to `${upstream}/${rewritePath ?? name}`. The existing
 * mobile-function-route-table gate only checks that a function NAME exists in the
 * table — it never checks that the forwarded PATH actually resolves to a real
 * route on the target service. That blind spot let 20+ mappings drift to paths the
 * services never registered (Stripe webhook, SMS OTP, LiveKit token, subscription
 * status, governance vote, …) — each a silent 404 at runtime while every unit test
 * stayed green.
 *
 * This gate closes the loop STATICALLY (deterministic, no network, no service boot —
 * services `listen()` at import so they cannot be `inject()`-ed): for every
 * ROUTE_TABLE entry it resolves the target service's real Fastify routes — including
 * `register(plugin, { prefix })` mounts (the gateway's own `/admin` + `/internal`
 * routers) and `/foo/*` wildcards — and asserts the forwarded path matches one.
 *
 * It fails LOUD: an unresolvable `register()` symbol or a missing service dir throws
 * rather than silently passing, so the gate can never green-wash a real break.
 */

const ROOT = process.cwd();
const GATEWAY_SRC = resolve(ROOT, 'services/gateway/src');
const FUNCTIONS_FILE = resolve(GATEWAY_SRC, 'routes/functions.ts');

// ── ROUTE_TABLE parsing ────────────────────────────────────────────────────
// Each entry is a single line: 'name': { upstream: <expr>, rewritePath?: '<path>' },
interface Mapping {
  name: string;
  serviceDir: string; // absolute path to services/<svc> OR the gateway dir for localhost
  entryLabel: string; // human label for the target app (svc dir name or 'gateway')
  forwarded: string; // '/' + (rewritePath ?? name)
}

function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

/**
 * ⛔ 2026-08-25: `upstream` smí být i GETTER — `get upstream() { return X; }`.
 * Vznikl, když 40 fallbacků v tabulce nahradila fail-closed `vyzadovanaAdresa()`:
 * getter odkládá vyhodnocení na požádání, aby se modul dal načíst i bez env.
 * Brána tehdy z 61 položek uviděla 21 — filtr `upstream:` dvojtečku nenašel a
 * zbytek TIŠE přeskočila. Nerozšiřuj pět různých větví: sraz getter zpět na
 * `upstream: X` a všechna existující rozpoznání (localhost, http://, helper(),
 * config.klíč) platí dál beze změny.
 */
function bezGetteru(body: string): string {
  return body.replace(/get\s+upstream\s*\(\s*\)\s*\{\s*return\s+([\s\S]*?);\s*\}/g, 'upstream: $1');
}

/** Resolve an upstream host (or the mcpServiceUrl var) to the target service dir. */
function resolveServiceDir(name: string, body: string): { dir: string; label: string } {
  const isLocalhost = /http:\/\/localhost/.test(body) || /GATEWAY_PORT/.test(body);
  if (isLocalhost) return { dir: GATEWAY_SRC, label: 'gateway (self)' };
  if (/mcpServiceUrl/.test(body)) {
    return { dir: resolve(ROOT, 'services/svc-mcp-knowledge/src'), label: 'svc-mcp-knowledge' };
  }
  let host = body.match(/http:\/\/([a-zA-Z0-9-]+)(?::\d+|\$\{[^}]*\})?/)?.[1];
  if (!host) {
    // ⛔ 2026-08-19: upstream smí být i HELPER (`matrixUpstream()`), fail-closed
    // nad env. Jméno služby se pak bere z jeho těla — z `vyzadovanaAdresa(_,
    // 'svc-x')` nebo z prvního `svc-*` literálu. Bez tohohle brána padala na
    // NAČTENÍ přesně tehdy, když někdo hardcode správně zrušil.
    const volani = body.match(/upstream\s*:\s*([A-Za-z_$][\w$]*)\s*\(\)/)?.[1];
    if (volani) {
      const telo = readText(FUNCTIONS_FILE).match(
        new RegExp(`function ${volani}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`),
      )?.[1] ?? "";
      host = telo.match(/'(svc-[a-z0-9-]+)'/)?.[1] ?? telo.match(/(svc-[a-z0-9-]+)/)?.[1];
    }
  }
  if (!host) {
    // ⛔ 2026-08-25: `vyzadovanaAdresa('X_URL', 'svc-y')` deklaruje cílovou službu
    // druhým argumentem PŘÍMO v tabulce — bez fallbacku a bez adresy v kódu.
    host = body.match(/vyzadovanaAdresa\(\s*'[A-Z0-9_]+'\s*,\s*'([a-z][a-z0-9-]*)'/)?.[1];
  }
  if (!host) {
    // ⛔ 2026-08-24: upstream smí být i `config.<klíč>`. Do té doby tu bylo
    // 16 KOPIÍ téhož literálu `'http://svc-ai-chat:3011'` přímo v tabulce —
    // adresa bez prefixu instance, šestnáctkrát. Po sloučení do jednoho domova
    // (`config.aiChatUrl` → `vyzadovanaAdresa('AI_CHAT_SERVICE_URL','svc-ai-chat')`)
    // brána padala na NAČTENÍ. Zase platí: měřidlo musí následovat hodnotu tam,
    // kde bydlí, ne trvat na tom, že je vepsaná na místě.
    const klic = body.match(/upstream\s*:\s*config\.([\w$]+)/)?.[1];
    if (klic) {
      const cfg = readText(resolve(GATEWAY_SRC, 'config.ts'));
      // Celý ŘÁDEK, ne po první čárku: `vyzadovanaAdresa('X', 'svc-y')` nese
      // jméno služby až ve druhém argumentu.
      const radek = cfg.match(new RegExp(`${klic}\\s*:\\s*([^\n]+)`))?.[1] ?? '';
      host = radek.match(/'(svc-[a-z0-9-]+)'/)?.[1]
        ?? radek.match(/http:\/\/([a-zA-Z0-9-]+)/)?.[1];
    }
  }
  if (!host) {
    throw new Error(`[route-target] '${name}': cannot determine upstream host from: ${body.trim()}`);
  }
  const svc = host.startsWith('aisha-') ? host.slice('aisha-'.length) : host;
  const dir = resolve(ROOT, 'services', svc, 'src');
  if (!existsSync(dir)) {
    throw new Error(`[route-target] '${name}': upstream host '${host}' → no service dir at services/${svc}/src`);
  }
  return { dir, label: svc };
}

function parseRouteTable(): Mapping[] {
  const text = readText(FUNCTIONS_FILE);
  const start = text.indexOf('ROUTE_TABLE');
  const slice = text.slice(start);
  const rows: Mapping[] = [];
  const tablePattern = /^\s*'([^']+)'\s*:\s*\{([^\n]+)\},?\s*$/gm;
  for (const m of slice.matchAll(tablePattern)) {
    const name = m[1];
    const body = bezGetteru(m[2]);
    if (!/upstream\s*:/.test(body)) continue; // skip anything that isn't a real mapping
    const rewrite = body.match(/rewritePath:\s*'([^']+)'/)?.[1] ?? name;
    const { dir, label } = resolveServiceDir(name, body);
    rows.push({ name, serviceDir: dir, entryLabel: label, forwarded: `/${rewrite}` });
  }
  return rows;
}

// ── Static Fastify route resolver ──────────────────────────────────────────
// Walks a service's server.ts, extracting direct `app.method('/path')` routes and
// recursing through `register(symbol, { prefix })` for locally-imported route plugins,
// accumulating prefixes. Returns the full set of registered route paths.

const INSTANCE = '(?:app|server|fastify|instance)';
const METHOD_RE = new RegExp(
  `\\b${INSTANCE}\\s*\\.\\s*(get|post|put|patch|delete|all)\\s*(?:<[\\s\\S]{0,1500}?>)?\\s*\\(\\s*['"]([^'"]+)['"]`,
  'g',
);
const ROUTE_OBJ_RE = new RegExp(
  `\\b${INSTANCE}\\s*\\.\\s*route\\s*\\(\\s*\\{[\\s\\S]{0,1200}?\\burl\\s*:\\s*['"]([^'"]+)['"]`,
  'g',
);
// register(SYMBOL) or register(SYMBOL, { ...prefix: '/p'... })
const REGISTER_RE = /\.\s*register\s*\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*\{([^{}]*)\})?\s*\)/g;

/** Map imported symbols → resolved local file path (relative imports only). */
function importMap(file: string, text: string): Map<string, string> {
  const map = new Map<string, string>();
  const dir = dirname(file);
  const importRe = /import\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*)|(?:[A-Za-z_$][\w$]*\s*,\s*\{([^}]*)\}))\s+from\s+['"](\.[^'"]+)['"]/g;
  for (const m of text.matchAll(importRe)) {
    const spec = m[4];
    const target = resolveLocalFile(dir, spec);
    if (!target) continue;
    const named = [m[1], m[3]].filter(Boolean).join(',');
    if (named) {
      for (const raw of named.split(',')) {
        const sym = raw.replace(/\bas\b[\s\S]*/, '').trim();
        if (sym) map.set(sym, target);
      }
    }
    if (m[2]) map.set(m[2].trim(), target);
  }
  return map;
}

function resolveLocalFile(dir: string, spec: string): string | null {
  const base = resolve(dir, spec.replace(/\.js$/, ''));
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

function joinPrefix(prefix: string, path: string): string {
  const p = `${prefix}${path.startsWith('/') ? path : `/${path}`}`.replace(/\/{2,}/g, '/');
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/** Recursively collect all route paths registered by an app entry file. */
function resolveAppRoutes(entryFile: string): string[] {
  const routes = new Set<string>();
  const visited = new Set<string>();

  function walk(file: string, prefix: string): void {
    const key = `${file}::${prefix}`;
    if (visited.has(key)) return;
    visited.add(key);
    if (!existsSync(file)) return;
    const text = readText(file);

    for (const m of text.matchAll(METHOD_RE)) routes.add(joinPrefix(prefix, m[2]));
    for (const m of text.matchAll(ROUTE_OBJ_RE)) routes.add(joinPrefix(prefix, m[1]));

    const imports = importMap(file, text);
    for (const m of text.matchAll(REGISTER_RE)) {
      const symbol = m[1];
      const target = imports.get(symbol);
      if (!target) continue; // non-relative plugin (helmet/cors/@aisha/*) — not a route module
      const opts = m[2] ?? '';
      const childPrefix = opts.match(/prefix\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? '';
      walk(target, joinPrefix(prefix, childPrefix) === '/' ? '' : joinPrefix(prefix, childPrefix).replace(/\/$/, ''));
    }
  }

  walk(entryFile, '');
  return [...routes].sort();
}

/** Does the forwarded path resolve to `routePath` (handles :params and trailing /*)? */
function matchesRoute(forwarded: string, routePath: string): boolean {
  // A trailing wildcard route (/gov/*) is reachable from its base via the sub-path forwarder.
  if (routePath.endsWith('/*')) {
    const base = routePath.slice(0, -2);
    if (forwarded === base || forwarded.startsWith(`${base}/`)) return true;
  }
  const rx = routePath
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\:[A-Za-z0-9_]+/g, '[^/]+')
    .replace(/\\\*/g, '.*');
  return new RegExp(`^${rx}$`).test(forwarded);
}

// ── Cache resolved routes per service dir ──────────────────────────────────
const routeCache = new Map<string, string[]>();
function routesFor(serviceDir: string): string[] {
  if (!routeCache.has(serviceDir)) {
    routeCache.set(serviceDir, resolveAppRoutes(join(serviceDir, 'server.ts')));
  }
  return routeCache.get(serviceDir)!;
}

describe('gateway route-target contract', () => {
  const mappings = parseRouteTable();

  it('parses a non-trivial ROUTE_TABLE', () => {
    expect(mappings.length).toBeGreaterThan(40);
  });

  it('every ROUTE_TABLE mapping forwards to a real route on its target service', () => {
    const broken: string[] = [];
    for (const map of mappings) {
      const real = routesFor(map.serviceDir);
      const ok = real.some((r) => matchesRoute(map.forwarded, r));
      if (!ok) {
        broken.push(
          `${map.name} → ${map.entryLabel}${map.forwarded} (no matching route; registered: ${real.join(', ') || '(none resolved)'})`,
        );
      }
    }
    expect(
      broken,
      `Gateway functions forward to paths the target service never registers ` +
        `(each is a runtime 404). Fix the rewritePath in services/gateway/src/routes/functions.ts ` +
        `or add the missing service route:\n  ${broken.join('\n  ')}`,
    ).toEqual([]);
  });

  it('resolver sanity: gateway-internal + prefixed routers resolve', () => {
    // Guards the resolver itself — if these regress, "everything resolves" could be a false green.
    const gwRoutes = routesFor(GATEWAY_SRC);
    expect(gwRoutes).toContain('/admin/sentry-monitor');
    expect(gwRoutes).toContain('/admin/verify-integrity');
    expect(gwRoutes).toContain('/internal/deployment-executor');
    const stripe = routesFor(resolve(ROOT, 'services/svc-stripe/src'));
    expect(stripe).toContain('/webhook');
    expect(stripe).toContain('/check-subscription');
  });
});
