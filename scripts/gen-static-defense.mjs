#!/usr/bin/env node

/**
 * @module gen-static-defense
 * Generator: aisha_static_defense_rules (DB OR seed migration) → .semgrep/aisha-rules.yml
 *
 * Per AISHA design, policy lives in DB (knowledge_items, ruleset_snapshot,
 * aisha_static_defense_rules). Repo-side tooling configs are GENERATED from
 * DB rows so:
 *   - Aisha (autonomous loop) can propose new rules via RPC
 *   - Operator can edit rules from Appsmith UI
 *   - Static analysis tooling (Semgrep) consumes a file because that's its
 *     runtime interface — but the file is an OUTPUT, not the SoT.
 *
 * Modes:
 *   default       — Fetch from PostgREST, regenerate cache + YAML. Used when
 *                   a developer has DB credentials.
 *   --offline     — Read from .aisha/static-defense-payload.json cache (a
 *                   prior `default` run populated it; cache lives outside git
 *                   because `.aisha/` is generated-workspace territory).
 *   --from-seed   — Build payload by parsing the latest
 *                   `*_aisha_static_defense_rules.sql` seed migration. No DB
 *                   access, no cache file dependency. Used by CI gates so the
 *                   `.aisha/` directory stays a fully-generated workspace per
 *                   the project rule that `.aisha/` content is produced by
 *                   the extension or stack backend, never hand-committed.
 *   --check       — Render YAML and diff against checked-in
 *                   `.semgrep/aisha-rules.yml`, exit 1 on drift. Combinable
 *                   with --offline or --from-seed; in CI typically paired
 *                   with --from-seed.
 *
 * Environment:
 *   AISHA_POSTGREST_URL    — Default http://127.0.0.1:3001
 *   AISHA_SERVICE_TOKEN    — Required in default (online) mode
 *
 * Usage:
 *   node scripts/gen-static-defense.mjs                       # online (DB)
 *   node scripts/gen-static-defense.mjs --offline             # from cached payload
 *   node scripts/gen-static-defense.mjs --from-seed           # from seed migration
 *   node scripts/gen-static-defense.mjs --from-seed --check   # CI drift check
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { porovnej } from './lib/razeni.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PAYLOAD_CACHE = path.join(ROOT, '.aisha', 'static-defense-payload.json');
const SEMGREP_RULES_FILE = path.join(ROOT, '.semgrep', 'aisha-rules.yml');
const MIGRATIONS_DIR = path.join(ROOT, 'aisha', 'db', 'migrations');
const SEED_CORE_DIR = path.join(ROOT, 'aisha', 'db', 'seed', 'core');

const SEMGREP_HEADER = `###############################################################################
# AISHA orchestrator — local Semgrep rules.
#
# AUTO-GENERATED from public.aisha_static_defense_rules table.
# DO NOT EDIT MANUALLY — regenerate via \`npm run gen:static-defense\`.
#
# To add or modify a rule:
#   1. INSERT/UPDATE in aisha_static_defense_rules via Appsmith UI OR
#      RPC propose_static_defense_rule / publish_static_defense_rule
#   2. Run \`npm run gen:static-defense\` locally (needs DB) OR add a new
#      seed-style migration touching aisha_static_defense_rules
#   3. Commit the regenerated YAML. The .aisha/ payload cache stays LOCAL
#      (gitignored) — CI regenerates from the seed migration via --from-seed.
#
# Rule severity convention:
#   ERROR   — blocks the workflow (matches OWASP A-category violations)
#   WARNING — surfaces but doesn't block (style/maintainability)
#   INFO    — informational, for trend tracking
###############################################################################

`;

function parseFlags(argv) {
  return {
    offline: argv.includes('--offline'),
    fromSeed: argv.includes('--from-seed') || argv.includes('--from-seed-migration'),
    check: argv.includes('--check'),
    help: argv.includes('--help'),
  };
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/gen-static-defense.mjs [options]

Options:
  --offline      Use cached payload from .aisha/static-defense-payload.json
  --from-seed    Build payload from the latest *_aisha_static_defense_rules.sql
                 migration (no DB, no cache file). Used by CI gates.
  --check        Render YAML and exit 1 if checked-in file has drift.
                 Combinable with --offline or --from-seed.
  --help         Show this help
`);
}

async function fetchPayload() {
  const base = process.env.AISHA_POSTGREST_URL ?? 'http://127.0.0.1:3001';
  const token = process.env.AISHA_SERVICE_TOKEN;
  if (!token) {
    throw new Error(
      'AISHA_SERVICE_TOKEN env var required (or use --offline / --from-seed)',
    );
  }
  const url = `${base}/rpc/aisha_get_active_static_defense_rules`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ p_category: 'semgrep' }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`PostgREST returned ${res.status}: ${await res.text()}`);
  }
  const rules = await res.json();
  return {
    fetched_at: new Date().toISOString(),
    source: url,
    rules,
  };
}

function loadOfflinePayload() {
  if (!existsSync(PAYLOAD_CACHE)) {
    throw new Error(
      `Offline mode requires ${PAYLOAD_CACHE} — run without --offline first ` +
        `to populate it, or use --from-seed for DB-less CI usage.`,
    );
  }
  return JSON.parse(readFileSync(PAYLOAD_CACHE, 'utf-8'));
}

/**
 * Find every seed migration that defines aisha_static_defense_rules, ordered
 * chronologically by filename timestamp. CHRONOLOGY MATTERS: later migrations
 * may add / update / DELETE rows. The build replays each one's INSERT block
 * in order, so the final payload reflects the latest cumulative state — the
 * same way running the migrations against a fresh DB would.
 */
