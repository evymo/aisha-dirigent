# DB Security Invariants — automated, queryable checks

Two DB-resident assertion RPCs that turn already-documented aisha security
rules into **checks you can run** — from CI, from Aisha's autonomous loop, or
straight from the Appsmith operator UI. They are the platform-wide
generalization of the grant-audit the audience module had to build for itself.

Migration: [`aisha/db/migrations/20260530160000_aisha_db_security_invariants.sql`](../../aisha/db/migrations/20260530160000_aisha_db_security_invariants.sql)

| Invariant | Documented in | Assertion RPC |
|---|---|---|
| A `SECURITY DEFINER` function must not expose `EXECUTE` to `PUBLIC`/`anon` | [`RPC_FUNCTION_SECURITY.md`](./RPC_FUNCTION_SECURITY.md) | `aisha_assert_definer_grants()` |
| An RLS policy must not reference its own table (route self-refs through a `SECURITY DEFINER` helper) | [`RLS_POLICY_DOCUMENTATION.md`](./RLS_POLICY_DOCUMENTATION.md) | `aisha_assert_rls_self_reference()` |

Both functions return **rows = violations**; an **empty result means the
invariant holds**.

## Why this exists

These are not new rules — aisha already prescribes both:

- `RPC_FUNCTION_SECURITY.md`: *"Každá funkce s `GRANT TO anon` MUSÍ mít
  `SECURITY DEFINER`"* and documents the schema-USAGE → function-EXECUTE grant
  chain. A `SECURITY DEFINER` function that keeps Postgres' **default**
  `EXECUTE TO PUBLIC` grant (i.e. nobody ever ran `REVOKE … FROM PUBLIC`) is a
  privilege-escalation surface: any caller, including `anon`, runs it with the
  definer's rights.
- `RLS_POLICY_DOCUMENTATION.md`: *"No RLS bypass — only SECURITY DEFINER helper
  functions."* A policy whose `USING` / `WITH CHECK` expression reads its **own**
  table re-enters policy evaluation and raises Postgres `42P17` (infinite
  recursion) — every read that touches the table 500s.

What was missing was a way to **verify** them mechanically. The audience module
hit both bugs live and fixed them locally (it added `audience_audit_grants()`
plus an event trigger to auto-revoke `PUBLIC` execute, and rerouted
`story_participants` policies through `is_story_partner()` helpers). This
migration lifts the *checks* out of the audience namespace so they cover the
whole database.

## Findings on a clean cold-start database

Reproducible: apply the generated baseline + every delta migration (the
`scripts/db/verify-cold-start-apply.sh` path), then run both RPCs read-only.
On the cold-start schema (baseline + deltas through `20260530160000`):

```
definer_public_grant_violations = 105   (78 → anon, 27 → PUBLIC; 102 public, 3 aisha_auth)
rls_self_reference_hits         =   4   (FROM/JOIN-anchored — see below)
```

So this is not theoretical: 105 `SECURITY DEFINER` functions still expose
`EXECUTE` to `PUBLIC`/`anon`, and 4 RLS policies query their own table in a
`FROM`/`JOIN` (`call_participants` + 3 `story_participants` policies — the
latter are what `20260530130000_fix_story_participants_rls_recursion` reroutes
through `is_story_partner()`). The assertions give the team a concrete,
prioritizable backlog.

