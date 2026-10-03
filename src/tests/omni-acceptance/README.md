# AISHA Omni — Acceptance Suite (executable spec / definition-of-done)

This suite **is the specification, executable**. It encodes every testable
contract in [`docs/planning/AISHA_OMNI_GATEWAY.md`](../../../docs/planning/AISHA_OMNI_GATEWAY.md)
(v4, §0–§20) as unit + integration + e2e + pgTAP tests, with **positive,
negative, and false-positive** cases. When the whole suite is GREEN, the Omni
implementation fulfils the spec.

## Run

```bash
bash runtests.omni-acceptance.sh          # vitest acceptance (unit+integration)
E2E=1  bash runtests.omni-acceptance.sh   # + Playwright e2e/omni
PGTAP=1 bash runtests.omni-acceptance.sh  # + pgTAP omni (needs a DB)
ALL=1  bash runtests.omni-acceptance.sh   # everything

# or directly:
OMNI_ACCEPTANCE=1 npx vitest run --config vitest.omni-acceptance.config.ts
```

## Isolation (never breaks normal CI)

- Unit/integration tests live here (`src/tests/omni-acceptance/**/*.omni.spec.ts`)
  and are run **only** by `vitest.omni-acceptance.config.ts`. The default
  `vitest.config.ts` **excludes** this path.
- `e2e/omni/*.spec.ts` self-skip unless `OMNI_ACCEPTANCE=1`.
- `aisha/db/tests/schema/omni/*.sql` run only in acceptance mode.

## Live vs Skip (read this before "fixing" a red test)

- **LIVE** — the surface exists today. Some of these are **intentionally RED**:
  they prove a current bug documented in the spec and act as **regression
  guards** that flip GREEN when the fix lands. Examples (RED today):
  - `story-resolver-hole` — `get_chat_context_story_id` cross-tenant leak +
    arbitrary-active fallback (§19.1).
  - `streaming-routing/tier-never-branches-execution` — complexity tier never
    branches `/chat` execution (§6.5 / §20 P0 #6).
  - `governance-residency` — gate runs *after* model selection; `allow_local`
    boosts but does not exclude cloud (§11 / §20 #9).
  - `router-consolidation` — `evaluate.ts` + `story-consult.ts` still import the
    kebab `llm-router.ts` (§7).
  - `quota-admission/preflight` — no pre-dispatch quota gate in `chat.ts`
    (ledger #14).
- **SKIP-UNTIL-IMPL** (`describe.skip` / `it.todo`) — the surface does **not**
  exist yet (`/v1/chat/completions`, `/v1/messages`, broadcast triggers, PAT
  story binding, `detectDataSensitivity`). Each carries the exact contract it
  must satisfy. They **never top-level import a non-existent module** (dynamic
  import inside the un-skipped block when implemented), so the suite always
  type-checks.

## Turn red → green (the §20 order)

1. Router consolidation (`router-consolidation`) — migrate `evaluate.ts` +
   `story-consult.ts` to `llmRouter.ts`, delete kebab.
2. Streaming-primitive inversion (`streaming-routing`).
3. PAT story/tenant binding (`pat-tenancy`, `story-resolver-hole`).
4. Story-resolver ownership fix (`story-resolver-hole`).
5. Wire complexity routing into `/chat` (`streaming-routing/tier-never-branches`).
6. `/v1` ingress + broadcast factory + governance gate + quota admission
   (`protocol-statefulness-errors`, `broadcast-realtime`, `governance-residency`,
   `quota-admission`, `discovery-base-instance`).
7. No-regression of existing surfaces (`regression-coherence`).

## Layout

```
src/tests/omni-acceptance/
  streaming-routing/          tier routing, SSE-vs-202, stream contract
  pat-tenancy/                PAT validation + multi-tenant isolation
  story-resolver-hole/        cross-tenant story leak (LIVE-RED) + shared resolver
  governance-residency/       confidential → no-cloud (false-positive guard)
  quota-admission/            pre-flight 402 + mid-stream + concurrency cap
  broadcast-realtime/         pg_notify factory/triggers + push + schema evolution
  router-consolidation/       camel/kebab parity + kebab-import lint guard
  discovery-base-instance/    env-driven model availability + registry RLS
  protocol-statefulness-errors/  OpenAI+Anthropic, conversation_id, error mapping
  regression-coherence/       one engine, public-chat out of governance, tier1/2
e2e/omni/                     wire-level (Playwright, gated by OMNI_ACCEPTANCE)
aisha/db/tests/schema/omni/   pgTAP (columns/triggers/RLS), acceptance mode
```

> Note: a few helpers are currently inlined per spec (the shared `_helpers`
> scaffold was lost to an API failure during generation). De-duplicating them
> into `_helpers/` is a safe follow-up; it does not change any assertion.
