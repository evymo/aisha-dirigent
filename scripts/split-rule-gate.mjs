#!/usr/bin/env node
/**
 * Split-rule gate (kanaly-prispevku §1) — generic channels must not NAME an
 * implementation.
 *
 * THE RULE
 * Instance values live in the instance channels: instances/<id>/ (checked-in
 * overlay), config/, coolify/, domains/templates/<id>/, and the instance-data
 * repo. Everything else is generic and must work for any instance.
 *
 * WHAT COUNTS AS AN INSTANCE IS DERIVED, NOT LISTED
 * The identifiers come from the directories under instances/ — the tree's own
 * declaration of which implementations exist. The previous version hardcoded
 * `PATTERN='riq'`, which is the same defect the rule exists to prevent: it names
 * one implementation inside the generic tree, and it silently stops covering a
 * second instance the day one is added.
 *
 * WHY THIS IS NOT `grep -ri <id>` (measured 2026-07-28)
 * A plain substring scan of the generic channels returns 249 lines. 160 are the
 * French UI dictionary — Histo·riq·ue, Mét·riq·ues, numé·riq·ue, géné·riq·ue,
 * sé·riq·ue — and an earlier case-insensitive variant also matched base64
 * integrity hashes (`sha512-IxpibTjyVnmrIQo5`). A gate whose output is two
 * thirds noise acquires an allowlist within a week, and an allowlisted gate
 * tests nothing.
 *
 * So the match is on a TOKEN: the id must be preceded by something that is not a
 * letter or a digit IN THE UNICODE SENSE. `[^A-Za-z0-9]` is not enough — `é` is
 * outside ASCII and would make "numériques" a match, which is how the first
 * rewrite still reported 40 French strings. `(?<![\p{L}\p{N}])` with the `u`
 * flag is the property: keeps `get_riq_metrics`, `/<fork>-lora.gguf`,
 * `"riq:metrics"`, `<fork>-staging`; drops every natural-language word, without
 * naming a single exception.
 *
 * WHY COMMENTS ARE OUT OF SCOPE
 * This repo documents defects where they happened: "measured 2026-07-21:
 * <fork>-potok stuck on 'setup key is invalid'". Those lines name an instance but
 * nothing depends on them — they are the reasoning that makes the guard around
 * them legible. The rule is about DEPENDENCE, not about the string. A
 * comment-only line is therefore skipped; a comment trailing real code is not
 * (the code part is still scanned).
 *
 *   npm run gate
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Generic channels. `aisha/db/sql` replaces the old `db` entry: no top-level db/
 * exists, so that entry matched nothing and the SQL source of truth — where an
 * instance name is most expensive, because the whole stack inherits the schema —
 * went unscanned for as long as the gate existed.
 */
const GENERIC_DIRS = [
  'packages',
  'services',
  'apps',
  'scripts',
  'src',
  'aisha/db/sql',
  'instances/_default',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'build', 'coverage', '.venv', '__pycache__']);
/** Lockfiles carry random base64 integrity hashes; they are generated, not authored. */
const SKIP_FILES = new Set(['package-lock.json', 'poetry.lock', 'uv.lock', 'Cargo.lock', '.git']);
const SELF = 'split-rule-gate.mjs';

/** Line whose first non-space character starts a comment — documentation, not dependence. */
const COMMENT_ONLY = /^\s*(#|\/\/|\/\*|\*|--|"""|''')/;

function instanceIds() {
  const dir = join(ROOT, 'instances');
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    // The overlay CHANNEL itself is gone. Not the same as "this tree has no
    // tenant" — it means the split the whole rule is about no longer exists.
    if (err.code === 'ENOENT') return null;
    unreadable.push(`instances/ (${err.code ?? err.message})`);
    return null;
  }
  return entries.filter((d) => d !== '_default' && statSync(join(dir, d)).isDirectory());
}

/**
 * Anything this run could not read. A scanner that swallows an unreadable path
 * reports "clean" for code it never opened — the same lie as a green gate with
 * no identifiers to look for. Collected here and turned into a failure.
 */
const unreadable = [];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    unreadable.push(`${relative(ROOT, dir)}/ (${err.code ?? err.message})`);
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(join(dir, e.name));
    } else if (e.isFile() && !SKIP_FILES.has(e.name) && e.name !== SELF) {
      yield join(dir, e.name);
    }
  }
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

/**
 * Submodules are separate repositories, and CI checks this one out WITHOUT them
 * (check-web uses a plain actions/checkout, and one job pins submodules:false
 * because the runner cannot reach github.com). So their directories are empty in
 * CI and populated locally — the same command would measure two different trees
 * and nobody would know which.
 *
 * They are still scanned when present, because the rule applies to them too. The
 * point is that the coverage is PRINTED either way: a gate that quietly checks
 * less than it appears to is worse than one that checks less openly.
 */
function submodulePaths() {
  let text;
  try {
    text = readFileSync(join(ROOT, '.gitmodules'), 'utf8');
  } catch {
    return [];
  }
  return [...text.matchAll(/^\s*path\s*=\s*(.+)$/gm)].map((m) => m[1].trim());
}

