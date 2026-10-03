# LLM Gateway Dispatch — Architecture Invariants

> Lock-in for the resolver → executor wiring. Tests in
> `src/tests/gates/llm-gateway-{dispatch,resolver-contract}.gate.test.ts` and
> `services/svc-ai-chat/src/tests/reflection/clow-backend-dispatch.unit.test.ts`
> enforce these invariants — drift fails the build.

## Architecture goal

AISHA decides **what** model to use and **how** to reach it. The resolver
(`aisha_resolve_clow_backend`) is the single decision-making authority. The
executor (`generator` node + `llmRouter`) must honor that decision faithfully.

Currently this wire is **broken**: resolver runs, sets `state.clow_backend`,
but `generator.ts` ignores it and uses static prefix-matching in
`resolveProvider()`. The test suite locks in the correct contract.

## Decision flow (target state)

```
┌───────────────────────────────────────────────────────────────────┐
│ 1) workflow input: clow descriptor (purpose, constraints, budget) │
└──────────────────────────┬────────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────────┐
│ 2) openclaw_resolve_clow node                                     │
│    → calls aisha_resolve_clow_backend(p_clow, p_context)          │
│    → state.clow_backend = {                                       │
│        provider_slug, model_id, backend_kind,                     │
│        endpoint_url, auth_env_var, strategy                       │
│      }                                                            │
└──────────────────────────┬────────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────────┐
│ 3) generator node — MUST honor clow_backend                       │
│    if state.clow_backend exists:                                  │
│        dispatch via clow_backend.backend_kind                     │
│             llm_gateway   → gateway URL + AISHA_LLM_GATEWAY_KEY   │
│             direct_cloud  → provider's direct endpoint            │
│             local_ollama  → http://ollama:11434                   │
│             local_vllm    → http://vllm:8000                      │
│    else:                                                          │
│        fallback: resolveSlotModel(slot, profile) → prefix-match   │
└───────────────────────────────────────────────────────────────────┘
```

## Provider catalog (single source of truth)

`ai_provider_registry` rows currently include:

| slug | backend_kind | endpoint_url | auth_env_var |
|---|---|---|---|
| `anthropic` | direct_cloud | https://api.anthropic.com | ANTHROPIC_API_KEY |
| `openai` | direct_cloud | https://api.openai.com | OPENAI_API_KEY |
| `google-genai` | direct_cloud | https://generativelanguage.googleapis.com | GOOGLE_AI_API_KEY |
| `llm-gateway` | llm_gateway | http://llm-gateway:4000/v1 (internal; container is public:false) | AISHA_LLM_GATEWAY_KEY |
| `ollama-local` | local_ollama | http://ollama:11434 | OLLAMA_API_KEY |
| `vllm-local` | local_vllm | http://vllm:8000 | (none) |

The resolver scores these by `(benchmark × 0.55) + (local_bonus if allowed) +
(cost_match × 0.15) + (tool_match × 0.05) + (vision_match × 0.05)`. The
`llm_gateway` row is just another provider — same scoring, no exclusion.

## Test layers

### 1. Architecture gate (`llm-gateway-dispatch.gate.test.ts`, 24 tests)

Static analysis over source files. Enforces:
- Provider catalog seed includes llm-gateway with correct backend_kind +
  auth_env_var
- Seed description does NOT claim gateway is excluded from sync
- Resolver SQL has no WHERE/score exclusion of llm_gateway
- `generator.ts` reads `state.clow_backend` and branches on backend_kind
- `llmRouter.ts` declares `'gateway'` as a provider variant + handles it
- Cold-start generates AISHA_LLM_GATEWAY_KEY + writes to .env.coolify
- `config/domains.env` has LLM_GATEWAY_DOMAIN / OPENCLAW_DOMAIN /
  MCP_KNOWLEDGE_DOMAIN
- Compose env block uses `${LLM_GATEWAY_DOMAIN}` (not hardcoded)
- `ai_provider_registry` SoT has the columns executor needs

### 2. Resolver contract (`llm-gateway-resolver-contract.gate.test.ts`, 21 tests)

SQL-level invariants:
- Function is SECURITY DEFINER + STABLE + sets search_path
- backend_kind freedom (no WHERE/score exclusion)
- Candidate output JSON has all fields executor reads (provider_slug,
  model_id, backend_kind, endpoint_url, auth_env_var, strategy)
- Fallback object has backend_kind so executor isn't left empty-handed
- All referenced columns exist in SoT tables
- Score weights are explicit literals (reviewable; no magic)

### 3. Generator dispatch unit (`clow-backend-dispatch.unit.test.ts`, 7 tests)

Behavioral contract:
- backend_kind='llm_gateway' → `unifiedChat({ provider: 'gateway', ... })`
- backend_kind='direct_cloud' + anthropic → direct anthropic dispatch
- backend_kind='direct_cloud' + openai → direct openai dispatch
- state.clow_backend absent → slot-based fallback
- clow_backend.model_id wins over cfg.model_override (resolver authoritative)
- Decision provenance records the dispatch path

## Current state (as of this commit)

- ✅ Resolver SQL: clean (no exclusion, all fields present)
- ✅ Cold-start: writes all required envs + auto-generates secrets
- ✅ Provider catalog: llm-gateway is registered with correct shape
- ✅ Domains: LLM_GATEWAY_DOMAIN / OPENCLAW_DOMAIN / MCP_KNOWLEDGE_DOMAIN
  in canonical `config/domains.env`
- ❌ `generator.ts`: does NOT read `state.clow_backend` yet
- ❌ `llmRouter.ts`: no `'gateway'` provider variant yet
- ❌ Compose env block: doesn't use `${LLM_GATEWAY_DOMAIN}` (cosmetic)
- ❌ Seed description: still has misleading "backend bypasses gateway" note

## Implementation path (3 PRs, ~2 days)

**PR 1 — llmRouter gateway adapter** (medium)
- Add `'gateway'` to `LlmProvider` union in `services/svc-ai-chat/src/lib/llmRouter.ts`
- Implement `gateway` branch in `unifiedChat` — uses
  `process.env.AISHA_LLM_GATEWAY_URL` + `AISHA_LLM_GATEWAY_KEY`
- Gateway speaks OpenAI-compatible API (theopenco/llmgateway is OpenAI-shaped)
- Re-export `resolveProvider` to accept explicit `'gateway'` (not just
  prefix-match)

**PR 2 — generator wiring** (small)
- In `generator.ts`, read `ctx.state.clow_backend` before
  `resolveSlotModel`
- If present, pass `{ provider: clow_backend.backend_kind, model: clow_backend.model_id, ... }`
  to `unifiedChat`
- If absent, keep existing slot-based path

**PR 3 — seed description + compose tidy** (trivial)
- Follow-up migration UPDATEs the `notes` field on the llm-gateway
  catalog row to remove the obsolete "does NOT route" claim
- Compose env block uses `LLM_GATEWAY_DOMAIN=${LLM_GATEWAY_DOMAIN}`
  (canonical, not hardcoded)

After all three: the test suite passes 45/45 and any future regression
(someone re-introduces hardcoded prefix matching, removes the gateway
provider, or skips resolver output) is caught at pre-push.

## Drift detection — production observability

When (not if) someone bypasses the resolver in the future:
- `decisionProvenance` records `chose: clow_backend` and `called: actual`
- A gate test reads decision_provenance + asserts no drift > N% of calls
- Side-channel fingerprint: `fp(clow_backend.endpoint_url) ==
  fp(actual_called_url)` — drift means executor called a different URL than
  resolver picked
