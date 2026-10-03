#!/usr/bin/env node
// =============================================================================
// migrate-observability-rollout.mjs — Phase 12 WP 0.4
// =============================================================================
// Rolls out @aisha/observability (bootstrapOtel + registerMetricsPlugin) to
// every services/svc-*/src/server.ts that has a Dockerfile + isn't already
// wired (gateway + svc-ai-chat + svc-mcp-knowledge done in WP 0.1).
//
// Per-service transformation:
//   1. Add `"@aisha/observability": "*"` to dependencies (preserving sort order)
//   2. Add two imports next to existing `@aisha/*` imports:
//      - `import { bootstrapOtel } from '@aisha/observability/otel';`
//      - `import { registerMetricsPlugin } from '@aisha/observability/metrics';`
//   3. Insert `bootstrapOtel({ serviceName: '<svc>' });` after the FIRST line
//      that creates the Fastify app (`const app = Fastify(...)`)
//   4. Insert `await registerMetricsPlugin(app, { serviceName: '<svc>' });`
//      AFTER the `applySecurity(app, ...)` await block OR after the manual
//      rate-limit register if applySecurity isn't used.
//
// SAFETY
// ------
//   - Read + write under services/*/src/server.ts + services/*/package.json only
//   - Idempotent: detects existing `bootstrapOtel` call and skips
//   - Dry-run via `--dry`
//   - Fails loudly if any service doesn't match expected pattern (rather
//     than silently skipping — caller should investigate)
//
// USAGE
// -----
//   node scripts/migrate-observability-rollout.mjs [--dry]
// =============================================================================
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SERVICES_DIR = join(REPO_ROOT, 'services');
const DRY = process.argv.includes('--dry');

// Already wired by WP 0.1. Skip these.
const ALREADY_WIRED = new Set([
  'gateway',
  'svc-ai-chat',
  'svc-mcp-knowledge',
]);

/** Tries to insert observability into a package.json dependencies block. */
function addPackageDep(content) {
  if (content.includes('"@aisha/observability"')) {
    return null;
  }
  // Insert "@aisha/observability": "*" alphabetically after "@aisha/aitg"
  // OR before "@aisha/security" OR as first entry of dependencies.
  const lines = content.split('\n');
  const depsStart = lines.findIndex((l) => /"dependencies"\s*:\s*\{/.test(l));
  if (depsStart < 0) return null;

  // Find an existing @aisha/* line to anchor near
  for (let i = depsStart + 1; i < lines.length; i++) {
    if (/^\s*"@aisha\//.test(lines[i])) {
      // Insert before this line if its name sorts after "@aisha/observability"
      const m = lines[i].match(/"@aisha\/(\w+)"/);
      if (m && m[1] > 'observability') {
        const indent = lines[i].match(/^\s*/)?.[0] ?? '    ';
        const newLine = `${indent}"@aisha/observability": "*",`;
        lines.splice(i, 0, newLine);
        return lines.join('\n');
      }
      // Insert after this @aisha line (it sorts before observability)
      if (m && m[1] <= 'observability') {
        // Continue to find next non-@aisha line OR end of deps block
        continue;
      }
    }
    // Reached non-@aisha dep — insert here
    if (
      /^\s*"[^@]/.test(lines[i]) ||
      lines[i].trim() === '},' ||
      lines[i].trim() === '}'
    ) {
      const indent = lines[i].match(/^\s*/)?.[0] ?? '    ';
      const newLine = `${indent}"@aisha/observability": "*",`;
      lines.splice(i, 0, newLine);
      return lines.join('\n');
    }
  }
  return null;
}

/** Insert imports + bootstrap + register calls into server.ts content. */
function migrateServerTs(content, serviceName) {
  if (content.includes('bootstrapOtel')) {
    return null;
  }

  // 1. Add imports — anchor: existing @aisha/security import (if any) OR
  //    first @aisha/* import OR first import line.
  const lines = content.split('\n');
  const importLines = [
    `import { bootstrapOtel } from '@aisha/observability/otel';`,
    `import { registerMetricsPlugin } from '@aisha/observability/metrics';`,
  ];

  let importInsertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s.*from\s+['"]@aisha\//.test(lines[i])) {
      importInsertAt = i + 1;
      // Continue past consecutive @aisha imports
      while (
        importInsertAt < lines.length &&
        /^import\s.*from\s+['"]@aisha\//.test(lines[importInsertAt])
      ) {
        importInsertAt++;
      }
      break;
    }
  }
  if (importInsertAt < 0) {
    // No @aisha imports — anchor after last `import` line
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^import\s/.test(lines[i])) {
        importInsertAt = i + 1;
        break;
      }
    }
  }
  if (importInsertAt < 0) {
    throw new Error(`${serviceName}: no import lines found in server.ts`);
  }

  lines.splice(importInsertAt, 0, ...importLines);

  // 2. Insert bootstrapOtel after `const app = Fastify(...)`
  let appLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^const\s+app\s*=\s*Fastify\s*\(/.test(lines[i])) {
      appLine = i;
      // Walk forward until the statement closes (line ends with `;` or `})`)
      while (
        appLine < lines.length &&
        !/;\s*$/.test(lines[appLine])
      ) {
        appLine++;
      }
      break;
    }
  }
  if (appLine < 0) {
    throw new Error(
      `${serviceName}: no \`const app = Fastify(...)\` found in server.ts`,
    );
  }
  const bootstrapBlock = [
    '',
    '// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any',
    "// other module performs network I/O. Exporter routes to Langfuse OTLP.",
    '// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.',
    `bootstrapOtel({ serviceName: '${serviceName}' });`,
  ];
  // Insert AFTER the const app line. Need to insert BEFORE the Fastify init
  // so OTel patches before Fastify builds its HTTP server. So insert before
  // appLine.
  // Walk back to find the start of the `const app` statement:
  let appStart = appLine;
  while (appStart >= 0 && !/^const\s+app\s*=\s*Fastify\s*\(/.test(lines[appStart])) {
    appStart--;
  }
  lines.splice(appStart, 0, ...bootstrapBlock);

  // 3. Insert registerMetricsPlugin after applySecurity OR after the last
  //    plugin register before first route.
  const updatedLines = lines.join('\n').split('\n');
  let metricsInsertAt = -1;

  // Try applySecurity pattern first
  const applySecMatch = updatedLines.findIndex((l) =>
    /^\s*await\s+applySecurity\s*\(/.test(l),
  );
  if (applySecMatch >= 0) {
    // Walk forward until the statement closes
    let end = applySecMatch;
    while (end < updatedLines.length && !/\}\)\s*;\s*$/.test(updatedLines[end])) {
      end++;
    }
    metricsInsertAt = end + 1;
  } else {
    // Manual rate-limit pattern (ws-gateway style)
    for (let i = 0; i < updatedLines.length; i++) {
      if (/^\s*await\s+app\.register\s*\(\s*rateLimit\b/.test(updatedLines[i])) {
        let end = i;
        while (end < updatedLines.length && !/;\s*$/.test(updatedLines[end])) {
          end++;
        }
        metricsInsertAt = end + 1;
        break;
      }
    }
  }
  if (metricsInsertAt < 0) {
    throw new Error(
      `${serviceName}: no applySecurity() or rate-limit register() found — cannot place registerMetricsPlugin safely. Add manually.`,
    );
  }

  const metricsBlock = [
    '',
    `await registerMetricsPlugin(app, { serviceName: '${serviceName}' });`,
  ];
  updatedLines.splice(metricsInsertAt, 0, ...metricsBlock);

  return updatedLines.join('\n');
}

