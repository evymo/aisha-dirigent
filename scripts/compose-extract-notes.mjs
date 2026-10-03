#!/usr/bin/env node
/**
 * compose-extract-notes.mjs — move compose prose out of the YAML, keep the anchor.
 *
 * WHY: Coolify ships a stack's compose file to the server as a command-line
 * argument, so the file competes with ARG_MAX. The core compose already trips a
 * size gate, and comments are 50–63% of the larger files (pki 34 KB of 54 KB,
 * prebuilt 31 KB of 63 KB) — the explanations, not the configuration, are what
 * push it over. Shortening the prose would trade away the reasoning that makes
 * these files maintainable; moving it out costs nothing.
 *
 * WHAT: every `#` comment block is lifted into docs/compose-notes/<file>.md,
 * anchored to the configuration line that followed it, and the compose keeps a
 * single header pointing at that file. Anchors keep the association readable:
 * the note for `SOURCE_WEBHOOK_HMAC_SECRET:` sits under that heading.
 *
 * Trailing comments on a config line (`FOO: bar  # why`) are LEFT ALONE — they
 * are short by nature and removing them would change the line's meaning to a
 * reader mid-file.
 *
 * Usage:
 *   node scripts/compose-extract-notes.mjs            # apply to all coolify composes
 *   node scripts/compose-extract-notes.mjs --check    # exit 1 if any file has prose
 *   node scripts/compose-extract-notes.mjs <file...>  # specific files
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.cwd();
const NOTES_DIR = join(ROOT, 'docs/compose-notes');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const files = args.filter((a) => !a.startsWith('--'));

const POINTER = (name) =>
  `# Prose lives in docs/compose-notes/${name}.md — this file is shipped to the\n` +
  `# server as a command-line argument and competes with ARG_MAX, so it carries\n` +
  `# configuration only. Add explanations there, anchored to the line they explain.\n`;

function targets() {
  if (files.length) return files;
  return readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f))
    .sort();
}

/** Split a compose file into { yaml, notes } — notes anchored to the next config line. */
function extract(text) {
  const lines = text.split('\n');
  const out = [];
  const notes = [];
  let block = [];

  const flush = (anchor) => {
    if (!block.length) return;
    const body = block.map((l) => l.replace(/^\s*#\s?/, '')).join('\n').trimEnd();
    if (body.trim()) notes.push({ anchor, body });
    block = [];
  };

  // A `#` inside a YAML block scalar (`- |`, `key: >-`, …) is NOT a YAML comment
  // — it is content, usually a shell comment in an embedded entrypoint script.
  // Removing those lines changes the string the container actually runs. The
  // first version of this tool did exactly that and altered 14 of 30 files;
  // the parsed-YAML comparison is what caught it.
  let blockIndent = null;

  for (const line of lines) {
    if (blockIndent !== null) {
      const indent = line.search(/\S/);
      if (line.trim() === '' || indent > blockIndent) {
        out.push(line);
        continue;
      }
      blockIndent = null; // dedented back out of the scalar
    }

    // Opens a block scalar? Everything more-indented below is content.
    if (/(^|\s)[|>][-+]?\d*\s*$/.test(line) && !/^\s*#/.test(line)) {
      blockIndent = line.search(/\S/);
      flush(line.trim());
      out.push(line);
      continue;
    }

    // A whole-line comment (not a trailing one) is prose.
    if (/^\s*#/.test(line)) {
      block.push(line);
      continue;
    }
    if (line.trim() === '') {
      // Blank line inside a block keeps it together; blank after it closes nothing.
      if (block.length) block.push('#');
      else out.push(line);
      continue;
    }
    flush(line.trim());
    out.push(line);
  }
  flush('(end of file)');

  // Collapse the blank runs the removal leaves behind.
  const yaml = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return { yaml, notes };
}

function renderNotes(name, notes) {
  const head =
    `# ${name} — notes\n\n` +
    `Prose extracted from \`${name}\` by \`scripts/compose-extract-notes.mjs\`.\n` +
    `The compose file is passed to Coolify as a command-line argument and competes\n` +
    `with ARG_MAX, so it carries configuration only.\n\n` +
    `Each heading is the configuration line the note was attached to.\n`;
  const body = notes
    .map((n) => `\n## \`${n.anchor}\`\n\n${n.body}\n`)
    .join('');
  return head + body;
}

/**
 * PŘIDÁVÁ, NEPŘEPISUJE.
 *
 * ⛔ NAMĚŘENO 2026-08-15: první běh na všech 33 compose souborech smazal
 * z `docs/compose-notes/` 4 705 řádků a přidal 1 275 — protože se soubor
 * s poznámkami zapisoval `writeFileSync` bez ohledu na to, co v něm bylo.
 * Nástroj tím byl použitelný JEDNOU; podruhé zahodil všechnu dřív vytaženou
 * prózu. Mimo jiné poznámku o odstranění `pgbouncer`, na které visí brána
 * `wp-1-3-pgbouncer` — ta ji v poznámkách hledá a padla.
 *
 * To je nejspíš i důvod, proč nástroj od svého vzniku (24. 7.) nikdo nezapojil:
 * spustit se dal jen naslepo a jednou.
 *
 * Nově se dosavadní obsah zachová a doplní se jen kotvy, které v něm ještě
 * nejsou. Kotva je nadpis `## \`…\`` — podle ní se pozná, co už je popsané.
 */
function mergeNotes(existingPath, name, notes) {
  if (!existsSync(existingPath)) return renderNotes(name, notes);
  const stavajici = readFileSync(existingPath, 'utf8');
  const jizPopsane = new Set(
    [...stavajici.matchAll(/^## `(.+)`$/gm)].map((m) => m[1]),
  );
  const nove = notes.filter((n) => !jizPopsane.has(n.anchor));
  if (!nove.length) return stavajici;
  const pridane = nove.map((n) => `\n## \`${n.anchor}\`\n\n${n.body}\n`).join('');
  return `${stavajici.replace(/\n+$/, '')}\n${pridane}`;
}

let dirty = 0;
for (const f of targets()) {
  const path = join(ROOT, f);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  const { yaml, notes } = extract(text);
  // The pointer header itself is prose — do not count it as a violation.
  const realNotes = notes.filter((n) => !n.body.startsWith('Prose lives in docs/compose-notes/'));
  if (!realNotes.length) continue;

  if (CHECK) {
    console.log(`${f}: ${realNotes.length} prose block(s) still inline`);
    dirty++;
    continue;
  }

  const name = basename(f);
  mkdirSync(NOTES_DIR, { recursive: true });
  const notesPath = join(NOTES_DIR, `${name}.md`);
  writeFileSync(notesPath, mergeNotes(notesPath, name, realNotes));
  writeFileSync(path, POINTER(name) + yaml.replace(/^\n+/, ''));
  const before = text.length;
  const after = POINTER(name).length + yaml.length;
  console.log(
    `${f}: ${before} → ${after} B (-${Math.round((1 - after / before) * 100)}%), ` +
      `${realNotes.length} notes → docs/compose-notes/${name}.md`,
  );
  dirty++;
}

if (CHECK && dirty) {
  console.error(`\n${dirty} compose file(s) still carry prose — run: node scripts/compose-extract-notes.mjs`);
  process.exit(1);
}
