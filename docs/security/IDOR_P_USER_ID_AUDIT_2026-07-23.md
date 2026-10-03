# IDOR audit — caller-controlled `p_user_id` (2026-07-23)

Follow-up to `IDOR_P_USER_ID_AUDIT_2026-07-15.md`. That pass fixed `award_tokens`
and `fn_search_agent_memories`; the `idor-prevention` gate's `p_user_id` check was
left **advisory** (`console.warn`, no `expect`) because its heuristic was noisy.
This pass makes the check **enforcing and precise**, and fixes every real finding.

## Threat model

`SECURITY DEFINER` runs as the owner and **bypasses RLS**. A function `GRANT`ed to
the `authenticated` role is callable via PostgREST (`/rest/v1/rpc/<fn>`) by any
logged-in user, who fully controls the `p_user_id` argument. If the body then
reads or writes the row(s) for that `p_user_id` without verifying the caller is
that user (or admin / service / an explicit consent-relationship), user A acts on
user B's data by passing B's id → **IDOR**.

## Triage (why "160 warnings" was misleading)

| bucket | count | meaning |
|---|---|---|
| `p_user_id` + `SECURITY DEFINER` (raw gate hits) | 441 | text mentions `p_user_id` |
| **body-only** (`v_user_id := auth.uid(); … p_user_id => v_user_id`) | 352 | NOT a caller-controlled param — **false positive** |
| signature param + already guarded / `DEFAULT auth.uid()` | 39 | safe |
| **real candidates** (caller-controlled param, no guard) | 50 | — |
| …of which **granted to `authenticated`** | 35 | the actual attack surface |

The 35 were analysed one-by-one with an adversarial second pass (each verdict had
to survive a refutation attempt).

## Confirmed IDOR (13) — fixed

