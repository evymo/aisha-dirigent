#!/usr/bin/env node
/**
 * patch-workflow-fetch.mjs
 * 
 * Patches n8n workflow JSONs in repo to replace bare `await fetch(mcpUrl, ...)`
 * with the proper fallback template that works in n8n Code sandbox.
 * 
 * n8n Code sandbox does NOT have global `fetch()`. The correct approach:
 * 1. Check `typeof fetch === 'function'` 
 * 2. Fallback to `require('https')` (available with NODE_FUNCTION_ALLOW_BUILTIN=*)
 * 
 * Also replaces hardcoded MCP URL with $env reference and empty token with $env.
 * 
 * Usage:
 *   node scripts/patch-workflow-fetch.mjs --dry-run   # Preview changes
 *   node scripts/patch-workflow-fetch.mjs --apply      # Apply changes
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WF_DIR = resolve(ROOT, 'n8n/workflows');

const dryRun = process.argv.includes('--dry-run');
const apply = process.argv.includes('--apply');

if (!dryRun && !apply) {
  console.log('Usage: node scripts/patch-workflow-fetch.mjs --dry-run | --apply');
  process.exit(1);
}

// ─── The OLD pattern (bare fetch, no fallback) ──────────────────────────
// Matches Code node jsCode that has `await fetch(mcpUrl, {` without the
// `typeof fetch === 'function'` guard.
const OLD_FETCH_PATTERN = /const res = await fetch\(mcpUrl, \{\n\s+method: 'POST',\n\s+headers: \{\n\s+'Content-Type': 'application\/json',\n\s+'Authorization': 'Bearer ' \+ token\n\s+\},\n\s+body: JSON\.stringify\(\{/;

// Also detect the alternative: hardcoded URL concat pattern
const OLD_URL_HARDCODED = /const mcpUrl = 'https:\/\/dirigent-api\.id3a\.cz' \+ '\/functions\/v1\/mcp-knowledge-server';/;
const OLD_URL_HARDCODED_2 = /const mcpUrl = 'https:\/\/dirigent-api\.id3a\.cz\/functions\/v1\/mcp-knowledge-server';/;
const OLD_TOKEN_EMPTY = /const token = '';/;

/**
 * Generate the fixed fetch block for a tool call.
 * This replaces the bare `const res = await fetch(...)` + `const data = await res.json()`
 * section with the proper fallback.
 */
function generateFixedFetchBlock(rpcBodyExpression) {
  return `let data;
try {
  if (typeof fetch === 'function') {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: rpcBody
    });
    if (!res.ok) throw new Error('MCP HTTP ' + res.status);
    data = await res.json();
  } else {
    const https = require('https');
    const url = new URL(mcpUrl);
    data = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'Content-Length': Buffer.byteLength(rpcBody)
        }
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Invalid JSON response: ' + body.substring(0, 200))); }
        });
      });
      req.on('error', reject);
      req.write(rpcBody);
      req.end();
    });
  }
} catch (e) {
  return 'MCP Tool Error: ' + (e.message || String(e));
}`;
}

// ─── Process each workflow file ─────────────────────────────────────────
const files = readdirSync(WF_DIR).filter(f => f.endsWith('.json'));
let totalPatched = 0;
let totalFiles = 0;

