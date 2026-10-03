# Audience grant model — systemic security

How the audience module guarantees least-privilege grants, and why it can't
silently regress. Four layers: **specification → detection → enforcement →
prevention**. The same shape as the seam contract (declare intent + audit drift).

## The hole this closes

Postgres grants `EXECUTE` on every function to `PUBLIC` by default. The audience
`audience_*` functions are `SECURITY DEFINER` owned by `postgres` (superuser), so
the default meant the unauthenticated `anon` role PostgREST uses could invoke
them with **full RLS bypass** — including write functions
(`audience_tag_resource`, `audience_route_campaign_to_openclaw`,
`audience_upsert_user_engagement`, …). A single forgotten `REVOKE` reopens it.

## Layer 1 — Specification (the invariants)

Declared once, version-controlled, as queryable assertions in
`audience_audit_grants()` (migration `20260524150000`):

| # | Invariant | Severity |
|---|---|---|
| I1 | PUBLIC must NOT have EXECUTE on any `audience_*` function (incl. `proacl IS NULL` = the Postgres default) | CRITICAL |
| I2 | `anon` must NOT have EXECUTE on any `audience_*` function | CRITICAL |
| I3 | `anon` must NOT have SELECT on any `audience_*` / `cohorts*` relation | CRITICAL |
| I4 | Broker-only write fns must NOT be EXECUTE-able by `authenticated` | HIGH |
| I5 | `service_role` MUST have EXECUTE on every `audience_*` function (no under-grant) | MEDIUM |
| I6 | `svc_source_broker_writer` MUST have EXECUTE on broker-write fns | MEDIUM |

I1 is the **categorical guard**: it flags `proacl IS NULL` (the default that
caused the original hole), so it catches ANY future function that forgets its
`REVOKE` — not just the ones known today.

## Layer 2 — Detection (the auditor)

`audience_audit_grants()` returns one row per violation with a ready-to-run
`fix_sql`. Run it:

```bash
make aisha-audit-grants        # report (exit 8 on CRITICAL/HIGH)
make aisha-audit-grants-fix    # print the REVOKE/GRANT remediation
```

The function is itself locked down (service_role only — it reveals the grant
model). Self-test: create a `SECURITY DEFINER` function without a REVOKE and the
auditor immediately reports I1 + I2.

## Layer 3 — Enforcement (CI + smoke gate)

- **CI** (`.github/workflows/audience-tests.yml`, `migration-syntax` job):
  spins up postgres, creates the four roles, applies ALL audience migrations,
  then runs the auditor and **fails the build** on any CRITICAL/HIGH violation.
  Because the auditor runs LAST (after every migration), it catches a new
  function added in any future migration that forgot its REVOKE — regardless of
  migration order.
- **Smoke** (`make aisha-integration-smoke`, step 5b): runs the auditor against
  the live DB; CRITICAL/HIGH fails the smoke.

## Layer 4 — Prevention (DB-enforced, applied)

The footgun is removed at the database level by an **event trigger** (migration
`20260524160000`): `audience_autorevoke_trg` fires after every CREATE/ALTER
FUNCTION and strips PUBLIC + anon EXECUTE from any new `public.audience_*`
function — the instant it is created.

```sql
CREATE EVENT TRIGGER audience_autorevoke_trg
  ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION','ALTER FUNCTION')
  EXECUTE FUNCTION public.audience_autorevoke_public_execute();
```

This is the **definitive "once and for all"** fix and it can't be forgotten: a
future migration that omits its REVOKE is corrected by the database itself.
Crucially it is **scoped to `audience_*`** — zero blast radius on other teams'
functions in `public`. Explicit intended grants (service_role, broker writer)
survive; only PUBLIC/anon are stripped.

Verified live: `CREATE FUNCTION public.audience_x() … SECURITY DEFINER` (no
REVOKE) → trigger fires → anon EXECUTE = false, auditor stays clean.

**Platform-wide alternative** (not applied — broad blast radius): 
`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON
FUNCTIONS FROM PUBLIC` removes the default for ALL functions in `public`, not
just audience. Prefer it only if this fork owns the whole DB; the scoped event
trigger is the safer default.

## Grant policy (who may EXECUTE what)

| Role | EXECUTE on |
|---|---|
| `service_role` | ALL audience functions (trusted admin bypass) |
| `authenticated` | marketer/admin RPCs only (gated further by internal `is_admin_or_staff` + RLS) |
| `svc_source_broker_writer` | broker-write fns (`upsert_user_engagement`, `process_signal_audited`, `broker_record_sync`) |
| `anon` / `PUBLIC` | **nothing** |

Broker-only writes are deliberately NOT granted to `authenticated`: a logged-in
marketer must not write engagement/sync state directly — only the broker may.

## Adding a new audience function (the checklist)

1. Create the function (`SECURITY DEFINER` + `SET search_path` per the aisha-rpc
   pattern).
2. In the SAME migration: `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC;` and
   `GRANT EXECUTE … TO` the intended roles (service_role always; authenticated
   if marketer-facing; broker writer if broker-only).
3. If it's a broker-only write, add its name to `v_broker_only` in
   `audience_audit_grants()` so I4/I6 cover it.
4. CI + `make aisha-audit-grants` confirm you didn't miss step 2.
