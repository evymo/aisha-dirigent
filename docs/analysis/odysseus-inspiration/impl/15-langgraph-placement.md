# Impl 15 — LangGraph pohled: je implementace na správné vrstvě? + orchestrace taskování agentů

> Ověřeno proti reálné reflection vrstvě. **Reflection je home-grown LangGraph-like DAG** (`reflection/orchestrator.ts`), NE `@langchain/langgraph`. Tři vrstvy: **PROVIDER** (`llmRouter.unifiedChat`/backends) · **NODE-RUNTIME** (node handlery: generator/critic/soulforge) · **GRAPH-STATE** (`orchestrator.ts` checkpoint/budget/context). Otázka: sedí naše změny na správné vrstvě?

---

## 1. Architektura v kostce (ověřeno)
- **Graf:** `GraphSchema {entry, nodes, edges, max_iterations}`; `runWorkflow` smyčka (orchestrator.ts:214–394); `RunCheckpoint {iteration, history, state}`; stav se merguje shallow: `checkpoint.state = {...state, ...output.state_patch}` (ř.348).
- **Všechny LLM cally konvergují do `unifiedChat`** (llmRouter:476) — generator/critic/tot/occipitum volají tutéž funkci. **Jeden control point.**
- **Model per node** = `dispatchDecision`/`resolveModelWithClow` → `aisha_resolve_clow_backend` (clow_backend ve `state`). Governance je per-node.
- **Budget gate na GRAPH-STATE (node boundary):** orchestrator.ts:305–346 metruje cost přes `fn_check_and_consume_ai_budget_audited`, tvrdě halts run na `blocked` před dalším node.
- **Context shaping na NODE-RUNTIME:** `soulforge.optimizePayload(raw, slot, profile)` — slot-aware trim (spark/verify/compact) PŘED `unifiedChat`. `composed_context` se načte jednou na iteraci 0 (`loadContext`→`compose_context`) a do `state`; **nikdy se napříč iteracemi netrimuje.**
- **Batch per node:** `generator.ts:97–181` rozhodne batch dle `clowBackend.strategy` a **staví batch tělo INLINE** (`{model,max_tokens,temperature,system,messages}`), `batch_suspend:true` → orchestrator uloží `waiting_batch`.
- **Tooly v grafu:** per-node `node.config`, **NE** `RoutePlan.toolsAllowlist` (ten je jen v chat cestě / workflowEngine).

---

## 2. Je každá naše změna na správné vrstvě? (verdikt + korekce)

| Změna | Správná vrstva | Naše umístění | Verdikt |
|-------|----------------|---------------|---------|
| **Prompt caching / jsonMode / thinking (G1/G3, structured)** | **PROVIDER** (`unifiedChat`→backend) | provider (anthropic.ts) | ✅ **Správně** — všechny graph nodes to zdědí automaticky (konvergence v `unifiedChat`). |
| **Budget enforcement (cost)** | **GRAPH-STATE** (node boundary) | — | ✅ **Už existuje** (`fn_check_and_consume_ai_budget_audited`). Reuse, nestavět. |
| **Context budget/kompakce (impl 03) — CHAT** | NODE/orchestrationBridge | orchestrationBridge | ✅ pro chat cestu OK |
| **Context editing / 200K (G2) — AGENTI** | **GRAPH-STATE + NODE-RUNTIME** | původně „chat history" | 🔴 **KOREKCE** — patří na orchestrator node boundary (kde `composed_context`+`state` rostou a netrimují se) + integrovat se `soulforge`. NE jen chat. |
| **01 tool selection (route_task allowlist)** | CHAT path (chat.ts) | chat.ts | ✅ pro chat. 🟠 **Pozn.:** graf tooly NEbere z `toolsAllowlist` (per-node config) → pro agenty je to **jiný hook**. |
| **Untrusted wrapper (02)** | NODE-RUNTIME **i** chat | orchestrationBridge | 🟠 **DVA body** — generator unpackuje `composed_context.layers` do system promptu (ř.57–66) → wrapper musí i tam, nejen v chat orchestrationBridge. |
| **Batch body builder (impl 12)** | PROVIDER (sdílený) | sync+batchSubmitter | 🔴 **ROZŠÍŘIT** — `generator.ts` staví batch tělo inline = **3. call site**. Musí použít `prepareAnthropicBody`. |

---

## 3. Tři konkrétní korekce do plánu

