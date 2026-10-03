# Impl 03 — Adaptivní context budget + kompakce (implementačně připraveno)

> Navazuje na spec `03-context-budget-compaction.md`. **Pořadí:** 2. v sekvenci. Sdílí `orchestrationBridge` s impl 02 a `ai_model_registry`/discovery s impl 01.

## ⚠️ ROZSAH: tento impl = CHAT cesta; AGENTI/graf = G2/K1
> Budget+kompakce níže cílí **chat path** (`chat.ts`/`orchestrationBridge`). Pro **reflection graf / agenty** (kde roste `composed_context`+`checkpoint.state` a hrozí 200K) je umístění jiné — **GRAPH-STATE orchestrator node boundary + `soulforge`**, viz [14 §G2](14-remaining-gaps-plan.md) a [15 §K1](15-langgraph-placement.md). `computeInputBudget` se sdílí; akce se aplikuje na obou místech zvlášť.

## ✅ NEJNOVĚJŠÍ (viz 11-stack-readiness §1.2): budget data UŽ tečou — chybí jen VYNUCENÍ
> `ContextBundle.tokenBudget/tokensUsed` **už plní** `compose_context` RPC (orchestrationBridge:618: `token_budget`/`tokens_used`); `budgetEnforcement` flag existuje (reflection/config). Nikde ale není `if (tokensUsed > tokenBudget) → trim/compact`. **Práce = navázat `computeInputBudget` + kompakci na už-přítomná data**, ne budovat budget infra. `context_window` se čte z existujícího sloupce registry.

## 1. Reálný stav (ověřeno)
- `services/svc-ai-chat/src/lib/modelDiscovery.ts`: `interface DerivedModelCaps` (ř. 29) **nemá** `context_window`/`max_output_tokens`; `deriveModelCaps(modelId)`, `discoverModels()`.
- `orchestrationBridge.ts`: `interface ContextBundle { profile; tokenBudget; tokensUsed; layers }` — budget se reportuje, **nevynucuje**.
- `chat.ts` načítá celou historii; `story-consult.ts` má hardcoded `.slice(-6)`.
- Token odhad `CHARS_PER_TOKEN = 4`.

## 2. Prerekvizit: model context window (sdíleno s impl 01)
> **OVĚŘENO (viz 08-final-zadani §0): `ai_model_registry` už má sloupce `context_window` a `max_output_tokens`** (`aisha/db/sql/tables/ai_model_registry.sql`). **ŽÁDNÁ migrace se nepíše.** Stačí číst existující sloupec a pro-wire ho do `DerivedModelCaps`. Odpadá types/rpc/baseline řetězec pro tuto část.

Rozšířit discovery (jen mapping, čtení existujícího sloupce):
```ts
export interface DerivedModelCaps {
  /* …stávající… */
  context_window?: number;       // z provider API nebo statické mapy pro self-hosted
  max_output_tokens?: number;
}
```
`discoverModels()` doplní z OpenAI/Anthropic `/models`; pro vLLM/Qwen statická mapa (známé okno) — fail-safe `undefined` = neznámé.

## 3. Čistá funkce budgetu: `services/svc-ai-chat/src/lib/contextBudget.ts`
```ts
export const DEFAULT_BUDGET = 6000;
export const DEFAULT_HEADROOM = 0.85;
export const DEFAULT_HARD_MAX = 200_000;

/** Auto-scale k oknu modelu; respektuj explicitní nastavení; konzervativně při neznámém oknu. */
export function computeInputBudget(args: {
  configured: number; contextWindow?: number; explicit: boolean;
  headroom?: number; hardMax?: number; defaultBudget?: number;
}): number {
  const { configured, contextWindow, explicit,
    headroom = DEFAULT_HEADROOM, hardMax = DEFAULT_HARD_MAX, defaultBudget = DEFAULT_BUDGET } = args;
  if (explicit) return Math.min(configured, contextWindow ?? configured); // user cap, clamp na okno
  if (!contextWindow) return defaultBudget;                               // neznámé okno → konzervativně
  return Math.min(Math.floor(contextWindow * headroom), hardMax);         // auto-scale
}
```
Čistá, unit-testovatelná. `explicit = (configured !== DEFAULT_BUDGET)`.

