# IDOR audit — `p_user_id` SECURITY DEFINER surface (2026-07-15)

> **Status: LIVE CRITICAL FINDING.** `award_tokens` lets any authenticated user mint
> unlimited governance tokens. Fix batches below; gate rewrite last.
>
> Method: signature-scoped scan → 37 candidates → 27 findings → **25 survived hostile
> adversarial refutation** (36 agents, 564 tool-calls). Every claim below was attacked
> by an independent refuter and held.

## Why this went unnoticed

`src/tests/gates/idor-prevention.gate.test.ts` rule 5 matches `/\bp_user_id\b/` over the
**whole file**, so it flags every function that merely passes `p_user_id` as a named arg to
a nested call (`p_user_id := v_user_id`). Measured: **436 whole-file hits vs 88 signature
hits** — ~80 % noise. Because the list was unreadable, the rule was left as
`console.warn` ("log but don't fail") — a silent skip. Real holes drowned in the noise.

A second suppressor: `KNOWN_NO_AUTH_FUNCTIONS` in `src/tests/gates/security-known-issues.ts`
lists `award_tokens` as *"Helper/utility — volány z jiných SQL funkcí, ne přímo user-facing"*.
That is **factually false** — it is `GRANT`ed to `authenticated` and called from React
(`src/hooks/useTokens.ts:232`). The allowlist entry is what hides the critical bug.

## The critical one: `award_tokens`

Reachability verified end-to-end by the refuter:
`GRANT EXECUTE … TO authenticated` → PostgREST exposes it → the gateway's `/rest/v1/*` is a
**blanket proxy with no RPC allowlist** (`services/gateway/src/routes/rest.ts`) →
`buildPostgrestClaims()` hardcodes `role: 'authenticated'` for **every** valid Keycloak token
(`services/gateway/src/auth/postgrest-jwt.ts:53-64`). No `FORCE ROW LEVEL SECURITY` exists
anywhere in the repo, so a SECURITY DEFINER owned by the table owner **bypasses RLS entirely**.
The only "guard" is `useAdminGuard.guardAdminMutation` — **client-side React, enforces nothing**.

```
POST /rest/v1/rpc/award_tokens
{"p_user_id":"<attacker-uuid>","p_token_type":"governance","p_amount":100000000}
```

1. **Unlimited self-mint** of governance tokens = unlimited voting weight (`cast_governance_vote`
   derives weight from `tokens_governance`).
2. **Victim balance drain**: `v_new_balance := v_current_balance + p_amount` with no sign check —
   a NEGATIVE `p_amount` against a victim's uuid drains them and writes a forged `reward` row to
   their `token_transactions` ledger.
3. **Membership fabrication**: if the uuid has no membership row the function silently INSERTs one
   (`tier='basic', status='active'`), with no FK-validated existence check.

## Measured surface (signature-scoped, positional grants, PUBLIC-default aware)