function findStaticDefenseSeedMigrations() {
  // Baseline-only model: the canonical rule ROWS live in the seed corpus
  // (aisha/db/seed/core/*_aisha_static_defense_rules.sql), NOT in a migration.
  // Reading them from seed-core decouples the generator from archive/migrations
  // so the archive can be deleted. The static-defense gate asserts the
  // "seed-core:" source label this produces.
  if (!existsSync(SEED_CORE_DIR)) {
    throw new Error(`Seed core dir not found: ${SEED_CORE_DIR}`);
  }
  const candidates = readdirSync(SEED_CORE_DIR)
    .filter((name) => name.endsWith('.sql') && name.includes('aisha_static_defense_rules'))
    .sort((a, b) => porovnej(a, b))
    .map((name) => path.join(SEED_CORE_DIR, name));
  if (candidates.length === 0) {
    throw new Error(
      `No static-defense seed found matching *_aisha_static_defense_rules.sql in ${SEED_CORE_DIR}`,
    );
  }
  return candidates;
}

/**
 * Parse INSERT INTO public.aisha_static_defense_rules tuples from a SQL
 * migration file. Returns an array of rule objects matching the shape the
 * RPC `aisha_get_active_static_defense_rules` returns from DB.
 *
 * Parsing strategy: extract the block between `INSERT INTO …` and `ON CONFLICT`
 * (or end of statement), split into tuples at lines starting with `  (` and
 * closing `  )`. Inside each tuple, split top-level fields on commas at line
 * starts (the seed file format consistently puts one field per line). Single-
 * quoted text values get unquoted; `::jsonb` and `::text` type casts get
 * stripped; jsonb fields are JSON.parsed. This is a deliberately narrow
 * parser — it expects the seed file format the migration generator produces
 * and will fail loudly on anything else.
 */
function parseRulesFromMigration(filePath) {
  const sql = readFileSync(filePath, 'utf-8');
  // Match the INSERT block up to (but not including) the trailing
  // `ON CONFLICT … DO …;` clause OR a bare `;` at line start OR end of file.
  // Note: JavaScript regex has no Perl-style \Z end-of-input anchor — the
  // `$` (no `m` flag) anchor handles end-of-string. We can't use the `m`
  // flag's `^` for the terminating lookahead either, because some message
  // strings inside the INSERT block begin lines with `'On …'` or similar
  // capitalised words. So we anchor on a newline-prefixed delimiter.
  const insertMatch = sql.match(
    /INSERT INTO public\.aisha_static_defense_rules[\s\S]*?(?=\nON CONFLICT|\n;|$)/,
  );
  if (!insertMatch) {
    return [];
  }
  const insertBlock = insertMatch[0];

  const tupleRe = /^ {2}\(([^]+?)^ {2}\)/gm;
  const rules = [];
  for (const m of insertBlock.matchAll(tupleRe)) {
    const body = m[1];
    const parts = body
      .split(/,\n\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 10) continue;
    const stripCast = (s) => s.replace(/::[a-zA-Z_]+$/, '');
    const unquote = (s) => {
      const v = stripCast(s.trim());
      if (v === 'NULL') return null;
      if (v.startsWith("'") && v.endsWith("'")) {
        return v.slice(1, -1).replace(/''/g, "'");
      }
      return v;
    };
    const parseJsonField = (s) => {
      const v = stripCast(s.trim());
      if (v === 'NULL') return null;
      const inner = v.startsWith("'") && v.endsWith("'")
        ? v.slice(1, -1).replace(/''/g, "'")
        : v;
      return JSON.parse(inner);
    };

    const [
      rule_id,
      category,
      owasp_category,
      semgrep_pattern,
      semgrep_paths,
      semgrep_message,
      severity,
      _status,
      _proposed_by,
      rationale,
    ] = parts;

    rules.push({
      rule_id: unquote(rule_id),
      category: unquote(category),
      owasp_category: unquote(owasp_category),
      semgrep_pattern: parseJsonField(semgrep_pattern),
      semgrep_paths: parseJsonField(semgrep_paths),
      semgrep_message: unquote(semgrep_message),
      // Table defaults — seed never overrides these per current convention.
      languages: ['typescript'],
      severity: unquote(severity),
      version: 1,
      rationale: unquote(rationale),
    });
  }
  return rules;
}