### K1 — Context editing/kompakce pro agenty = GRAPH-STATE, ne chat 🔴
`composed_context` (iterace 0) + `checkpoint.state` rostou napříč node-kroky a **nikdy se netrimují**; to je přesně „agent po 40–80 krocích narazí na 200K". Cost budget gate tam JE (305–346), token/context compaction NE.
- **Umístit:** hook na **orchestrator node boundary** (vedle budget gate) — před dalším node zkontrolovat token nálož stavu/historie; nad prahem komprimovat. **Reuse `soulforge.optimizePayload`** (existující node-runtime context shaper) + na Anthropic native context editing (G2 provider-aware).
- **Nestavět** paralelní kompaktor — rozšířit Soulforge o cross-iteration kompakci řízenou `ai_runtime` prahem.

### K2 — Sdílený `prepareAnthropicBody` má TŘI call sites 🔴
Drift risk z impl 12 potvrzen v grafu: `generator.ts:97–181` staví Anthropic/OpenAI batch tělo **inline**, odděleně od `anthropic.ts` sync. → invariant z impl 12 rozšířit: tělo staví výhradně `prepareAnthropicBody`, používaný **(1) anthropic.ts sync, (2) batchSubmitter/caller, (3) reflection `generator.ts` batch dispatch**. Gate A-3 musí pokrýt i `generator.ts`.

### K3 — Tool selection je dvoukolejné (chat vs graf) 🟠
- **Chat cesta:** impl 01 = protnout `channelToolNames` s `route_task` `toolsAllowlist` (správně).
- **Reflection graf:** tooly z `node.config`, `toolsAllowlist` se nepoužívá. Pokud chceme governed tool selection i pro agenty, je to **samostatný node-runtime hook** (allowlist check v node handleru) — **mimo nutné jádro**, jen pokud agentní nodes reálně volají široký tool set. Dokumentovat, neslévat s chat impl 01.

---

## 4. Caching ↔ Soulforge tenze (nová, důležitá) 🟠
Caching potřebuje **stabilní prefix napříč voláními**. Ale `soulforge.optimizePayload` **mění system prompt per slot** (compact = 500-char system, verify = plný) → různé system bloky mezi nodes = **cache miss**. 
- **Řešení:** stabilní prefix (instrukce/ruleset/pinned) držet **mimo** soulforge slot-variaci a cachovat; soulforge ať variuje jen **variabilní** část (za breakpointem). Tj. stable-prefix pravidlo (impl 10) platí i pro node-runtime, ne jen chat. Jinak caching v grafu nezabere.

---

## 5. Orchestrace taskování agentů — kam co patří (mapa cest)
| Vstup | Co dělá | Naše změny |
|-------|---------|------------|
| **Chat path** (`routeViaAisha`→`route_task`→workflowEngine) | běžná chat odpověď | 01 tool wire, 02 wrapper, 03 budget, caching (provider) |
| **`/reflect`** → `runWorkflow` (reflection DAG) | autonomní reflexe/ToT/critic | K1 context editing (graph-state+soulforge), K2 batch builder (generator), 02 wrapper (node), caching/thinking (provider, auto) |
| **`/dirigent/dispatch`** (dirigent-supervisor) | Claude Code hook → playbook → n8n nudges | governance/supervize; SSRF na n8n webhook (05A); jinak beze změny |
| **`/task`** → `create_ai_task` | async task tracking | batch směrování (offline) |
| **svc-agent-runner** (Claude Code v Dockeru) | one-shot agentic běh | model governance přes resolver; context editing relevant (tool-heavy) |

**Klíč:** model vybírá `aisha_resolve_clow_backend` **per node/krok** (clow_backend ve state); sync/batch `aisha_choose_execution_strategy`; budget hard-halt na node boundary. Naše provider-vrstva změny (caching/thinking/jsonMode) tečou do **všech** cest přes `unifiedChat` automaticky — to je správné a ověřené.

---

## 6. Dopad na zadání (08/12/14)
1. **K1 → G2/impl 03:** context editing pro agenty umístit na **orchestrator node boundary + soulforge** (ne chat history). Reuse existující budget-gate hook point.
2. **K2 → impl 12:** `prepareAnthropicBody` má **3. call site** (`generator.ts`); gate A-3 ho pokrývá.
3. **K3 → impl 01:** explicitně dvoukolejné — chat (allowlist) vs graf (node config, samostatný opt hook).
4. **Caching ↔ soulforge:** stable-prefix pravidlo platí i v node-runtime; soulforge variuje jen za breakpointem.
5. **Potvrzeno správně:** provider-layer změny (caching/thinking/structured) + cost budget gate — beze změny umístění.

> Závěr: implementace je **z 80 % na správné vrstvě** (provider konvergence + existující graph-state budget gate jsou ideální). Tři korekce (K1–K3) + caching/soulforge tenze jsou jediné, co je třeba umístit graph-aware. Žádná nová komponenta — reuse `unifiedChat`, budget-gate hook, soulforge, `prepareAnthropicBody`.