| Metric | Count |
|---|---|
| whole-file `p_user_id` hits (today's rule-5 surface) | 436 |
| **p_user_id in the CREATE FUNCTION signature** | **88** |
| structurally unreachable by `authenticated` (REVOKE ALL FROM PUBLIC, no authenticated/anon grant) | 11 |
| reachable by `authenticated` | 77 |
| — of those, guarded (auth.uid↔p_user_id relation, or admin gate + RAISE) | 26 |
| — **reachable AND unguarded → must be fixed** | **51** |
| confirmed findings (audited + refuted) | 25 (11 critical / 9 high / 5 medium) |

The 25 findings cover 24 of the 51; the remainder includes ~9 `is_*`/`has_*`/`check_*` helper
predicates that the old gate excluded **by filename prefix** — an allowlist-by-convention.
`has_role('<victim>','admin')` from `authenticated` is a real (low-severity) info leak.

## Fix batches

### BATCH 1 — CRITICAL: ledger + audit forgery (REVOKE path; a guard CANNOT fix these)
`award_tokens`, `process_token_reward`, `write_audit_journal`, `record_audit_log`

Self-service **is** the exploit (self-minting, self-attributed audit), so
`p_user_id <> auth.uid()` does not help. Each needs:
`REVOKE ALL ON FUNCTION … FROM PUBLIC; GRANT EXECUTE ON FUNCTION … TO service_role;`
plus a defence-in-depth `IF NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'Unauthorized' USING errcode='42501'; END IF;` as the FIRST body statement.

- `award_tokens` ALSO needs `IF p_amount <= 0 THEN RAISE …` (the negative-amount drain is a
  separate bug) and a **companion admin-guarded wrapper RPC in the same PR** — otherwise
  `src/hooks/useTokens.ts:232` (the admin token-award UI) dies.
- `write_audit_journal` MUST be revoked in the **same commit** as `record_audit_log`, or the
  record_audit_log fix is bypassed by calling the inner primitive directly.
- SECURITY DEFINER SQL callers (`award_leaderboard_rewards`, `confirm_product_taken_audited`,
  `log_health_state_audited`, `submit_health_document_analysis_audited`, `process_token_reward`)
  execute as the owner → unaffected by the REVOKE.

### BATCH 2 — CRITICAL: metering + agent memory (REVOKE; service-role callers verified)
`fn_check_and_consume_llm_quota_audited`, `fn_check_and_consume_ai_budget_audited`,
`mcp_get_agent_memories`, `mcp_summarize_agent_memories`, `fn_search_agent_memories`

Canonical guard — **the disjunct order is load-bearing**:
```sql
IF NOT public.is_service_role()
   AND (auth.uid() IS NULL
        OR (p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_or_staff()))
THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
```
`auth.uid() IS NULL OR` must come **first** and `IS DISTINCT FROM` must replace `<>` — otherwise
NULL folds the predicate to SQL NULL, the IF never fires, and the guard **fails open**.

- `fn_check_and_consume_ai_budget_audited` also needs a `p_story_id` ownership check.
- The `mcp_*` trio's real hole is the **NULL-means-all-users wildcard**; resolve the target first
  (`v_target := COALESCE(p_user_id, auth.uid())`, raise if NULL, raise if not self and not admin),
  then make every predicate `am.user_id = v_target` unconditionally. Fix all three together.

### BATCH 3 — CRITICAL: trigger-only surface (REVOKE; zero authenticated callers)
`add_system_timeline_entry`, `create_notification` — delete the *"grant to authenticated for
testing"* comment; tests move to a service_role connection.

### BATCH 4 — HIGH: personality chain (MIXED — do NOT blanket-revoke)
- `fn_capture_personality_signal` → **GUARD ONLY**. `src/components/storyloop/OccipitumDesignPanel.tsx:255`
  calls it from the browser with an end-user JWT **inside `try/catch → safeError`**, so a REVOKE
  breaks design-signal capture **silently**. Also constrain `p_signal_type` — free text reaches an
  LLM prompt via `fn_maybe_evolve_personality → buildPersonalityPrompt` (prompt-injection cut).
- `fn_maybe_evolve_personality`, `fn_aggregate_personality_signals`, `fn_search_personality_context`
  → REVOKE (callers verified service-role in `hippocampus.ts`).

## Traps found while planning (each corrected a proposed fix)

1. **`REVOKE … FROM authenticated` alone is not enough** — PostgreSQL grants EXECUTE to **PUBLIC by
   default**. Every revoke must be `REVOKE ALL ON FUNCTION … FROM PUBLIC` + explicit
   `GRANT … TO service_role`. Five files already contain both a REVOKE-from-authenticated and a
   later GRANT-to-authenticated — **the last statement wins**, so any gate must replay grants
   **positionally**, not by presence.
2. **`service_role` is NOINHERIT** (`infra/postgres/000_init_roles_schemas.sql:35`) despite
   `GRANT authenticated TO service_role` at :86 — it does *not* inherit, membership only permits
   SET ROLE. Good: a REVOKE-from-authenticated does not strip service_role **provided it holds its
   own explicit grant**. Bad: a function granted *only* to authenticated is **not** callable by a
   service_role request — `fn_search_personality_context` is exactly that shape.
3. **`public.raise_unauthorized()` does not exist** — a proposed inline-SQL fix for
   `can_access_admin_section` would not compile. It and `user_has_admin_role` are `LANGUAGE sql`,
   so the IF/RAISE guard needs a plpgsql conversion.

## HOW TO READ THIS DOCUMENT

Three claims in here were wrong, and all three were caught only by executing something rather than
reasoning about it: a severity call ("bounded by cooldowns"), a reachability call ("the feature is
dead, and its deadness is the control"), and a whole bug class (trap #6's fail-open `role` GUC).
The pattern is identical each time — **a plausible chain of reasoning about SQL semantics, never run
against a database.** Two were corrected by reading the seed data; one by 40 seconds in `psql`.

So: **every unproven claim below is suspect until executed.** Where a statement is backed by a
measurement, the measurement is shown. Where it is not, treat it as a hypothesis.

## CORRECTION (2026-07-15, after PR-A) — a severity call in this document was WRONG

`process_token_reward`'s unverified `p_action_type` was scoped out of PR-A as "reward abuse rather than
unlimited minting, bounded by the per-rule `can_receive_reward` cooldown". **That is false**, and the
error was an assumption never checked against the code:

- Every limit in `can_receive_reward` is `IF v_rule.<limit> IS NOT NULL THEN ... END IF`. A rule with
  `cooldown_hours`, `daily_limit`, `weekly_limit` and `monthly_limit` all NULL skips **every** check and
  returns `can_receive: true` unconditionally. There is no default bound.
- **8 of the 12 seeded rules** (`aisha/db/seed/core/06_subscriptions.sql`) are exactly that shape:
  `weekly_streak`, `monthly_streak`, `study_registration`, **`study_completion` (100 tokens)**,
  `referral`, `consent_granted`, **`placebo_compensation` (50)**, `lab_result_upload`. Repeatable in a loop.

So this is a **CRITICAL unlimited self-mint**, the same severity class as `award_tokens` — not a bounded
abuse. It belonged in PR-A on severity; it was excluded on a bad premise.

**Why it is not exploitable today — and why that is not a control.** All 12 seeded rules carry
`token_type='PLATFORM'`, while `award_tokens` raises on any token_type outside
`('governance','impact','data','aisha')`. Every reward therefore dies at the `award_tokens` call: the
feature is **DEAD**, and its deadness is the only thing standing between a logged-in user and unlimited
tokens. A single well-meaning edit that "fixes" the token_type — making rewards work — silently arms the
mint. That trap is now recorded in the function header so the next person meets it before the DB does.

Lesson for the rest of this audit: **a bound that is written as `IF <config> IS NOT NULL` is not a bound**,
it is a bound *if someone configured one*. Do not describe such a check as a mitigation without reading the
data. Any other "bounded by …" claim in this document is suspect until verified the same way.

## Traps found while IMPLEMENTING (PR-A) — each corrected a fix that had already been written

4. **A JWT guard inside `award_tokens` would have broken 3 legitimate flows.** The plan asserted
   that the in-DB SECURITY DEFINER callers "execute as the OWNER and are unaffected by the
   revoke". True of the **GRANT** — the owner keeps EXECUTE by ownership — but *not* of a
   **guard**: `SECURITY DEFINER` swaps `current_user`, it does **not** swap the JWT claims, which
   live in the `request.jwt.claims` GUC. So `is_service_role()`/`is_admin_or_staff()` inside
   `award_tokens` still read the ORIGINAL caller's claims and would reject
   `log_health_state_audited`, `confirm_product_taken_audited` and
   `submit_health_document_analysis_audited`, all of which mint for an ordinary user after
   verifying ownership. **The grant and the guard are different tools and are not interchangeable.**
   `award_tokens` therefore ships with the REVOKE and *no* JWT guard; each caller authorizes its
   own recipient (verified: 4 of 5 already did — only `process_token_reward` did not, which is
   precisely where the bug was).
5. **Two gates demanded the `authenticated` GRANT that was assumed to be the defect.**
   `wp-2-3-llm-quota.gate.test.ts` and `ai-budget.gate.test.ts` both assert
   `GRANT EXECUTE … TO authenticated` on the quota RPCs: WP 2.3's design is that an end user gates
   their OWN quota per JWT.sub. An over-eager revoke was caught by the gates and reverted. The
   grant was never the defect — **a grant without an ownership check is.** Fixed with the pin, not
   the revoke.
6. ~~**Both quota guards FAILED OPEN**~~ — **THIS TRAP WAS ITSELF WRONG. See the correction below.**
   The claim was that `IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role'`
   folds to NULL and never fires. It does not. Measured on PostgreSQL 17:

   | expression, no request context | result |
   |---|---|
   | `current_setting('role', true)` | **`'none'` — never NULL** |
   | `current_setting('request.jwt.claims', true)` | `NULL` |
   | the guard above, evaluated | **RAISE fires — fail-CLOSED** |
   | `SET notabuiltin = '1'` | `ERROR: unrecognized configuration parameter` |

   `role` is a **built-in** GUC. `missing_ok := true` returns NULL only for GUCs that do not
   *exist*, and PostgreSQL rejects undotted custom GUCs entirely — so **no dot ⇒ built-in ⇒ never
   NULL** is a language guarantee, not a convention. The guards were correct.

   `is_service_role.sql`'s header is not wrong: it describes the **dotted** idiom
   `(current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'`, which really
   does fold to NULL. Trap #6 conflated that with the plain `role` GUC and inherited the conclusion.

   **The real population is exactly the dotted JWT GUCs** — `request.jwt.claims` and
   `request.jwt.claim.role`: measured 125 files / 127 sites (41 negative `!=`/`<>` — fail-open in a
   deny-guard; 78 positive `=` — fail-closed unless wrapped in `NOT`; 5 `IS DISTINCT FROM` — safe;
   3 value reads). The plain `role` GUC accounts for a further 88 files / 92 sites which are
   **correct and must not be touched**: acting on trap #6 as written would have churned all 88 for
   zero security gain.

   **What shipped is still right.** PR-A replaced those two guards with `is_service_role()` plus a
   `p_user_id` pin. The pin is the actual IDOR fix and is unaffected; `is_service_role()` is
   equivalent-or-broader (it also honours `SET ROLE service_role`). Only the stated justification
   was false, and it is corrected here rather than quietly dropped.
7. **`security-hardened-helpers.gate.test.ts` already knew about two of the findings.** It listed
   `create_notification` and `add_system_timeline_entry` in `MUST_BE_INTERNAL_ONLY`, computed the
   violations correctly, and then had `// expect(violations).toHaveLength(0);` commented out
   behind a "Phase 2" that never landed — reporting a live vulnerability as a `console.warn` while
   the suite stayed green. Enabled in PR-A and verified to bite.
8. **`KNOWN_NO_AUTH_FUNCTIONS` is not decorative.** It filters a hard
   `expect(newNoAuth.length).toBe(0)` in `security.gate.test.ts` via `isKnownNoAuthFunction()`.
   That is how the `award_tokens` mint stayed invisible. Removing the three PR-A entries was
   verified green rather than assumed.

## Gate rewrite (LAST — cannot land with the fixes)

The 25 findings cover 24 of the 51 unguarded functions; **the rest would hard-fail the rewritten
gate**. So: fix all 51 first, flip the gate last.

Rewrite `idor-prevention.gate.test.ts` rule 5 with four changes:
1. **Paren-matched signature extraction** (a lazy `\(([^)]*)\)` truncates on
   `p_user_id uuid DEFAULT auth.uid()` and silently under-reports). An unparseable signature must
   **fail the gate**, never `continue` — a silent skip is how the next IDOR walks through.
2. **Positional, PUBLIC-aware grant replay** as the structural distinguisher (replaces the
   filename-prefix and `KNOWN_NO_AUTH_FUNCTIONS` allowlists).
3. **Structural recognizers, not allowlists** — service_role-only reachability is a *proven*
   property, not a maintained list.
4. **`console.warn` → `expect(violations).toEqual([])`** — gate-is-the-spec.

Delete the `award_tokens` entry from `KNOWN_NO_AUTH_FUNCTIONS` in the same change.
