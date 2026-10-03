import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function walk(root: string, out: { rel: string; text: string }[] = []): typeof out {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push({ rel: relative(ROOT, path), text: readFileSync(path, 'utf8') });
    }
  }
  return out;
}

function gatewayFunctionNames(): Set<string> {
  const names = new Set<string>();
  const source = read('services/gateway/src/routes/functions.ts');
  for (const match of source.matchAll(/^\s*'([^']+)'\s*:/gm)) {
    names.add(match[1]);
  }
  return names;
}

function mobileFunctionNames(): Set<string> {
  const names = new Set<string>();
  const files = [
    ...walk(resolve(ROOT, 'mobile-app/src/app')),
    ...walk(resolve(ROOT, 'mobile-app/src/hooks')),
  ];
  for (const file of files) {
    for (const match of file.text.matchAll(/\bapi\.invoke(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]/g)) {
      names.add(match[1]);
    }
    for (const match of file.text.matchAll(/\/functions\/v1\/([a-z0-9-]+)/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

describe('mobile function route table contract', () => {
  it('every mobile function call has a gateway ROUTE_TABLE entry', () => {
    const gateway = gatewayFunctionNames();
    const mobile = mobileFunctionNames();
    const missing = Array.from(mobile).filter((name) => !gateway.has(name)).sort();
    expect(
      missing,
      `Mobile references functions missing from gateway ROUTE_TABLE: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('sentry-monitor stays wired through the function table to the admin implementation', () => {
    const functions = read('services/gateway/src/routes/functions.ts');
    const admin = read('services/gateway/src/routes/admin.ts');
    expect(functions).toContain("'sentry-monitor'");
    expect(functions).toContain("rewritePath: 'admin/sentry-monitor'");
    expect(admin).toContain("action?: 'list_issues' | 'analyze_issue'");
    expect(admin).toContain("rpcService<Record<string, unknown>>('route_ai_task'");
  });
});
