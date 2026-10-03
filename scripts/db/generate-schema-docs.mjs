#!/usr/bin/env node
/**
 * generate-schema-docs.mjs — the "DB architect" VISUALIZATION layer
 *
 * Companion to the FK-relationship-gap GATE (check-fk-relationship-gaps.mjs).
 * The gate enforces; this draws the picture. Two outputs:
 *
 *   1. docs/db/RELATIONSHIPS.md  (COMMITTED, psql-only, no Docker)
 *      A per-domain mermaid `erDiagram` built straight from pg_constraint —
 *      only REAL (enforced) FKs are drawn, so a missing relationship is a
 *      visibly absent line. Each viewpoint is followed by its unenforced-gap
 *      table (the same `*_id`-with-no-FK lens the gate uses), so "kde jsou a
 *      kde nejsou vazby" is answerable at a glance. Diffable in PRs.
 *
 *   2. .tbls.yml `viewpoints:` tail (REWRITTEN below the sentinel)
 *      So anyone running the full tbls site (`--tbls`, Docker) gets the same
 *      per-story perspectives. The full tbls dump (364 per-table pages) goes to
 *      docs/db/tbls/ which is gitignored — it's a browse-locally artifact, not a
 *      committed one; the committed, readable ER is RELATIONSHIPS.md.
 *
 * Viewpoints are DERIVED from the live FK graph (not hand-listed), so new story
 * tables appear automatically. v1 ships the `stories` viewpoint: partner_stories
 * + its direct FK children + every `story_*`-named table.
 *
 * Usage:
 *   AISHA_DB_URL=postgres://… npm run db:schema:docs            # writes RELATIONSHIPS.md + .tbls.yml
 *   AISHA_DB_URL=postgres://… npm run db:schema:docs -- --tbls  # also render the full tbls site (Docker)
 *
 * @module
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { psqlPripojeni } from './lib/psql-pripojeni.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TBLS_YML = path.join(ROOT, '.tbls.yml');
const OUT_MD = path.join(ROOT, 'docs/db/RELATIONSHIPS.md');
// Source the tbls image through the stack's registry mirror, same pattern as the
// infra/* Dockerfiles (`FROM ${REGISTRY_PROXY}…`): with REGISTRY_PROXY set, the
// optional full tbls site is pulled from your registry, never Docker Hub directly.
// AISHA_TBLS_IMAGE is a full override; empty REGISTRY_PROXY falls back to Docker Hub
// for dev convenience. (The committed RELATIONSHIPS.md is psql-only and needs no image.)
const REGISTRY_PROXY = process.env.REGISTRY_PROXY || '';
const TBLS_IMAGE = process.env.AISHA_TBLS_IMAGE || `${REGISTRY_PROXY}k1low/tbls:latest`;
const TODAY = new Date().toISOString().slice(0, 10);
const DB_URL = process.env.AISHA_DB_URL || process.env.DATABASE_URL || '';

// Viewpoint catalog. Each viewpoint is a named domain + the SQL that selects its
// table set from the live catalog. Keep the selectors bounded (direct FK + name)
// so each ER stays readable. Add domains here as they earn a perspective.
const VIEWPOINTS = [
  {
    name: 'stories',
    desc: 'Story domain — partner_stories, its direct FK children, and every story_*-named table.',
    tablesSql: `
      SELECT DISTINCT relname FROM (
        SELECT 'partner_stories'::text AS relname
        UNION
        SELECT c.relname
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' AND c.relkind = 'r'
        JOIN pg_class tc ON tc.oid = con.confrelid
        WHERE con.contype = 'f' AND tc.relname = 'partner_stories'
        UNION
        SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE c.relkind = 'r' AND c.relname LIKE 'story_%'
      ) u ORDER BY relname;`,
  },
];

function psql(sql) {
  const { cil, env } = psqlPripojeni(DB_URL); // heslo prostředím, ne v argv
  const r = spawnSync('psql', [cil, '-X', '-v', 'ON_ERROR_STOP=1', '-tAF|', '-c', sql], { encoding: 'utf-8', env });
  if (r.error) throw new Error(`psql not runnable: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`psql exited ${r.status}: ${(r.stderr || '').trim()}`);
  return (r.stdout || '').trim().split('\n').filter(Boolean).map((line) => line.split('|'));
}

// Enforced FKs whose BOTH ends are in the table set (single-column FKs; the rare
// composite FK is skipped for the diagram — noted in the legend).
function enforcedRelations(tableSet) {
  const inList = [...tableSet].map((t) => `'${t}'`).join(',') || `''`;
  const rows = psql(`
    SELECT DISTINCT child.relname, parent.relname, att.attname
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace AND n.nspname = 'public'
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
    JOIN pg_attribute att ON att.attrelid = child.oid AND att.attnum = k.attnum
    WHERE con.contype = 'f'
      AND array_length(con.conkey, 1) = 1
      AND child.relname IN (${inList})
      AND parent.relname IN (${inList})
    ORDER BY parent.relname, child.relname, att.attname;`);
  return rows.map(([child, parent, col]) => ({ child, parent, col }));
}

// Unenforced `*_id` gaps WITHIN the table set — the same lens as the gate, scoped.
function unenforcedGaps(tableSet) {
  const inList = [...tableSet].map((t) => `'${t}'`).join(',') || `''`;
  const rows = psql(`
    WITH idcols AS (
      SELECT c.relname AS tbl, a.attname AS col
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind = 'r' AND c.relname IN (${inList}) AND a.attname ~ '_id$' AND a.attname <> 'id'
    ),
    fk_cols AS (
      SELECT c.relname AS tbl, a.attname AS col
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN unnest(con.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE con.contype = 'f'
    ),
    pk_cols AS (
      SELECT c.relname AS tbl, a.attname AS col
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN unnest(con.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE con.contype = 'p'
    ),
    fk_targets AS (
      SELECT a.attname AS col, string_agg(DISTINCT tc.relname, ',' ORDER BY tc.relname) AS targets
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN unnest(con.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      JOIN pg_class tc ON tc.oid = con.confrelid
      WHERE con.contype = 'f' GROUP BY a.attname
    )
    SELECT i.tbl, i.col, COALESCE(ft.targets, regexp_replace(i.col, '_id$', '') || '(?)') AS guess
    FROM idcols i
    LEFT JOIN fk_cols f ON f.tbl = i.tbl AND f.col = i.col
    LEFT JOIN pk_cols pk ON pk.tbl = i.tbl AND pk.col = i.col
    LEFT JOIN fk_targets ft ON ft.col = i.col
    WHERE f.col IS NULL AND pk.col IS NULL
    ORDER BY i.tbl, i.col;`);
  return rows.map(([tbl, col, guess]) => ({ tbl, col, guess }));
}

function mermaidFor(relations) {
  if (relations.length === 0) return 'erDiagram\n  %% no enforced FKs among these tables\n';
  const lines = ['erDiagram'];
  for (const r of relations) lines.push(`  ${r.parent} ||--o{ ${r.child} : "${r.col}"`);
  return lines.join('\n');
}

function rewriteTblsViewpoints(viewpointTables) {
  if (!existsSync(TBLS_YML)) return false;
  const SENTINEL = '# >>> generated viewpoints';
  const lines = readFileSync(TBLS_YML, 'utf-8').split('\n');
  const idx = lines.findIndex((l) => l.startsWith(SENTINEL));
  const head = (idx >= 0 ? lines.slice(0, idx) : lines).join('\n').replace(/\s+$/, '');
  const block = [
    '',
    `${SENTINEL} — produced by \`npm run db:schema:docs\` (${TODAY}) from the live FK`,
    '# >>> graph; do not hand-edit below this sentinel, re-run the generator instead.',
    'viewpoints:',
  ];
  for (const vp of VIEWPOINTS) {
    const tables = viewpointTables[vp.name] || [];
    block.push(`  - name: ${vp.name}`);
    block.push(`    desc: ${JSON.stringify(`${vp.desc} (${tables.length} tables, generated ${TODAY})`)}`);
    block.push('    tables:');
    for (const t of tables) block.push(`      - ${t}`);
  }
  writeFileSync(TBLS_YML, head + '\n' + block.join('\n') + '\n');
  return true;
}

function runTbls(viewpointTables) {
  const dockerOk = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf-8' }).status === 0;
  if (!dockerOk) {
    console.error('[schema-docs] --tbls requested but Docker is unavailable; skipping full tbls site.');
    return;
  }
  // tbls runs in a container; rewrite a loopback host so it can reach a host DB,
  // and force sslmode=disable (tbls's lib/pq driver defaults to require; the
  // throwaway/cold-start pg17 speaks plaintext, where psql's sslmode=prefer hides this).
  let containerUrl = DB_URL.replace(/@(127\.0\.0\.1|localhost):/, '@host.docker.internal:');
  if (!/[?&]sslmode=/.test(containerUrl)) {
    containerUrl += (containerUrl.includes('?') ? '&' : '?') + 'sslmode=disable';
  }
  mkdirSync(path.join(ROOT, 'docs/db/tbls'), { recursive: true });
  console.error(`[schema-docs] rendering full tbls site → docs/db/tbls/ via ${TBLS_IMAGE} …`);
  const r = spawnSync(
    'docker',
    [
      'run', '--rm', '--add-host=host.docker.internal:host-gateway',
      '-e', `AISHA_DB_URL=${containerUrl}`,
      '-v', `${ROOT}:/work`, '-w', '/work',
      TBLS_IMAGE, 'doc', '--force',
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) console.error('[schema-docs] tbls returned non-zero (see above) — RELATIONSHIPS.md is unaffected.');
}

function main() {
  if (!DB_URL) {
    console.error('[schema-docs] AISHA_DB_URL (or DATABASE_URL) must point at a Postgres with the full schema applied.');
    console.error('              e.g. AISHA_TYPEGEN_KEEP=1 npm run db:types:refresh:throwaway leaves one up.');
    process.exit(1);
  }
  const wantTbls = process.argv.includes('--tbls');

  const viewpointTables = {};
  const sections = [];
  for (const vp of VIEWPOINTS) {
    const tables = psql(vp.tablesSql).map((r) => r[0]);
    const set = new Set(tables);
    viewpointTables[vp.name] = tables;
    const relations = enforcedRelations(set);
    const gaps = unenforcedGaps(set);
    console.error(`[schema-docs] viewpoint '${vp.name}': ${tables.length} tables, ${relations.length} enforced FK(s), ${gaps.length} unenforced gap(s).`);

    const s = [];
    s.push(`## Viewpoint: \`${vp.name}\``);
    s.push('');
    s.push(vp.desc);
    s.push('');
    s.push(`**${tables.length}** tables · **${relations.length}** enforced relationships · **${gaps.length}** unenforced \`*_id\` gaps.`);
    s.push('');
    s.push('```mermaid');
    s.push(mermaidFor(relations));
    s.push('```');
    s.push('');
    if (gaps.length) {
      s.push('### Unenforced relationships in this viewpoint');
      s.push('');
      s.push('`*_id` columns with no FOREIGN KEY constraint (a precision signal says they likely should have one). These are the absent lines above.');
      s.push('');
      s.push('| table | column | looks like → |');
      s.push('| --- | --- | --- |');
      for (const g of gaps) s.push(`| \`${g.tbl}\` | \`${g.col}\` | \`${g.guess}\` |`);
      s.push('');
    }
    sections.push(s.join('\n'));
  }

  const header = [
    '<!-- GENERATED by scripts/db/generate-schema-docs.mjs — do not hand-edit. Run: npm run db:schema:docs -->',
    '# Schema relationships — the DB-architect lens',
    '',
    `Generated ${TODAY} from the applied schema. The ER diagrams draw **only enforced foreign keys**, so a`,
    'missing relationship ("vazba") is a visibly absent line; each viewpoint lists its unenforced `*_id` gaps.',
    '',
    'This is the visualization half of the relationship lens. The enforcement half is the gate',
    '`scripts/db/check-fk-relationship-gaps.mjs` (runs in `verify-cold-start-apply.sh`), whose allowlist',
    '`src/tests/gates/fk-relationship-gaps.allowlist.json` is the full, schema-wide snapshot of pre-existing gaps.',
    'For the full browseable per-table site, run `npm run db:schema:docs -- --tbls` (Docker, output gitignored in `docs/db/tbls/`).',
    '',
    '> Regenerate: `AISHA_DB_URL=… npm run db:schema:docs`',
    '',
  ].join('\n');

  mkdirSync(path.dirname(OUT_MD), { recursive: true });
  writeFileSync(OUT_MD, header + sections.join('\n') + '\n');
  console.error(`[schema-docs] wrote ${path.relative(ROOT, OUT_MD)}`);

  if (rewriteTblsViewpoints(viewpointTables)) console.error('[schema-docs] updated .tbls.yml viewpoints tail.');
  if (wantTbls) runTbls(viewpointTables);
}

main();
