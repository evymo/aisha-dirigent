# heals.sql — post-baseline reconcile & upgrade-path ordering invariants

> How an existing AISHA database is upgraded in place, and the ordering rule that
> a fresh-DB test suite **cannot** catch. Read before adding anything to
> `aisha/db/heals.sql`.

Related: [../../scripts/db/verify-upgrade-apply.sh](../../scripts/db/verify-upgrade-apply.sh) ·
[CAPABILITY_GATES.md](CAPABILITY_GATES.md)

## The two apply paths

AISHA builds its schema from a source-of-truth tree (`aisha/db/sql/**`) concatenated
into a single baseline (`aisha/db/migrations/00000000000000_baseline.sql`).
`scripts/db/migrate.mjs` runs two different things depending on the DB's state:

- **Fresh DB** → applies the baseline once (every CREATE TABLE has every column).
- **Existing DB** → the baseline is recorded with a NULL checksum and is **never
  re-applied**; only `aisha/db/heals.sql` runs, every redeploy. heals is therefore
  the *in-place upgrade mechanism* — it reconciles an old schema up to the current
  source of truth with idempotent statements.

Because "Baseline-only state" gates (~15 of them) forbid net-new delta migrations, a
schema change folded into the baseline reaches **existing** databases **only** via
heals.sql (or a destructive `--wipe`).

## The invariant

> **heals.sql runs top-to-bottom on an existing (possibly old) database. Every
> statement that references a column/table/policy MUST appear AFTER the
> `ADD COLUMN IF NOT EXISTS` / `CREATE … IF NOT EXISTS` that guarantees it.**

heals statements must each be individually idempotent (`IF NOT EXISTS`,
`CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS`, guarded `UPDATE … WHERE`) because
they run on every redeploy against a DB in an unknown prior state.

## Why a fresh-DB test cannot catch a violation

On a **fresh** DB the baseline already created the column, so a heals statement that
references it works regardless of where it sits in the file. The ordering bug is
invisible to `test:db` and every cold-start-from-scratch test. It only surfaces on a
real **existing** DB where that column did not yet exist — i.e. a production
redeploy. That is exactly the blind spot the upgrade-path gate exists to close.

## The gate that does catch it

`scripts/db/verify-upgrade-apply.sh` reproduces a prod redeploy:

1. build a probe DB via the real runner (substrate → migrate.mjs),
2. **regress** it to a pre-fold state — drop the surface heals.sql reconciles
   (columns, agent-activity / ai-spend tables, enums): *what an existing pre-fold
   prod DB looks like*,
3. re-run the real runner (migrate.mjs → no-pending → **heals.sql**) — the exact
   prod-redeploy code path — and assert the surface is back,
4. apply the real seed and assert it succeeds.

A reference-before-ADD bug fails this gate red instead of failing in production.

## Worked example (the bug this doc was written for)

PR #507 added, to `ai_runtime_registry`, a reconcile that enables the new CLI runtime:

```sql
UPDATE public.ai_runtime_registry
SET is_enabled = true, is_in_process_executor = true, updated_at = now()
WHERE slug = 'cli:claude-cli' AND is_in_process_executor = false;
```

It was placed ~500 lines **before** the `ADD COLUMN IF NOT EXISTS
is_in_process_executor` in the `ai_runtime_registry` column-backfill block. Fresh DBs
(baseline already has the column) stayed green; only the upgrade probe failed:

```
heals.sql:607: ERROR: column "is_in_process_executor" does not exist
```

Fix: move the reconcile UPDATE to **after** the column-backfill block + `\ir` of the
table SoT, where `is_enabled` and `is_in_process_executor` are guaranteed.

## Checklist before editing heals.sql

- Does every column/table/policy this statement names get ADDed/CREATEd earlier in
  the file? If not, move the statement down (or the ADD up).
- Is the statement idempotent on a re-run against an arbitrary prior state?
- A `CREATE OR REPLACE FUNCTION` whose **signature** changed needs a
  `DROP FUNCTION IF EXISTS (old-sig)` first (else an ambiguous overload).
- Verify with `bash scripts/db/verify-upgrade-apply.sh` against a throwaway pg17 —
  not just `test:db`.