async function migrateService(serviceName) {
  const svcDir = join(SERVICES_DIR, serviceName);
  const pkgPath = join(svcDir, 'package.json');
  const serverPath = join(svcDir, 'src/server.ts');

  const pkgContent = await readFile(pkgPath, 'utf8');
  const serverContent = await readFile(serverPath, 'utf8');

  const newPkg = addPackageDep(pkgContent);
  const newServer = migrateServerTs(serverContent, serviceName);

  if (newPkg === null && newServer === null) {
    return { service: serviceName, status: 'already-wired' };
  }
  if (newPkg === null || newServer === null) {
    return {
      service: serviceName,
      status: 'partial — please review',
      pkgChanged: newPkg !== null,
      serverChanged: newServer !== null,
    };
  }

  if (DRY) {
    console.log(`\n# === ${serviceName} DRY-RUN package.json ===`);
    console.log(newPkg);
    console.log(`\n# === ${serviceName} DRY-RUN server.ts (head) ===`);
    console.log(newServer.split('\n').slice(0, 50).join('\n'));
    console.log(`# ... (${newServer.split('\n').length} total lines)`);
  } else {
    await writeFile(pkgPath, newPkg);
    await writeFile(serverPath, newServer);
  }
  return { service: serviceName, status: 'migrated' };
}

async function main() {
  const entries = await readdir(SERVICES_DIR, { withFileTypes: true });
  const candidates = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (ALREADY_WIRED.has(e.name)) continue;
    const svcDir = join(SERVICES_DIR, e.name);
    try {
      await readFile(join(svcDir, 'Dockerfile'), 'utf8');
      await readFile(join(svcDir, 'src/server.ts'), 'utf8');
      candidates.push(e.name);
    } catch {
      // No Dockerfile or no src/server.ts — skip
    }
  }
  candidates.sort();

  const migrated = [];
  const failed = [];

  for (const svc of candidates) {
    try {
      const r = await migrateService(svc);
      migrated.push(r);
    } catch (err) {
      failed.push({ service: svc, error: err.message });
    }
  }

  console.log('');
  console.log('=== Migration summary ===');
  for (const r of migrated) {
    console.log(`  ${r.status.padEnd(20)} ${r.service}`);
  }
  if (failed.length > 0) {
    console.log('');
    console.log('=== Failures ===');
    for (const f of failed) {
      console.log(`  ${f.service}: ${f.error}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[migrate-observability:FATAL]', err);
  process.exit(1);
});
