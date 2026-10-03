# LLM Router — Multi-Provider AI Abstraction

> **Verze:** 1.0 | **Datum:** 2026-03  
> **Zdrojový soubor:** `supabase/functions/_shared/llmRouter.ts` (373 řádků)

Unified abstrakce pro volání AI modelů z Edge Functions. Routuje požadavky na OpenAI, Google Gemini nebo Anthropic přes jednotné API.

---

## Provider Resolution

| Prefix modelu | Provider | Příklad |
|---------------|----------|---------|
| `maestro-*` | Maestro (Alquist Insight dialog management) | `maestro-default`, `maestro-story-{uuid}` |
| `gemini-*` | Google AI (Gemini) | `gemini-2.0-flash` |
| `claude-*` | Anthropic | `claude-3-opus` |
| `vllm-*` | vLLM (self-hosted) | `Qwen/Qwen3-30B-A3B` |
| vše ostatní | OpenAI | `gpt-4o`, `o3-mini` |

> **Maestro provider** je dialog management vrstva volaná z `services/svc-ai-chat`
> orchestrace přes `services/svc-ai-chat/src/lib/providers/maestro.ts`. Project ID
> se extrahuje z model name (`maestro-story-{uuid}`) pro per-story KB filter v
> Ragnaroku. Frontend NIKDY nesmí volat Maestro přímo — viz [INSIGHT_INTEGRATION.md](INSIGHT_INTEGRATION.md).

```typescript
import { resolveProvider } from "../_shared/llmRouter.ts";
resolveProvider("gemini-2.0-flash"); // → "google"
resolveProvider("claude-3-opus");    // → "anthropic"
resolveProvider("gpt-4o");           // → "openai"
```

## Exportované API

| Export | Typ | Popis |
|--------|-----|-------|
| `LlmProvider` | Type | `"openai" \| "google" \| "anthropic"` (+ `"vllm"` v ai_model_registry) |
| `LlmMessage` | Interface | `{ role, content }` — normalizovaný formát zpráv |
| `UnifiedChatOptions` | Interface | Vstupní konfigurace pro `unifiedChat()` |
| `UnifiedChatResult` | Interface | `{ text, usage: { inputTokens, outputTokens }, provider, model }` |
| `resolveProvider(model)` | Function | Model string → provider |
| `isReasoningModel(model)` | Function | Detekuje OpenAI reasoning modely (o1/o3/o4/gpt-5) |
| `unifiedChat(opts)` | Function | Hlavní entry point — routuje na správný provider |

## Použití

```typescript
import { resolveProvider, unifiedChat } from "../_shared/llmRouter.ts";

const provider = resolveProvider("gemini-2.0-flash");
const result = await unifiedChat({
  provider,
  model: "gemini-2.0-flash",
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Hello" }],
  temperature: 0.4,
  maxTokens: 2000,
});

console.log(result.text);
console.log(result.usage); // { inputTokens: 12, outputTokens: 45 }
```

## Klíčové vlastnosti

- **OpenAI**: Používá Responses API (`openai.responses.create`), podporuje reasoning modely s `reasoningEffort`
- **Gemini**: Přímé REST volání (bez SDK), `v1beta generateContent` endpoint
- **Anthropic**: Přímé REST volání, Messages API `2023-06-01`
- **JSON mode**: Podporován u všech providerů (`jsonMode: true`)
- **Reasoning modely**: Automatická detekce (o1/o3/o4/gpt-5) → `temperature` se ignoruje, použije se `reasoning.effort`

## Environment Variables

| Proměnná | Provider | Povinné |
|----------|----------|---------|
| `OPENAI_API_KEY` | OpenAI | Pokud voláš OpenAI modely |
| `GOOGLE_AI_API_KEY` | Google Gemini | Pokud voláš Gemini modely |
| `ANTHROPIC_API_KEY` | Anthropic | Pokud voláš Claude modely |
| `VLLM_BASE_URL` | vLLM | Pokud voláš self-hosted modely |
| `VLLM_API_KEY` | vLLM | Pokud voláš self-hosted modely |
| `MAESTRO_URL` | Maestro | Pokud voláš Alquist Maestro dialog management |
| `MAESTRO_API_KEY` | Maestro | Pokud voláš Maestro endpoints |
| `INSIGHT_LLM_BACKEND` | Maestro/Ragnarok | `OpenAI` (default) nebo `vLLM` — toggle pro on-prem GPU |

Klíče lze přepsat per-request přes `openaiApiKey`, `googleApiKey`, `anthropicApiKey` v `UnifiedChatOptions`.

## Kdo používá LLM Router

Všechny Edge Functions s AI logikou importují tento router:
- `ai-chat` — hlavní konverzační AI endpoint
- `ai-story-consult` — AI konzultace pro story delivery
- `mcp-knowledge-server` — MCP orchestrace (generate/evaluate tools)

---

## vLLM Provider (Self-hosted)

> **Migrace:** `20260314100000_add_vllm_provider.sql`

vLLM je self-hosted OpenAI-compatible inference server pro běh open-source modelů na vlastní GPU infrastruktuře.

### Konfigurace

| Služba | Port | GPU paměť | Model |
|---------|------|-----------|-------|
| vLLM Embedding | 8123 | ~20 GB | Configurable |
| vLLM Generation | 8100 | ~90 GB NVIDIA | `Qwen/Qwen3-30B-A3B` |

### Registrace v DB

Model je registrován v `ai_model_registry` s providerem `vllm`:

```sql
INSERT INTO ai_model_registry (provider, model_id, display_name, ...)
VALUES ('vllm', 'Qwen/Qwen3-30B-A3B', 'Qwen3 30B-A3B (self-hosted)', ...);
```

