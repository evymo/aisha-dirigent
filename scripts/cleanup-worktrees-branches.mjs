#!/usr/bin/env node
/**
 * cleanup-worktrees-branches.mjs — prune INTEGRATED branches + their worktrees.
 *
 * SAFETY CONTRACT: a branch/worktree is removed ONLY when its work is provably in main, by one of
 * three DERIVED signals (no maintained allow-list):
 *   1. literal merge        — `git branch --merged origin/main`
 *   2. merged Forgejo PR     — a closed+merged PR whose head ref is this branch (squash/rebase merges)
 *   3. content already in main — main matches the branch on EVERY file the branch's own commits
 *      touched (catches work squash-merged under a DIFFERENT head-ref name, which signals 1+2 miss).
 * Anything else is FLAGGED and NEVER deleted, so unintegrated work is never lost. Protected always:
 * main / master / _local-main and the CURRENTLY checked-out branch.
 *
 * Usage:
 *   node scripts/cleanup-worktrees-branches.mjs            # dry-run (default) — lists SAFE vs FLAGGED
 *   node scripts/cleanup-worktrees-branches.mjs --apply    # actually remove the SAFE items
 *
 * No shell is used (execFileSync with arg arrays — no command injection). The Forgejo token
 * (FORGEJO_API_TOKEN in .env-prod-backup) is read and sent only as an Authorization header via the
 * built-in fetch — never on a command line, never printed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).toString();
const tryGit = (args, opts) => { try { return git(args, opts); } catch { return ''; } };

const repoRoot = git(['rev-parse', '--show-toplevel']).trim();
const current = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
const PROTECTED = new Set(['main', 'master', '_local-main', current]);

tryGit(['fetch', 'origin', 'main', '--quiet']);
const MAIN = tryGit(['rev-parse', '--verify', '--quiet', 'origin/main']).trim() ? 'origin/main' : 'main';

// --- signal 1: literal merge into main ---
const literalMerged = new Set(
  git(['branch', '--merged', MAIN]).split('\n').map((s) => s.replace(/^[*+ ]+/, '').trim()).filter(Boolean),
);

// --- signal 2: a MERGED Forgejo PR whose head ref is this branch (squash/rebase merges) ---
const mergedPrBranches = new Set();
try {
  const token = (readFileSync(`${repoRoot}/.env-prod-backup`, 'utf8').match(/^FORGEJO_API_TOKEN=(.+)$/m)?.[1] ?? '')
    .replace(/["']/g, '').trim();
  if (!token) {
    console.warn('⚠ no FORGEJO_API_TOKEN in .env-prod-backup — relying on literal + content signals only.');
  } else {
    // Derive the Forgejo API base from the origin remote — no hardcoded forge host in shipping
    // code (the no-hardcoded-deployment-config gate forbids literal forge hosts); the configured
    // remote IS the source of truth for where this repo lives.
    const remote = tryGit(['remote', 'get-url', 'origin']).trim();
    const rm = remote.match(/^(https?:\/\/[^/]+)\/(.+?)(?:\.git)?$/);
    if (!rm) {
      console.warn('⚠ origin remote is not an HTTP(S) forge URL — relying on literal + content signals.');
    } else {
      const api = `${rm[1]}/api/v1/repos/${rm[2]}/pulls`;
      for (let page = 1; page <= 30; page++) {
        const res = await fetch(`${api}?state=closed&limit=50&page=${page}`, { headers: { Authorization: `token ${token}` }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) { console.warn(`⚠ Forgejo PR list HTTP ${res.status} — relying on literal + content signals.`); break; }
        const prs = await res.json();
        if (!Array.isArray(prs) || prs.length === 0) break;
        for (const pr of prs) if (pr.merged_at && pr.head?.ref) mergedPrBranches.add(pr.head.ref);
      }
      console.log(`Forgejo: ${mergedPrBranches.size} merged-PR head branches detected.`);
    }
  }
} catch (e) {
  console.warn(`⚠ Forgejo PR-state check skipped (${e.message}) — relying on literal + content signals.`);
}

// --- signal 3: CONTENT already in main (squash-merge under a different head ref) ---
// main matches the branch on EVERY file the branch's own commits touched ⇒ those changes are in main
// verbatim (the file would differ if any were missing). A derived check, not a maintained list.
const contentIntegrated = (b) => {
  try {
    const base = git(['merge-base', MAIN, b]).trim();
    if (!base) return false;
    const files = git(['diff', '--name-only', `${base}..${b}`]).split('\n').map((s) => s.trim()).filter(Boolean);
    if (files.length === 0) return false; // nothing unique — leave for review rather than guess
    // --quiet → exit 1 (throws) on any difference, exit 0 (returns) when main matches on every file.
    // Output is suppressed, so a branch main has since evolved past can't ENOBUFS the read buffer.
    git(['diff', '--quiet', `${MAIN}..${b}`, '--', ...files]);
    return true;
  } catch { return false; }
};

// Returns WHY a branch is integrated ('merged' | 'pr-merged' | 'content-in-main'), or null if not.
const integrationReason = (b) => {
  if (!b) return null;
  if (literalMerged.has(b)) return 'merged';
  if (mergedPrBranches.has(b)) return 'pr-merged';
  if (contentIntegrated(b)) return 'content-in-main';
  return null;
};
const isAncestorOfMain = (commit) => { try { git(['merge-base', '--is-ancestor', commit, MAIN]); return true; } catch { return false; } };

// --- worktrees ---
const worktrees = git(['worktree', 'list', '--porcelain']).split('\n\n').map((block) => {
  const path = block.match(/^worktree (.+)$/m)?.[1];
  const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null;
  const detached = /^detached$/m.test(block);
  const head = block.match(/^HEAD ([0-9a-f]+)$/m)?.[1] ?? null;
  return path ? { path, branch, detached, head } : null;
}).filter(Boolean);

const safeWt = [], flaggedWt = [];
for (const wt of worktrees) {
  if (wt.path === repoRoot) continue; // never the primary checkout
  const why = wt.detached ? (wt.head && isAncestorOfMain(wt.head) ? 'ancestor-of-main' : null) : integrationReason(wt.branch);
  (why ? safeWt : flaggedWt).push({ ...wt, why });
}

// --- branches ---
const allBranches = git(['branch', '--format=%(refname:short)']).split('\n').map((s) => s.trim()).filter(Boolean);
const safeBr = [], flaggedBr = [];
for (const b of allBranches) {
  if (PROTECTED.has(b)) continue;
  const why = integrationReason(b);
  if (why) safeBr.push({ b, why }); else flaggedBr.push(b);
}

// --- report ---
const wtLabel = (w) => (w.detached ? 'detached ' + w.head?.slice(0, 8) : w.branch);
console.log(`\n=== cleanup ${APPLY ? '⚙ APPLY' : '🔍 dry-run (pass --apply to execute)'} ===`);
console.log(`compare-against: ${MAIN}   protected: ${[...PROTECTED].join(', ')}`);
console.log(`\n✅ SAFE to remove — work IS in main (${safeWt.length} worktrees, ${safeBr.length} branches):`);
safeWt.forEach((w) => console.log(`   worktree  ${w.path}  [${wtLabel(w)}]  (${w.why})`));
safeBr.forEach((x) => console.log(`   branch    ${x.b}  (${x.why})`));
console.log(`\n⚠ FLAGGED — NOT provably in main, KEPT for your review (${flaggedWt.length} worktrees, ${flaggedBr.length} branches):`);
flaggedWt.forEach((w) => console.log(`   worktree  ${w.path}  [${wtLabel(w)}]  — has commits not in main`));
flaggedBr.forEach((b) => console.log(`   branch    ${b}  — has commits not in main`));

if (!APPLY) {
  console.log('\n(dry-run: nothing deleted. Integrate or confirm-abandon the FLAGGED items, then re-run with --apply.)');
  process.exit(0);
}

// --- apply: remove SAFE worktrees (no --force → a stray uncommitted change blocks + is reported), then SAFE branches ---
console.log('\n--- applying ---');
for (const w of safeWt) {
  try { git(['worktree', 'remove', w.path]); console.log(`removed worktree ${w.path}`); }
  catch (e) { console.warn(`KEPT worktree ${w.path} (has local changes? ${String(e.message).split('\n')[0]})`); }
}
tryGit(['worktree', 'prune']);
for (const { b } of safeBr) {
  try { git(['branch', '-D', b]); console.log(`deleted branch ${b}`); }
  catch (e) { console.warn(`KEPT branch ${b} (${String(e.message).split('\n')[0]})`); }
}
console.log('\nDone. FLAGGED items were left untouched.');