**Revoke (backend-only; self-minting or trigger-only — a self-check can't help):**

| function | sev | fix |
|---|---|---|
| `create_token_transaction` | 🔴 high | REVOKE from `authenticated` → `service_role`. Self-minting is the exploit (any user could `POST rpc {p_amount: 1e8}` to credit their own wallet). Matches the 2026-07-15 `award_tokens` remediation; the only frontend caller (`useTokens.logTransaction`) is exercised solely by mocked tests. |
| `save_proactive_run` | 🟠 med | REVOKE → `service_role` (svc-ai-chat uses a service_role client; no product caller). |
| `update_user_streak` | 🟠 med | REVOKE from `authenticated`. The three `trigger_update_streak_*` callers are `SECURITY DEFINER` (PERFORM) and unaffected. |
| `update_user_leaderboard_entry` | 🟡 low | REVOKE. `trigger_update_leaderboard()` (definer) still works; no self-check — the trigger legitimately updates arbitrary users. |
| `get_partner_access_for_edge` | 🟡 low | REVOKE (edge caller uses service_role). |

**Guard (self / service / admin) inserted right after the auth check:**

`fn_aggregate_personality_signals`, `fn_capture_personality_signal`,
`fn_maybe_evolve_personality`, `fn_search_personality_context`,
`mcp_store_agent_memory`, `get_chat_access_level`, `get_partner_type`,
`save_chat_message_audited` — each now:
`IF p_user_id <> auth.uid() AND NOT public.is_service_role() AND NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;`
(personality read/write of another user's profile; chat access level; partner
classification; audit-actor forgery on saved messages). `save_chat_message_audited`
keeps the trusted service-role attribution path.

## Not IDOR (verified safe — no allowlist, safety derived from each body)

- **By-design consent / relationship** (act on another user *through* an explicit
  gate): `audience_cohort_register_actor` (`get_jwt_role()='service_role'` +
  `can_invite_to_study()`), `audience_derive_actor_tier`
  (`audience_user_can_see_creator_stats()`), `get_client_onboarding_details` /
  `request_data_sharing_consent` (`assigned_partner_id = auth.uid()` +
  `has_data_sharing_consent()`, RAISE 'Access denied'), `partner_relinquish_data_access`.
- **Boolean predicates** (leak ≤ 1 bit): `user_can_chat`, and the `is_/has_/check_/can_` helpers.
- **Role-gated / auth-first** (honour `p_user_id` only for service/admin):
  `create_wearable_analysis_file_reference` (`v_role='service_role'`),
  `fn_get_llm_quota_status`, `fn_upsert_agent_live_session` (`v_is_service`),
  `join_intranet_channel` (`COALESCE(auth.uid(), p_user_id)`), `get_consent_status`
  / `get_user_escalations` (`auth.uid() != p_user_id` raise).

## Gate change (`src/tests/gates/idor-prevention.gate.test.ts`)

The `p_user_id` check is now **enforcing** (`expect(...).toEqual([])`) and precise —
and carries **no name allowlist**. It flags a function only when ALL hold:
`SECURITY DEFINER` · `p_user_id` is a **signature parameter** (not an internal var)
· **granted to `authenticated`** · not a boolean/trigger predicate · **no guard**.
"Guarded" is derived from the body: a `p_user_id (=|<>|!=|IS DISTINCT FROM) auth.uid()`
comparison (incl. via a local holding `auth.uid()`), `COALESCE(auth.uid(), …)`,
`is_service_role`/`is_admin_or_staff`/`has_role`, a `service_role` role check, a
consent/assignment gate (`has_data_sharing_consent` / `assigned_partner_id`), or an
authorization `RAISE` (`Access denied`/`Unauthorized`/`Forbidden`/`42501`). Re-granting
a fixed function to `authenticated`, or dropping its guard, now fails the build.

## Interaction with the `security-hardened-helpers` gate (auth-first COALESCE)

A *second*, pre-existing gate (`security-hardened-helpers.gate.test.ts`) enforces a
different invariant on the same functions: any `SECURITY DEFINER` function with a
`p_user_id uuid` parameter must use **`COALESCE(auth.uid(), p_user_id)`** (JWT wins),
never the parameter-first **`COALESCE(p_user_id, auth.uid())`** (caller wins = probe
surface). The two gates look at the same surface from opposite ends: this audit's gate
wants a *guard*; that gate wants the *auth-first COALESCE order*. Static analysis can't
see that a guard immediately after a parameter-first COALESCE already closes the hole —
it only sees the text pattern. So two of the fixes were written to satisfy **both**:

- `fn_aggregate_personality_signals` — dropped the redundant
  `p_user_id := COALESCE(p_user_id, auth.uid())` default and kept the `RAISE`
  guard alone, matching its three sibling `fn_*_personality_*` functions (guard, no
  COALESCE). Same protection, no parameter-first text.
- `save_chat_message_audited` — the service-role branch now reads `p_user_id`
  directly (`CASE WHEN is_service_role() THEN p_user_id ELSE auth.uid() END`) instead
  of `COALESCE(p_user_id, auth.uid())`. Identical result (for `service_role`,
  `auth.uid()` is `NULL`, so the COALESCE was already just `p_user_id`), and it is in
  fact *more* correct: it honours the Edge-Function-supplied id rather than a stray
  token `sub`.

### Two functions this audit touches remain on that gate's Phase-2 allowlist — on purpose

`security-hardened-helpers.gate.test.ts` carries a pre-existing
`KNOWN_PARAM_FIRST_FUNCTIONS` set of 12 grandfathered functions (a separate hardening
track, **not** created or extended here). Two of them are edited by this PR:

- `create_token_transaction` — still `COALESCE(p_user_id, auth.uid())` in the body, but
  this PR **REVOKEs it to `service_role` only**, so the parameter-first order is now
  moot (only the trusted role reaches it, and it legitimately targets an arbitrary
  user). A follow-up may swap it to auth-first and drop it from the list; behaviour is
  preserved either way.
- `get_partner_type` — `COALESCE(p_user_id, auth.uid())` here is **by design**: the
  function is meant to return another user's partner classification *when that profile
  is public*, gated by the row filter this PR added
  (`is_visible = true OR user_id = auth.uid() OR is_admin_or_staff()`). Forcing
  auth-first would break visible-partner lookups. This is the same "by-design consent /
  visibility" category listed above under *Not IDOR* — it is a legitimate exception,
  not a deferred fix, and the honest resolution is to teach that gate to recognise the
  row-filter guard (so no name allowlist is needed), tracked as follow-up work.

Neither is a silent allowlisting by this audit: the first is neutralised by the revoke,
the second is a genuine visibility-gated lookup. The pre-existing 12-entry allowlist is
left untouched (no entries added), and eliminating it belongs to the separate auth-first
hardening effort, not this IDOR pass.