Provider CHECK constraint: `'openai', 'anthropic', 'google', 'xai', 'mistral', 'meta', 'deepseek', 'vllm'`

### Integrace s Ragnarok

vLLM modely jsou používány Ragnarok RAG enginem (Alquist Insight) pro:
- **Embedding:** Vektorizace dokumentů při uploadu
- **Generation:** Odpovědi nad dokumenty v Ragnarok Agentu

Konfigurace v `packages/insight/ragnarok/ragnarok/generation/vllm.py` (`NvidiaVLLM` třída).

---

## Smart Model Auto-Selection (Orchestration Bridge)

> **Zdrojový soubor:** `supabase/functions/_shared/orchestrationBridge.ts`

Aisha autonomně vybírá optimální model pro každou zprávu na základě analýzy složitosti. Model selection je **adaptivní** — čte z `ai_model_registry` místo hardcoded mapování.

### Complexity Classification

Heuristická klasifikace bez LLM volání (rychlé pattern matching + word counting):

| Tier | Popis | Score range |
|------|-------|-------------|
| `greeting` | Pozdrav, krátká odpověď (≤8 slov) | Pattern match |
| `simple` | Jednoduchý dotaz | ≤1 |
| `moderate` | Střední složitost | 2–3 |
| `complex` | Kód, analytika, multi-question | 4–6 |
| `deep_analysis` | Architektura, debugging, strategie | >6 |

**Scoring signály:**
- Word count (0–4 body)
- Multiple questions (+2)
- Code/technical patterns (+2)
- Analytical patterns (+3)
- Escalation signals (+2)
- Deep conversation (>10 messages, +1)

### Adaptive Model Tiers

`selectOptimalModel()` řeší mapování `complexity → model_id` ze dvou zdrojů:

1. **Registry (preferovaný):** `get_adaptive_model_tiers()` RPC čte z `ai_model_registry`
2. **Fallback (hardcoded):** statické mapování když je registr prázdný

```
┌─────────────────────────────────────────────────────────────┐
│  selectOptimalModel() — async, accepts SupabaseClient       │
│   ├── classifyMessageComplexity() → "greeting"..."deep"     │
│   ├── resolveModelTiersFromRegistry(supabase)               │
│   │    └── supabase.rpc("get_adaptive_model_tiers")         │
│   │         ├── Phase A: benchmark data (post-evaluation)   │
│   │         └── Phase B: price + name heuristics (pre-eval) │
│   └── FALLBACK_MODEL_TIERS (hardcoded defaults)             │
└─────────────────────────────────────────────────────────────┘
```

### Two-Phase Tier Resolution (v DB)

**Phase A — Benchmark-based** (po evaluaci modelů):
- `greeting`/`simple`: Nejlevnější model s `overall_score >= 0.6`
- `moderate`: Vyvážený poměr kvality a ceny (`score × 0.6 − cost × 0.4`)
- `complex`: Nejvyšší `overall_score` (non-reasoning)
- `deep_analysis`: Nejvyšší `overall_score` (reasoning models)

**Phase B — Heuristic-based** (před evaluací):
- Používá `input_price_per_m` pokud je dostupná
- Fallback na model name patterns: `nano=0.05`, `flash/haiku=0.10`, `mini=0.50`, `pro/opus=15.0`
- Filtruje dated varianty (`gpt-4o-2024-11-20`) a transcription modely

### Risk Escalation Override

Pokud `route_task()` vrátí compliance/approval requirement, minimum tier se zvýší na `complex`.

### Fallback Model Tiers (hardcoded)

| Tier | Model | Provider |
|------|-------|----------|
| greeting | `gemini-2.5-flash` | Google |
| simple | `gemini-2.5-flash` | Google |
| moderate | `gpt-4.1-mini` | OpenAI |
| complex | `gpt-4o` | OpenAI |
| deep_analysis | `gpt-5` | OpenAI |

---

## AI Model Registry & Discovery

> **Tabulka:** `ai_model_registry` (26 sloupců)
> **Discovery:** `supabase/functions/discover-models/index.ts`
> **Schedule:** Denně 03:00 UTC (n8n workflow)

### Discovery Pipeline

```
n8n cron (03:00 UTC)
  └── discover-models Edge Function
       ├── scanOpenAI()     — GET /v1/models, filter CHAT_PREFIXES
       ├── scanAnthropic()  — ping known models via Messages API
       ├── scanGoogle()     — GET /v1beta/models, filter gemini
       └── scanXAI()        — GET /v1/models, filter grok
       │
       ├── upsert_discovered_model() — save to ai_model_registry
       ├── mark_models_unavailable() — flag removed models
       ├── create_improvement_proposal_admin() — auto-propose new models
       └── create_eval_run_admin() — trigger benchmark evaluation
```

### Self-Improving Cycle

```
Discovery (daily) → Registry → Eval Runs → Benchmarks → Adaptive Tiers
     ↑                                                        │
     └────────────────── Feedback Loop ────────────────────────┘
```

Aisha **pravidelně zjišťuje** dostupné modely od **všech providerů** (OpenAI, Anthropic, Google, xAI),
**sama je otestuje** přes evaluační pipeline, **vyhodnotí** výsledky v `ai_model_benchmarks`,
a **adaptuje** výběr modelů pro každou úroveň složitosti — bez manuálního zásahu.

### Klíčové RPC funkce

| Funkce | Účel |
|--------|------|
| `get_adaptive_model_tiers()` | Vrací JSONB s optimálním modelem pro každý tier |
| `get_best_model_for_task(p_task_type, ...)` | Filtrovaný výběr s benchmark daty |
| `upsert_discovered_model(...)` | Upsert modelu z discovery scanu |
| `mark_models_unavailable(...)` | Označí modely co zmizely z API |
| `insert_model_benchmark(...)` | Uložení výsledků evaluace |
