import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Client → gateway function-name coverage gate.
 *
 * Every function name a client invokes (`/functions/v1/<name>`) must exist as a key
 * in the gateway ROUTE_TABLE — otherwise the gateway answers `function_not_found`
 * (404) before the request ever reaches a service. The existing
 * mobile-function-route-table gate covers only mobile; this one covers ALL client
 * surfaces (web `src/`, `mobile-app/src/`, `extensions/`), so a new web/extension
 * call to an unmapped function fails CI instead of 404-ing in production.
 *
 * Pair with gateway-route-target.gate.test.ts: this asserts name→table; that asserts
 * table→real-route. Together they enforce the full client→gateway→service contract.
 */

const ROOT = process.cwd();

const CLIENT_ROOTS = ['src', 'mobile-app/src', 'extensions'];

// How clients name an edge function to invoke through /functions/v1.
const INVOKE_PATTERNS = [
  /\.functions\.invoke(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g,
  /\bapi\.invoke(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g,
  /\bfunctionName\s*:\s*['"]([^'"]+)['"]/g,
  /\/functions\/v1\/([a-z0-9-]+)/g,
];

function walk(root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (['node_modules', 'dist', 'coverage', '.git', 'build'].includes(entry)) continue;
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry) && !/(?:\.(?:test|spec)\.)|(?:\/tests?\/)/.test(path)) {
      out.push(path);
    }
  }
  return out;
}

function gatewayFunctionNames(): Set<string> {
  const source = readFileSync(resolve(ROOT, 'services/gateway/src/routes/functions.ts'), 'utf8');
  const table = source.slice(source.indexOf('ROUTE_TABLE'));
  const names = new Set<string>();
  for (const match of table.matchAll(/^\s*'([^']+)'\s*:\s*\{[^\n]*upstream/gm)) {
    names.add(match[1]);
  }
  return names;
}

/** name → set of client files that invoke it. */
function invokedFunctions(): Map<string, Set<string>> {
  const invoked = new Map<string, Set<string>>();
  for (const clientRoot of CLIENT_ROOTS) {
    for (const file of walk(resolve(ROOT, clientRoot))) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of INVOKE_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
          const rel = relative(ROOT, file);
          if (!invoked.has(match[1])) invoked.set(match[1], new Set());
          invoked.get(match[1])!.add(rel);
        }
      }
    }
  }
  return invoked;
}

describe('client → gateway function-name coverage', () => {
  const gateway = gatewayFunctionNames();
  const invoked = invokedFunctions();

  it('parses both sides', () => {
    expect(gateway.size).toBeGreaterThan(40);
    expect(invoked.size).toBeGreaterThan(20);
  });

  it('every client-invoked function has a gateway ROUTE_TABLE entry', () => {
    const missing = [...invoked.entries()]
      .filter(([name]) => !gateway.has(name))
      .map(([name, files]) => `${name}  (called from: ${[...files].sort().join(', ')})`)
      .sort();
    expect(
      missing,
      `Client code invokes functions with no gateway ROUTE_TABLE entry (each is a ` +
        `runtime 404 at the gateway). Add a mapping in services/gateway/src/routes/functions.ts ` +
        `pointing at the owning service route:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});
