#!/usr/bin/env node
/**
 * One-off helper: type Fastify handler params (req/reply/error) where they
 * default to implicit `any`. Operates on a single service directory and
 * makes only mechanical transformations:
 *
 *   1. Import: `import type { FastifyInstance } from 'fastify'`
 *      → `import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'`
 *      (adds FastifyError too if setErrorHandler is present)
 *   2. Handler signatures:
 *      `async (req, reply) =>` → `async (req: FastifyRequest, reply: FastifyReply) =>`
 *      `async (req, _reply) =>` → `async (req: FastifyRequest, _reply: FastifyReply) =>`
 *      `async (_req, reply) =>` → `async (_req: FastifyRequest, reply: FastifyReply) =>`
 *   3. setErrorHandler:
 *      `setErrorHandler((error, req, reply) =>` →
 *      `setErrorHandler((error: FastifyError | AuthError, req: FastifyRequest, reply: FastifyReply) =>`
 *
 * NEVER touches files that already have these types — idempotent.
 *
 * Usage:
 *   node scripts/fix-fastify-handler-types.mjs services/svc-foo
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

function processFile(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  const originalContent = content;
  let changed = false;

  // Skip non-TS files
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return false;

  const hasErrorHandler = /setErrorHandler\(\(/.test(content);
  const hasAuthError = /from\s+'\.\.?\/auth\.js'/.test(content) || /AuthError/.test(content);

  // 1. Update import — add FastifyRequest, FastifyReply, FastifyError where missing
  const importMatch = content.match(/import\s+(?:Fastify,?\s+)?(?:\{([^}]+)\}\s+)?from\s+['"]fastify['"];?/);
  if (importMatch) {
    const existing = importMatch[1] ?? '';
    const needed = ['FastifyRequest', 'FastifyReply'];
    if (hasErrorHandler) needed.push('FastifyError');
    const missing = needed.filter((t) => !existing.includes(t));
    if (missing.length > 0) {
      // Determine 'type' qualifier — only add if existing imports also use type-only
      const typeQualifier = /import\s+type\s+\{/.test(importMatch[0]) ? 'type ' : '';
      const allTypes = [...(existing.match(/\b(Fastify\w+)\b/g) ?? []), ...missing].filter(
        (v, i, a) => a.indexOf(v) === i,
      ).sort();
      // Reconstruct import — preserve Fastify default import if present
      const defaultMatch = importMatch[0].match(/import\s+(Fastify),?\s*\{/);
      const newImport = defaultMatch
        ? `import Fastify, { ${typeQualifier ? 'type ' + allTypes.join(', type ') : allTypes.join(', ')} } from 'fastify';`
        : `import type { ${allTypes.join(', ')} } from 'fastify';`;
      content = content.replace(importMatch[0], newImport);
      changed = true;
    }
  }

  // 2. Handler signatures (untyped req/reply)
  const handlerPatterns = [
    {
      pattern: /async\s+\(req,\s*reply\)\s*=>/g,
      replacement: 'async (req: FastifyRequest, reply: FastifyReply) =>',
    },
    {
      pattern: /async\s+\(req,\s*_reply\)\s*=>/g,
      replacement: 'async (req: FastifyRequest, _reply: FastifyReply) =>',
    },
    {
      pattern: /async\s+\(_req,\s*reply\)\s*=>/g,
      replacement: 'async (_req: FastifyRequest, reply: FastifyReply) =>',
    },
  ];
  for (const { pattern, replacement } of handlerPatterns) {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      changed = true;
    }
  }

  // 3. setErrorHandler signature
  const errorHandlerRe = /setErrorHandler\(\((error|err),\s*(_req|req),\s*(reply)\)\s*=>/g;
  if (errorHandlerRe.test(content)) {
    const errType = hasAuthError ? 'FastifyError | AuthError' : 'FastifyError';
    content = content.replace(errorHandlerRe, (m, e, r, rep) =>
      `setErrorHandler((${e}: ${errType}, ${r}: FastifyRequest, ${rep}: FastifyReply) =>`,
    );
    changed = true;
  }

  if (changed && content !== originalContent) {
    writeFileSync(filePath, content);
    return true;
  }
  return false;
}

function walkDir(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
      files.push(...walkDir(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      // Skip test files
      if (entry.includes('.test.') || entry.includes('.spec.')) continue;
      files.push(full);
    }
  }
  return files;
}

const target = process.argv[2];
if (!target) {
  process.stderr.write('Usage: node scripts/fix-fastify-handler-types.mjs <service-dir>\n');
  process.exit(1);
}

const srcDir = path.join(target, 'src');
const files = walkDir(srcDir);
let total = 0;
for (const f of files) {
  if (processFile(f)) {
    process.stdout.write(`  fixed ${path.relative(target, f)}\n`);
    total++;
  }
}
process.stdout.write(`[${target}] ${total} file(s) updated\n`);