function buildPayloadFromSeedMigrations() {
  const migrationFiles = findStaticDefenseSeedMigrations();
  // Replay in chronological order; later inserts overwrite earlier ones by rule_id.
  const ruleMap = new Map();
  for (const file of migrationFiles) {
    for (const rule of parseRulesFromMigration(file)) {
      if (rule.rule_id) ruleMap.set(rule.rule_id, rule);
    }
  }
  // ORDER BY category, rule_id (matches `aisha_get_active_static_defense_rules`)
  const rules = [...ruleMap.values()].sort(
    (a, b) =>
      porovnej(a.category || '', b.category || '') ||
      porovnej(a.rule_id || '', b.rule_id || ''),
  );
  return {
    fetched_at: '1970-01-01T00:00:00.000Z', // intentionally fixed so output is reproducible across runs
    source: `seed-core:${migrationFiles.map((f) => path.basename(f)).join(',')}`,
    rules,
  };
}

function escapeYamlString(s) {
  // YAML block scalar literal (preserves newlines + quoting)
  return s.split('\n').map((line) => '      ' + line).join('\n');
}

function renderSemgrepRule(rule) {
  const lines = [];
  lines.push(`  - id: ${rule.rule_id}`);

  // pattern-either OR single pattern
  const patterns = Array.isArray(rule.semgrep_pattern)
    ? rule.semgrep_pattern
    : null;
  if (patterns && patterns.length > 0) {
    lines.push(`    pattern-either:`);
    for (const p of patterns) {
      // Each pattern is an object like { pattern: "fetch($URL, ...)" }
      const key = Object.keys(p)[0];
      lines.push(`      - ${key}: ${JSON.stringify(p[key])}`);
    }
  }

  // paths
  if (rule.semgrep_paths && (rule.semgrep_paths.include || rule.semgrep_paths.exclude)) {
    lines.push(`    paths:`);
    if (rule.semgrep_paths.include) {
      lines.push(`      include:`);
      for (const inc of rule.semgrep_paths.include) {
        lines.push(`        - ${JSON.stringify(inc)}`);
      }
    }
    if (rule.semgrep_paths.exclude) {
      lines.push(`      exclude:`);
      for (const exc of rule.semgrep_paths.exclude) {
        lines.push(`        - ${JSON.stringify(exc)}`);
      }
    }
  }

  // message (block scalar)
  if (rule.semgrep_message) {
    lines.push(`    message: |`);
    lines.push(escapeYamlString(rule.semgrep_message));
  }

  // severity
  lines.push(`    severity: ${rule.severity}`);

  // languages
  if (rule.languages && rule.languages.length > 0) {
    lines.push(`    languages: [${rule.languages.join(', ')}]`);
  }

  return lines.join('\n');
}

function renderSemgrepYaml(payload) {
  const semgrepRules = payload.rules.filter((r) => r.category === 'semgrep');
  const out = [SEMGREP_HEADER, 'rules:'];
  for (const rule of semgrepRules) {
    out.push('');
    if (rule.owasp_category) {
      out.push(`  # ${rule.owasp_category} — ${rule.rule_id}`);
    }
    out.push(renderSemgrepRule(rule));
  }
  return out.join('\n') + '\n';
}

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  // Mutual exclusion: --offline and --from-seed pick competing sources.
  if (flags.offline && flags.fromSeed) {
    throw new Error('--offline and --from-seed are mutually exclusive — pick one');
  }

  let payload;
  if (flags.fromSeed) {
    payload = buildPayloadFromSeedMigrations();
    process.stdout.write(
      `[gen-static-defense] from-seed mode: parsed ${payload.rules.length} rules from ${payload.source}\n`,
    );
  } else if (flags.offline) {
    payload = loadOfflinePayload();
    process.stdout.write(
      `[gen-static-defense] offline mode: loaded ${payload.rules?.length ?? 0} rules from cache (fetched ${payload.fetched_at})\n`,
    );
  } else {
    payload = await fetchPayload();
    ensureDir(PAYLOAD_CACHE);
    writeFileSync(PAYLOAD_CACHE, JSON.stringify(payload, null, 2) + '\n');
    process.stdout.write(
      `[gen-static-defense] online mode: fetched ${payload.rules?.length ?? 0} rules, cached to ${PAYLOAD_CACHE}\n`,
    );
  }

  const yamlContent = renderSemgrepYaml(payload);

  if (flags.check) {
    const existing = existsSync(SEMGREP_RULES_FILE)
      ? readFileSync(SEMGREP_RULES_FILE, 'utf-8')
      : '';
    if (existing.trim() !== yamlContent.trim()) {
      process.stderr.write(
        `[gen-static-defense] DRIFT: ${SEMGREP_RULES_FILE} differs from regenerated content.\n`,
      );
      process.stderr.write(`Run \`npm run gen:static-defense\` and commit the result.\n`);
      process.exit(1);
    }
    process.stdout.write(
      `[gen-static-defense] check OK: ${SEMGREP_RULES_FILE} matches generated output\n`,
    );
    return;
  }

  ensureDir(SEMGREP_RULES_FILE);
  writeFileSync(SEMGREP_RULES_FILE, yamlContent);
  process.stdout.write(
    `[gen-static-defense] wrote ${SEMGREP_RULES_FILE} (${(payload.rules ?? []).filter((r) => r.category === 'semgrep').length} semgrep rules)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[gen-static-defense] FAILED: ${err.message}\n`);
  process.exit(1);
});