> **Heuristic accuracy (RLS check).** A naive `\mtablename\M` match flagged **20**
> policies — but ~80% were false positives: Postgres deparses every own-column
> reference as `tablename.column`, so any policy that filters on its own columns
> (the normal case) trips a naked match. The shipped check anchors to
> `(FROM|JOIN) [schema.]tablename`, which is the actual 42P17 vector (a subquery
> that re-enters the table's own policies) — collapsing 20 noisy hits to the 4
> genuine ones. Still a heuristic; review each hit.

> **These are reporting/triage tools, not a zero-tolerance gate — yet.** With 105
> pre-existing definer hits, wiring `aisha_assert_definer_grants()` into a
> blocking CI gate today would fail every build. Treat the current count as a
> baseline, burn it down, then flip to "fail on any **new** violation" (or "fail
> on count > baseline"). The 4 RLS hits are small enough to drive to zero first.

## How to run it

**psql / migration-test DB:**
```sql
SELECT * FROM public.aisha_assert_definer_grants();      -- definer fns leaking PUBLIC/anon EXECUTE
SELECT * FROM public.aisha_assert_rls_self_reference();  -- RLS policies naming their own table
```

**PostgREST (CI / Aisha / Appsmith)** — both are granted to `service_role`:
```bash
curl -s "$AISHA_POSTGREST_URL/rpc/aisha_assert_definer_grants" \
  -X POST -H "Authorization: Bearer $AISHA_SERVICE_TOKEN" -H 'Content-Type: application/json' -d '{}'
```

Because the checks live in the DB, the Appsmith operator console and Aisha's
autonomous loop can read them with no extra plumbing — the same "policy ≡
knowledge ≡ DB" pattern `aisha_static_defense_rules` already uses.

## Design notes

- **Least privilege (`SECURITY INVOKER`).** Both RPCs read only world-readable
  system catalogs (`pg_proc` / `pg_policies` / `pg_roles`), so they run as
  `SECURITY INVOKER` (the default) — no definer rights needed. They are
  `STABLE`, read only, `REVOKE ALL … FROM PUBLIC`, and `GRANT EXECUTE … TO
  service_role` only. (A `SECURITY DEFINER` version would itself trip the
  "SECURITY DEFINER needs an auth check" gate — the very class of issue these
  checks surface — so `INVOKER` is both correct and self-consistent.)
- **`aisha_assert_definer_grants()`** `COALESCE`s `proacl` to
  `acldefault('f', proowner)` so functions that *never had* an explicit
  grant/revoke (NULL ACL = implicit `EXECUTE TO PUBLIC`) are still caught, and
  resolves grantee `0` to the `PUBLIC` pseudo-role.
- **`aisha_assert_rls_self_reference()`** is a heuristic anchored to a `FROM` /
  `JOIN` on the own table inside the *expanded* `pg_policies.qual` /
  `.with_check` text: `(FROM|JOIN)\s+(ONLY\s+)?[schema.]tablename`. This targets
  the real 42P17 vector — a subquery that re-enters the table's own policies —
  while ignoring benign own-column references (Postgres deparses those as
  `tablename.column`, which a naked table-name match would flag; that produced
  ~80% false positives). A policy that delegates to a `SECURITY DEFINER` helper
  won't match (the helper name isn't the table name) — which is exactly why the
  helper fix works. Review each hit; a self-reference is a recursion *risk*, not
  always a live 500.

## Follow-up

**1. Cold-start definer-RPC-security gate — DONE.** `verify-cold-start-apply.sh`
step **5/5** runs [`scripts/db/check-definer-rpc-security.mjs`](../../scripts/db/check-definer-rpc-security.mjs)
against the applied cold-start catalog. It closes `access.mjs`'s blind spot:
`access.mjs --static` (the CI governance-gate) lints only `aisha/db/sql/functions/*.sql`,
so functions defined in **migrations** are invisible to it. The checker reads the
**catalog** (authoritative — migration *text* cannot reconstruct the post-`REVOKE`
state; the audience module revokes PUBLIC via a runtime-generated `format()`
statement no text scan can see) for `SECURITY DEFINER` functions that are
PUBLIC/anon-EXECUTE-able, have no auth check, are not a (event-)trigger, and are
**not** in `sql/functions/`, failing on any not on the reviewed
[allowlist](../../src/tests/gates/definer-rpc-security.allowlist.json). It is
**identity-keyed (not a count)** — a new footgun is a new name = a hard fail,
un-maskable by swapping one function for another. The static
[`definer-rpc-security.gate.test.ts`](../../src/tests/gates/definer-rpc-security.gate.test.ts)
(in `npm run test:gates`) guards the wiring + keeps the allowlist minimal; the
cold-start gate itself runs in CI via the `coldstart-db-gate` job (builds the pg17
image — pgaudit included — applies baseline + every delta, runs step 5/5).

   *Rejected approaches (recorded so they are not re-tried):* a **count-ceiling**
   baseline was built and dropped — the definer+PUBLIC/anon class is heterogeneous
   (mostly intentional public-reference RPCs + a few real footguns), so a global
   count is semantically muddy **and** identity-blind (a swap masks a new footgun). A
   **file-scan** of migrations was built and dropped — it false-positived on 10
   already-revoked audience functions, because the audience `REVOKE` is a
   runtime-generated `format()` statement invisible to any text scan. Only the
   catalog is reliable.

**Finding (fixed in #254) — fresh deploys were insecure.** Running step 5/5 on a real
cold-start (and cross-confirmed by `aisha_assert_definer_grants()` = 132, 24 of them
audience, and the audience module's own `audience_audit_grants()` = 77) showed that a
**fresh deploy** left the entire audience `SECURITY DEFINER` surface exposed to
PUBLIC/anon — including DML (`audience_tag_resource`, `audience_upsert_user_engagement`,
…). The hardening `REVOKE` lived only in live-ops, never as a migration; SEC5's event
trigger only covers functions created *after* it installs.
[`20260531000000_audience_revoke_public_execute.sql`](../../aisha/db/migrations/20260531000000_audience_revoke_public_execute.sql)
captures that revoke (I1–I4: PUBLIC/anon EXECUTE, anon SELECT on audience relations,
broker-only over-grant — categorical + idempotent), driving `audience_audit_grants()`
to **0** on cold-start with `authenticated`/`service_role` retained (no breakage).
#254 also carried the `infra/postgres/set-passwords.sh` fresh-boot fix (it `ALTER`ed
`postgres_exporter` before that role's migration runs, which blocked the cold-start
from booting at all). This gate is what makes a regression of either fail CI.

   *The other ~108 cold-start definer+PUBLIC/anon functions are NOT a footgun
   backlog:* **74** are intentional public-reference RPCs (`get_currency_rates`,
   `get_product_catalog`, `get_news_article_by_slug`, `get_*_reference_ranges`, … —
   the public API needs anon to call them), **31** self-authorize (`auth.uid()` /
   `is_admin_or_staff()` / JWT), **9** are (event-)trigger functions whose grant is
   moot. The few non-audience write RPCs (`mcp_*`, `register_plugin_event`) need their
   **owners'** review (anon exposure may be intentional) and are deliberately NOT
   blanket-revoked here.

**2. Platform-wide auto-revoke event trigger — still deferred.** The audience module
installs one scoped to `public.audience_*`. A **blanket** platform-wide version is
partly *wrong*: the 74 intentional public-reference RPCs above legitimately grant
`anon`, and aisha's own `RPC_FUNCTION_SECURITY.md` mandates anon-callable RPCs be
`SECURITY DEFINER` — so a `CREATE OR REPLACE` of one would strip its intended `anon`
grant. A safe version must gate on `prosecdef` AND let *explicit* post-create grants
survive (it fires at `ddl_command_end`, before the migration's own `GRANT … TO anon`)
AND scope to the sensitive subset. Its own PR + rollout note.

**3. RLS self-reference invariant — now gated (this closes Follow-up #3's loop).**
The second invariant is operationalized alongside the definer one:
`verify-cold-start-apply.sh` step 5/5 also runs
[`scripts/db/check-rls-self-reference.mjs`](../../scripts/db/check-rls-self-reference.mjs),
which calls `aisha_assert_rls_self_reference()` against the cold-start catalog and
fails on any self-reference not on its
[allowlist](../../src/tests/gates/rls-self-reference.allowlist.json) (identity-keyed
on `table::policy`, guarded by
[`rls-self-reference.gate.test.ts`](../../src/tests/gates/rls-self-reference.gate.test.ts)).
On a clean cold-start there is exactly **one** self-reference left —
`call_participants :: "Participants can view room members"` (the 3 `story_participants`
policies were rerouted through `is_story_partner()` by
`20260530130000_fix_story_participants_rls_recursion`). It is **allowlisted, not
rewritten**: routing it through an `is_call_participant()` helper (the `is_story_partner`
pattern) touches call-room access semantics owned by the realtime-comms team. The gate
now blocks any **new** RLS self-reference while that known one is driven to zero by its
owner — same detect-and-allowlist posture the definer gate takes toward functions it
does not own.