for (const file of files) {
  const filePath = resolve(WF_DIR, file);
  const raw = readFileSync(filePath, 'utf-8');
  
  let workflow;
  try {
    workflow = JSON.parse(raw);
  } catch {
    console.log(`⚠️  ${file}: Invalid JSON, skipping`);
    continue;
  }

  const nodes = workflow.nodes || [];
  let filePatched = 0;

  for (const node of nodes) {
    // Only patch Code nodes (toolCode or code) that have jsCode
    if (!node.parameters?.jsCode) continue;
    
    let code = node.parameters.jsCode;
    const originalCode = code;

    // Skip if already has the fallback pattern
    if (code.includes("typeof fetch === 'function'")) continue;

    // Skip if no bare fetch call
    if (!code.includes('await fetch(mcpUrl,') && !code.includes('await fetch(`${')) continue;

    // === PATCH 1: Fix hardcoded MCP URL → use $env ===
    code = code.replace(
      /const mcpUrl = 'https:\/\/dirigent-api\.id3a\.cz' \+ '\/functions\/v1\/mcp-knowledge-server';/g,
      "const mcpUrl = ($env?.AISHA_POSTGREST_URL) + '/functions/v1/mcp-knowledge-server';"
    );
    code = code.replace(
      /const mcpUrl = 'https:\/\/dirigent-api\.id3a\.cz\/functions\/v1\/mcp-knowledge-server';/g,
      "const mcpUrl = ($env?.AISHA_POSTGREST_URL) + '/functions/v1/mcp-knowledge-server';"
    );

    // === PATCH 2: Fix empty token → use $env ===
    code = code.replace(
      /const token = '';/g,
      "const token = $env?.AISHA_ACCESS_TOKEN || $env?.AISHA_KEYCLOAK_ACCESS_TOKEN || '';"
    );

    // === PATCH 3: Replace bare fetch with fallback pattern ===
    // Pattern: The MCP tool Code nodes follow this structure:
    //   ... build rpcBody or inline JSON.stringify ...
    //   const res = await fetch(mcpUrl, { ... body: JSON.stringify({...}) });
    //   const data = await res.json();
    //
    // We need to:
    // a) Extract the RPC body into a `const rpcBody = ...` variable
    // b) Replace the fetch+json block with the fallback
    
    // Case A: Auto-generated tool nodes with inline body in fetch
    const inlineFetchRegex = /const res = await fetch\(mcpUrl, \{\n\s+method: 'POST',\n\s+headers: \{\n\s+'Content-Type': 'application\/json',\n\s+'Authorization': 'Bearer ' \+ token\n\s+\},\n\s+body: (JSON\.stringify\(\{[\s\S]*?\}\))\n\s*\}\);\n\n\s*const data = await res\.json\(\);/;
    
    const match = code.match(inlineFetchRegex);
    if (match) {
      const bodyExpr = match[1];
      const rpcBodyDecl = `const rpcBody = ${bodyExpr};\n\n`;
      const fixedFetch = generateFixedFetchBlock();
      code = code.replace(match[0], rpcBodyDecl + fixedFetch);
      filePatched++;
    } else {
      // Case B: Story Scaffold and other custom patterns with inline fetch
      // Try a more general regex
      const generalFetchRegex = /const res = await fetch\(mcpUrl, \{\n([\s\S]*?)\}\);\n\n?\s*const data = await res\.json\(\);/;
      const genMatch = code.match(generalFetchRegex);
      if (genMatch) {
        // Extract body from the fetch options
        const fetchBody = genMatch[1];
        const bodyMatch = fetchBody.match(/body:\s*(JSON\.stringify\([\s\S]*?\))\s*$/m);
        if (bodyMatch) {
          const bodyExpr = bodyMatch[1];
          const rpcBodyDecl = `const rpcBody = ${bodyExpr};\n\n`;
          const fixedFetch = generateFixedFetchBlock();
          code = code.replace(genMatch[0], rpcBodyDecl + fixedFetch);
          filePatched++;
        } else {
          console.log(`  ⚠️  ${node.name} (${file}): Could not extract body from fetch, manual review needed`);
        }
      } else if (code.includes('await fetch(')) {
        console.log(`  ⚠️  ${node.name} (${file}): Unrecognized fetch pattern, manual review needed`);
      }
    }

    if (code !== originalCode) {
      node.parameters.jsCode = code;
    }
  }

  if (filePatched > 0) {
    totalPatched += filePatched;
    totalFiles++;
    if (dryRun) {
      console.log(`📋 ${file}: ${filePatched} Code node(s) would be patched`);
    } else {
      writeFileSync(filePath, JSON.stringify(workflow, null, 2) + '\n', 'utf-8');
      console.log(`✅ ${file}: ${filePatched} Code node(s) patched`);
    }
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`${dryRun ? '📋 DRY RUN' : '✅ APPLIED'}: ${totalPatched} Code nodes across ${totalFiles} files`);
if (dryRun) {
  console.log(`\nRe-run with --apply to write changes.`);
}