## 4. Auto-kompakce: `services/svc-ai-chat/src/lib/contextCompactor.ts`
```ts
export const COMPACT_THRESHOLD = 0.85;
export const SUMMARY_MAX_TOKENS = 1024;

export async function compactIfNeeded(args: {
  history: Array<{ role: string; content: string }>;
  contextWindow: number; tokensUsed: number; estimate: (s: string) => number;
  summarize: (msgs: Array<{role:string;content:string}>) => Promise<string>; // přes aisha_resolve_clow_backend('chat'/'reasoning')
  keepLastTurns?: number;
}): Promise<Array<{ role: string; content: string }>> {
  const { history, contextWindow, tokensUsed, summarize, keepLastTurns = 6 } = args;
  if (tokensUsed <= COMPACT_THRESHOLD * contextWindow) return history;
  const head = history.slice(0, -keepLastTurns);
  const tail = history.slice(-keepLastTurns);
  if (head.length === 0) return history;
  const summary = await summarize(head);
  return [{ role: 'system', content: `[shrnutí starší historie]\n${summary}` }, ...tail];
}
```
Sumarizaci uložit do konverzace auditovaně (RPC), ať se nepřepočítává. `keepLastTurns`/práh = funkce okna a profilu (malý model agresivně, velký skoro nikdy).

## 5. Token counting
> **OVĚŘENO: `estimateTokens()` už existuje** (`Math.ceil(len/4)`). **REUSE** — žádný nový tokenizer ani js-tiktoken dependency. Jen zcentralizovat do sdíleného importu a použít na budgeting hot-path. (Přesnější tokenizer = volitelný deferred, ne nutné jádro.)

## 6. Zapojení do orchestrace
V `chat.ts`/`orchestrationBridge`:
1. `caps = await deriveModelCaps(modelId)` → `contextWindow`.
2. `budget = computeInputBudget({ configured: profile.tokenBudget, contextWindow, explicit })`.
3. `history = await compactIfNeeded({ history, contextWindow, tokensUsed, estimate, summarize })`.
4. Odstranit hardcoded `.slice(-6)` ve `story-consult.ts` → budget-driven.
5. `hippocampus.traitLimit` odvodit z budgetu místo konstanty 12.

## 7. Testy
- `contextBudget.test.ts`: 16k vs 128k model → výrazně různý budget; explicit cap respektován; `contextWindow=undefined` → `DEFAULT_BUDGET`.
- `contextCompactor.test.ts`: historie > okno → kompakce proběhne, tail zachován; pod prahem → beze změny; prázdný head → no-op.
- Integration (throwaway nebo mock LLM): dlouhá konverzace nepřeteče.

## 8. Task checklist
- [ ] Migrace `ai_model_registry` (+context_window, +max_output_tokens) přes SoT + register + `db:init:generate`.
- [ ] `DerivedModelCaps` + `discoverModels` doplnit okno (API + statická mapa vLLM).
- [ ] `contextBudget.ts` + `contextCompactor.ts` + `tokenCount.ts`.
- [ ] Zapojení v `chat.ts`/`orchestrationBridge`; odstranit `.slice(-6)`; hippocampus traitLimit.
- [ ] Unit + integration testy.
- [ ] Feature flag `adaptive_context_budget` (off = staré chování).

## 9. Vazby
- **impl 01** sdílí prerekvizit `context_window` v registry → udělat migraci jednou, společně.
- **impl 02** sdílí `orchestrationBridge` — koordinovat PR vlnu.
- Kompakce volá LLM přes `aisha_resolve_clow_backend` (žádná nová LLM cesta).