/**
 * "Checked out" means: the directory exists and has content. An unreadable
 * directory is NOT reported as absent — that would quietly downgrade coverage on
 * an I/O error and still print a pass. It goes on the unreadable list instead.
 */
function isCheckedOut(abs) {
  try {
    return readdirSync(abs).length > 0;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    unreadable.push(`${relative(ROOT, abs)}/ (${err.code ?? err.message})`);
    return false;
  }
}

const ids = instanceIds();

// Zero tenants is produced by two trees that mean OPPOSITE things, and
// conflating them makes this gate either a liar or a permanent roadblock:
//
//   (a) GENERIC / upstream — instances/ carries the _default template and no
//       tenant, because upstream HAS no tenant. There is genuinely nothing to
//       find. Failing here would make the generic repository permanently red
//       for the crime of being generic, and every fork that upstreams its work
//       would have to ship a fake tenant to get CI green.
//
//   (b) DISSOLVED overlay — a tenant is expected but its directory is gone.
//       That is the state this repo sat in while a tenant overlay lived in a
//       dissolved repository, and passing it is exactly the "found nothing"
//       vs "nothing to find" lie the gate exists to prevent.
//
// The discriminator is the overlay CHANNEL, not the tenant count. (a) still has
// an intact instances/_default — the template every generic renderer is written
// against. A tree that lost instances/ entirely, or lost _default, has no basis
// for claiming it is clean about a split it no longer implements.
//
// AISHA_INSTANCE_ID is the explicit override: when a caller names the tenant it
// expects, a missing overlay is (b) no matter what the directory looks like.
if (ids === null) {
  console.error('FAIL: instances/ is missing or unreadable — the overlay channel itself is gone.');
  console.error('      This gate cannot report a split it can no longer see.');
  process.exit(1);
}

if (ids.length === 0) {
  const expected = (process.env.AISHA_INSTANCE_ID ?? '').trim();
  if (expected) {
    console.error(`FAIL: AISHA_INSTANCE_ID=${expected} but instances/${expected}/ has no overlay.`);
    console.error('      A declared tenant with no overlay is a dissolved instance, not a generic tree.');
    process.exit(1);
  }
  if (!isCheckedOut(join(ROOT, 'instances', '_default'))) {
    console.error('FAIL: no tenant overlay AND no instances/_default template.');
    console.error("      A pass here would mean 'found nothing', not 'nothing to find'.");
    process.exit(1);
  }
  console.log('OK: no tenant overlay under instances/ — generic (upstream) tree.');
  console.log('    instances/_default present, so the split is implemented; there is');
  console.log('    simply no implementation to name. Set AISHA_INSTANCE_ID to assert one.');
  process.exit(0);
}

const patterns = ids.map((id) => ({
  id,
  re: new RegExp(`(?<![\\p{L}\\p{N}])(${id}|${id.toUpperCase()})(?![\\p{L}\\p{N}])`, 'u'),
}));

let violations = 0;
let missingChannel = false;

for (const chan of GENERIC_DIRS) {
  const abs = join(ROOT, chan);
  try {
    statSync(abs);
  } catch {
    console.error(`FAIL: generic channel '${chan}' does not exist — stale gate.`);
    missingChannel = true;
    continue;
  }
  for (const file of walk(abs)) {
    let buf;
    try {
      buf = readFileSync(file);
    } catch (err) {
      unreadable.push(`${relative(ROOT, file)} (${err.code ?? err.message})`);
      continue;
    }
    if (isBinary(buf)) continue;
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      if (COMMENT_ONLY.test(line)) return;
      for (const { id, re } of patterns) {
        if (re.test(line)) {
          console.error(
            `${relative(ROOT, file)}:${i + 1}: instance '${id}' named in generic channel '${chan}'`,
          );
          console.error(`    ${line.trim().slice(0, 140)}`);
          violations++;
          break;
        }
      }
    });
  }
}

const subs = submodulePaths();
const scanned = subs.filter((p) => isCheckedOut(join(ROOT, p)));
const absent = subs.filter((p) => !isCheckedOut(join(ROOT, p)));
if (subs.length > 0) {
  console.log(
    `coverage: ${scanned.length}/${subs.length} submodule(s) checked out and scanned` +
      (absent.length ? ` — NOT scanned (empty checkout): ${absent.join(', ')}` : ''),
  );
}

if (unreadable.length > 0) {
  console.error(`\nFAIL: ${unreadable.length} path(s) could not be read, so they were not checked:`);
  for (const u of unreadable) console.error(`  ${u}`);
  console.error('      Reporting "clean" for a path this run never opened is the same');
  console.error('      lie as passing with nothing to look for.');
}

if (violations > 0 || missingChannel || unreadable.length > 0) {
  if (violations > 0) {
    console.error(`\nFAIL: ${violations} instance literal(s) in generic channels.`);
    console.error('      Move the value into an instance channel (instances/<id>/, config/,');
    console.error('      coolify/, or the instance-data repo) and read it from there.');
  }
  process.exit(1);
}
console.log(`OK: generic channels name no instance (checked: ${ids.join(', ')}).`);
