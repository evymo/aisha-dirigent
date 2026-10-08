# Development Guardrails (Sensitive Data / Security)

Version: 1.0 | Date: 2025-12-20
Classification: Internal

Purpose: Define non-negotiable boundaries for production work. This is not a task list.

## Scope

- Production code only. No mockups, no placeholders, no "temporary" shortcuts.
- All data flows, validations, and access patterns must be real and auditable.

## Non-negotiables

- sensitive data access is RPC-only with audited functions.
- No sensitive data in logs, errors, analytics payloads, or UI messages.
- No `.select("*")`. Always request explicit columns.
- All user-facing text must go through i18n.
- Tests and build must pass before push.

## Data access and audit

Do:
- Use `supabase.rpc()` for all sensitive data access.
- Use audited RPC functions with explicit columns.
- Enforce minimum-necessary data in every response.
- Validate inputs before RPC and validate outputs after RPC.

Do not:
- Use `supabase.from()` on restricted tables.
- Use `.select("*")` or overfetching.
- Build SQL in the client or bypass audit logging.

## Permissions and authorization

Do:
- Use `usePermissions()` or dynamic permission checks.
- Treat RLS as the primary enforcement layer.
- Verify consent and access rights inside RPC functions.

Do not:
- Hardcode role checks (e.g., `userRole === "admin"`).
- Rely on client-only checks for sensitive-data.

## Types and Zod validation

Do:
- Keep TypeScript types aligned with real RPC output.
- Validate both input and output with Zod.
- Use strict type guards without `any`.

Do not:
- Introduce `any` or unvalidated `unknown`.
- Assume nullable fields are always present.

## Logging and errors

Do:
- Use `safeError` for logging.
- Surface user-friendly errors via i18n.
- Keep logs free of sensitive data and sensitive identifiers.

Do not:
- Log email, name, sensitive data, or raw error payloads.
- Include sensitive data in error messages or analytics events.

## Database, RLS, and migrations

Do:
- Ensure RLS is enabled for every sensitive data table.
- Define RLS policies for SELECT/INSERT/UPDATE/DELETE.
- Use `_audited` RPC functions with authorization and audit insert.
- Apply schema changes only via `supabase/migrations/`.

Do not:
- Bypass RLS in application logic.
- Modify schema manually in production.

## UI and i18n

Do:
- Route all user-facing strings through i18n.
- Keep UI aligned with real data and permissions.

Do not:
- Ship placeholder copy or mock UI in production.

## Testing and release discipline

Do:
- Run `npm run test:run` and `npm run build` before push.
- Align mocks with real implementations (RPC, not `.from()`).
- Prefer robust assertions over fragile call counts.

Do not:
- Skip tests or accept failing tests.
- Depend on `toHaveBeenCalledTimes(1)` for behavior correctness.

## Stop-and-ask rule

If a change touches citlivými daty, auth, permissions, or DB functions and you are not 100% sure it is safe, stop and ask before committing.

## Engineering principles — no workarounds, no regressions

**The gate is the spec.** When a gate or test fails, the failure is a signal that the code is wrong, not that the gate is wrong. The fix is to make the code conform.

Do not:
- Lower a gate threshold (e.g. `expect(skills.length).toBeGreaterThan(5)` → `>(4)`) to make a failure go away.
- Regenerate a baseline file (`*-baseline.json`) to mask a new offender. Fix the code that introduced the offender.
- Comment out or `.skip` a failing test.
- Delete the feature/file that triggers a gate failure. If the underlying concept is still needed (it usually is), the right path is to rewrite it for the current stack.
- Wrap a failing call in a `try {} catch {}` that swallows the error. `silent-degradation.gate` exists for exactly this reason — every catch must record the failure (debug log, audit, retry).

Do:
- Treat every gate failure as a discovery surface. The gate has already done the hard work of telling you what the canonical pattern is; align the code to it.
- Rewrite obsoleted patterns for the current stack rather than removing them. Examples:
  - Supabase Deno edge functions → Fastify route in `services/svc-*/src/routes/*.ts` (see `.claude/skills/aisha-edge-fn/SKILL.md`)
  - Supabase Realtime → PostgREST + WebSocket via `services/ws-gateway`
  - `supabase.rpc()` → `rpcService<T>()` / `rpcUser<T>()` (canonical helper: `services/svc-ai-chat/src/lib/rpcAdapter.ts`)
- When in doubt, stop and ask the operator before lowering anything. A 30-second clarification is cheaper than a 30-minute reversal.

**Why this matters at platform level**: AISHA's gate suite is the platform's behavioural DNA (137 gate files × 2438 actively-actionable tests as of 2026-05-17). The whole governance model assumes gates ratchet UP toward 100%, never DOWN. A single workaround poisons that contract — every future regression cites the precedent.

**For Aisha (autonomous loops)**: this principle is reinforced via `decision_provenance` chains in `audit_journal`. A proposal whose `decision_provenance` shows a `fallback` rule overriding a `compliance_policy` or `ruleset_snapshot` rule must include explicit `override_justification` from a human operator. Aisha never self-authorizes a workaround.

## References

- docs/ARCHITECTURE.md
- docs/DEVELOPMENT_GUIDELINES.md
- docs/security/SECURITY.md
- docs/security/RLS_POLICY_DOCUMENTATION.md
- CONTRIBUTING.md
- `.claude/skills/aisha-edge-fn/SKILL.md` — rewrite-for-current-stack example (Fastify route, not Supabase Deno)
- `src/tests/gates/silent-degradation.gate.test.ts` — enforces "every catch is recoverable"
- `src/tests/gates/aisha-branding.gate.test.ts` — monotone-decreasing baseline (fix code, never regen)
