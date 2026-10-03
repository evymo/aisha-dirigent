#!/bin/sh
# =============================================================================
# ensure-worktree-hooks.sh — make the committed husky hooks fire in worktrees
# =============================================================================
# Problem
# -------
# husky v9 sets  core.hooksPath = .husky/_  (a RELATIVE path, resolved per
# working tree). That `_` dir is git-ignored (.husky/_/.gitignore = "*") and is
# only materialised by `npm install`'s `prepare: husky` step. A linked git
# worktree (e.g. .claude/worktrees/*) that borrows the primary checkout's
# node_modules WITHOUT re-installing therefore has NO .husky/_ of its own — so
# git finds no hook and skips pre-commit / pre-push SILENTLY. Commits and pushes
# from such a worktree go through UNGATED, quietly defeating the repo's strict
# no-bypass policy.
#
# Fix
# ---
# Ensure .husky/_ exists in THIS working tree. The cheapest, most reliable
# source is a plain copy of .husky/_ from the primary (common) checkout — it
# needs no node_modules, so it even works at `git worktree add` time (before
# deps are linked), which is exactly when the companion .husky/post-checkout
# hook calls us. If the primary copy is unavailable we fall back to
# regenerating via the husky CLI (needs node_modules).
#
# Guarantees
# ----------
#   * Idempotent  — exits immediately if .husky/_ is already present.
#   * Non-blocking — always exits 0; never aborts a checkout or commit.
#   * Faithful    — restores husky's OWN wrapper verbatim; it does NOT weaken,
#                   skip, or rewrite any hook. The real gates still run.
#
# Manual use:  npm run setup:worktree-hooks   (or: sh scripts/ensure-worktree-hooks.sh)
# Skip husky entirely (per husky's own contract):  HUSKY=0 git commit ...
# =============================================================================
set -u

# Resolve the working-tree root, independent of the current directory (this
# script is invoked both from `npm run` and from the post-checkout git hook).
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$root" ] || exit 0
cd "$root" || exit 0

# Nothing to do if husky isn't configured here, or the wrapper already exists.
[ -d .husky ] || exit 0
[ -f .husky/_/h ] && exit 0

emit() { [ -n "${ENSURE_HOOKS_QUIET:-}" ] || printf 'ensure-worktree-hooks: %s\n' "$*"; }

# --- 1) Copy .husky/_ from the primary (common) checkout — dependency-free. ---
# In a linked worktree, --git-common-dir points at <primary>/.git; the primary
# working tree is its parent. The primary always has a fresh .husky/_ after a
# normal `npm install`, and copying it needs nothing but cp/mkdir.
common=$(git rev-parse --git-common-dir 2>/dev/null || printf '')
if [ -n "$common" ]; then
	case "$common" in
		/*) ;;                                                  # already absolute
		*)  common=$(CDPATH= cd -- "$common" 2>/dev/null && pwd || printf '') ;;
	esac
	primary=$(CDPATH= cd -- "$common/.." 2>/dev/null && pwd || printf '')
	if [ -n "$primary" ] && [ "$primary" != "$root" ] && [ -f "$primary/.husky/_/h" ]; then
		mkdir -p .husky/_
		# `/.` copies directory contents (incl. dotfiles like .gitignore),
		# robust whether or not the destination already exists.
		if cp -R "$primary/.husky/_/." .husky/_/ 2>/dev/null; then
			emit "restored .husky/_ from primary checkout ($primary) — hooks now active"
			exit 0
		fi
	fi
fi

# --- 2) Fall back to regenerating via the husky CLI (needs node_modules). -----
# This is the same generation `prepare: husky` runs; pure local file writes.
if [ -x node_modules/.bin/husky ] && node_modules/.bin/husky >/dev/null 2>&1; then
	emit "regenerated .husky/_ via husky — hooks now active"
	exit 0
fi
if command -v node >/dev/null 2>&1 && [ -f node_modules/husky/bin.js ] \
	&& node node_modules/husky/bin.js >/dev/null 2>&1; then
	emit "regenerated .husky/_ via husky — hooks now active"
	exit 0
fi

emit "could not restore .husky/_ (no primary copy and no node_modules). Run 'npm install' once in the primary checkout, then 'npm run setup:worktree-hooks' here."
exit 0
