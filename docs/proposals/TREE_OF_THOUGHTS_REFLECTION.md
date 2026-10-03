# Tree of Thoughts nad reflection enginem — „dostat ToT do Aishy"

> **Status:** ČÁSTEČNĚ SHIPNUTO / DESIGN PRO DALŠÍ FÁZE (autor: AISHA + maintainer,
> 2026-06-13; implementation sync 2026-06-21)
> **Vrstva:** rozšíření reflection enginu (`services/svc-ai-chat/src/reflection/*`)
> **Navazuje na:** [STORY_SELF_EVALUATION_LOOP.md](../architecture/STORY_SELF_EVALUATION_LOOP.md),
> [dirigent-overlay-pipeline.md](../architecture/dirigent-overlay-pipeline.md),
> reflection graph schema (`reflection/types.ts`), self-eval smyčka generator→critic→convergence_gate→corrector.
>
> **Princip (stejný jako u self-eval):** *žádná nová „feature"* — wire-up existujících reflection
> schopností do uzavřeného **stromového prohledávání**. Chybějící kus = explicitně označen jako
> dev story. **Dokumentaci neber jako pravdu — ověř v kódu a DB, drž SoT.**
>
> **Konsolidované zadání:** tento dokument je *analýza a zdůvodnění*; finální, sjednocený a
> akceschopný implementační plán (epochy 0–5, invarianty, acceptance criteria) je v companion souboru
> [AISHA_ORCHESTRATION_MASTERPLAN.md](./AISHA_ORCHESTRATION_MASTERPLAN.md).

> **Implementation sync 2026-06-21:** single-run ToT v1 je na `main` jako
> `services/svc-ai-chat/src/reflection/graphs/reasoning-tree-reflect.json` +
> nody `tot_planner`, `tot_expand`, `tot_evaluate`, `tot_search` a seed
> `aisha/db/seed/core/33_reflection_graphs.sql`. Aktuální kódové SoT používá
> `wave_width` (ne starší `branching_factor`) a ploché routovací hodnoty
> `tot_action='expand'|'evaluate'|'search'|'done'`; graf na `done` končí tím,
> že nemá další outgoing edge. Níže uvedené starší pseudokódy se `solved` /
> `exhausted` / `backtrack` čti jako design history pro v1+/v2, ne jako přesný
> kontrakt současného `main`.

---

## TL;DR

Aisha už dnes **má ~85 % Tree of Thoughts (ToT) postavené by design**. Reflection engine
(`reflection/orchestrator.ts`) je grafový orchestrátor s checkpointingem, podmíněnými hranami,
smyčkou `generator → critic → convergence_gate → corrector`, výběrem nejvhodnějšího modelu na úkon
(`aisha_resolve_clow_backend` + Soulforge sloty), per-story budget gate a plným auditem každého uzlu.

ToT není přepis jádra. Je to **jedna nová workflow-definition (graph) + 3–4 nové reflection nody**,
které z dnešní *lineární* smyčky udělají *prohledávání stromu*:

| Co ToT přidává | Jak v Aishe | Náročnost |
|---|---|---|
| Rozklad na myšlenky (decomposition) | nový node `tot_planner` | malá |
| Generování variant (k větví) | nový node `tot_expand` (interní `Promise.all` nad `unifiedChat`) | malá |
| Heuristické hodnocení Sure/Maybe/Impossible | rozšíření logiky `critic` → node `tot_evaluate` | malá |
| Prohledávání BFS/DFS + backtracking | nový řídicí node `tot_search` (strom žije ve `state.tot`) | střední |

Žádná DB migrace pro typy: `ai_workflow_node_runs.node_type` je `text` **bez** CHECK constraintu a
`ai_workflow_definitions.graph` je volné JSONB — typovou bránou je **pouze** Zod enum `NodeTypeSchema`
+ registr `NODE_HANDLERS` v TypeScriptu. Cena „modelu uvažování" je vysoká, ale **řízená** existujícími
páčkami (budget gate, levné modely na šířku / prémiové na hodnocení, Soulforge úspora tokenů, batch API −50 %).

> **Dokument má pět částí.** **Část A** (§1–§12) = single-run ToT, strom žije ve `state.tot`.
> **Část B** = *orchestrační bestie* — paralelní podstromy jako **flotila runů** řízená dirigent-runem,
> postavená 1:1 na existující batch suspend/resume machinery. **Část C** = *otěže a výkon* —
> sjednocení A+B i externího „svalu" (Claude CLI, modely přes gateway/API, lokální offline modely)
> pod **jeden kontrakt (`clow`)** a **jednu řídicí rovinu** (routing + strategie + náklady + kill),
> kterou Aisha už z velké části má. **Část D** = *adaptivní samo-orchestrace* — Aisha řídí výběr
> výkonu (cloud i **vlastní** zdroje) **sama**, podle měnících se proměnných z testů, evalů a zkušeností;
> uzavírá a zapíná samoučící smyčku, kterou už má z velké části postavenou. **Část E** =
> *transparentnost a důkaz* — **vidět dovnitř** (strom vč. prořezaných větví, flotila, rozhodnutí,
> náklady), **brát a analyzovat výstupy**, a **dokázat**, že se Aisha učí (before/after, champion/challenger).

---

## 1. Co je Tree of Thoughts (4 fáze)

ToT mění lineární generování textu na **dynamické vyhledávání v grafu možností**. Čtyři fáze:

1. **Thought Decomposition** — rozklad úkolu na menší samostatné myšlenkové kroky (fáze).
2. **Thought Generator** — pro každý krok vygeneruje *k* alternativních cest (větvení stromu).
3. **State Evaluator** — interní kritik posoudí každou větev a přiřadí status: **Sure** (jistá cesta),
   **Maybe** (nejednoznačná, prozkoumat dál), **Impossible** (slepá ulička).
4. **Search Algorithms** — navigace stromem: **BFS** (do šířky), **DFS** (do hloubky) s **backtrackingem**
   (návrat do posledního rozhodovacího bodu a rozvinutí druhé nejlepší větve).

```
[Zadání: vyřeš těžký problém]
              │
              ▼
        [Myšlenka Krok 1]
   ┌──────────┼──────────┐
   ▼          ▼          ▼
[Metoda A] [Metoda B] [Metoda C]
   │          │          │
 (❌ Imposs)(⚠️ Maybe) (✅ Sure)
   │          │          │
[PRUNED]      │          ▼
              │    [Myšlenka Krok 2]
              │     ┌────┴────┐
              │     ▼         ▼
              │ [Řešení X] [Řešení Y]
              │ (❌)       (✅)
              └─────┴─────────┘
                    ▼
            [FINÁLNÍ OUTPUT]
```

---

## 2. Mapování 4 fází ToT na stávající bloky Aishy

Klíčová tabulka „co už existuje by design". Soubory jsou reálné cesty v repu.

| Fáze ToT | Co vyžaduje | Co už v Aishe existuje | Soubor | Stav | Co dořešit |
|---|---|---|---|---|---|
| **Engine / smyčka** | grafový běh s checkpointy, podmíněné hrany, resume | `runWorkflow()`, `evalGuardedExpression()`, `fn_get_next_graph_node`, checkpointer | `reflection/orchestrator.ts`, `reflection/checkpointer.ts` | ✅ produkční | jen zvýšit `maxIterationsPerRun` |
| **1. Decomposition** | rozbít úkol na kroky/myšlenky | `soulforge_classify` (klasifikace slotu), `synthesis` ve workflowEngine | `reflection/soulforge.ts` | ⚠️ částečné | nový `tot_planner` (rozklad na strom) |
| **2. Generate variants** | *k* hypotéz na krok | `generator` (1 výstup), `occipitum_creative` (kreativní větev) | `reflection/nodes/generator.ts` | ⚠️ 1 větev | `tot_expand` = `Promise.all` *k*× `unifiedChat` |
| **3. Evaluate** | skóre + verdikt na větev | `critic` (0..1 per rule, `overall`), evaluate.ts (LLM-as-judge) | `reflection/nodes/critic.ts` | ✅ skóre hotové | mapování `overall`→Sure/Maybe/Impossible |
| **4. Search + backtrack** | fronta větví, BFS/DFS, prořez, návrat | `convergence_gate` (pass/retry/exhausted), `corrector` (loop-back), hrany s podmínkami | `reflection/nodes/convergence_gate.ts`, `corrector.ts` | ⚠️ jen lineární retry | `tot_search` controller + strom ve `state.tot` |
| **Výběr modelu na úkon** | levný na šířku, prémiový na hodnocení | `aisha_resolve_clow_backend`, `resolveSlotModel(slot, profile)` | `reflection/soulforge.ts`, `generator.ts` | ✅ produkční | jen asymetrické přiřazení slotů |
| **Náklady / strop** | metering, zastavení runaway | per-story budget gate, `appendCost`, `estimateCostUsd` | `orchestrator.ts` (`fn_check_and_consume_ai_budget_audited`) | ✅ produkční | rozpočtový profil pro ToT |
| **Governance / audit** | každá větev auditovatelná, human gate | `ai_workflow_node_runs` (per-node log), `interrupt`, `decisionProvenance` | `reflection/orchestrator.ts`, `lib/decisionProvenance.ts` | ✅ produkční | ToT verdikt = autorita `model_heuristic` |

**Dnešní self-eval smyčka je vlastně ToT s branching factor = 1** (jedna větev, retry přes corrector).
ToT je její **zobecnění na branching factor > 1 s explicitní frontou a prořezem**.

---

## 3. Architektonické rozhodnutí: strom ve stavu vs. strom v enginu

Orchestrátor (`runWorkflow`) drží **jeden** `currentNodeId` a **plochý** `checkpoint.state`
(merge přes `{ ...state, ...state_patch }`). Z toho plynou dvě cesty:

**Varianta A — „strom ve stavu" (DOPORUČENO pro v1).**
Celý strom myšlenek (uzly, fronta, skóre, politika) žije jako datová struktura v `state.tot`.
Nové nody ji čtou/zapisují; orchestrátor zůstává *driverem*. BFS/DFS/beam = jen pořadí fronty
uvnitř `tot_search`. Backtracking = vyber jiný uzel z fronty. **Žádná změna jádra, checkpointeru,
budget gate, auditu ani RPC.** Přesně sedí na tezi „propojit, co Aisha už umí".

**Varianta B — „strom v enginu" (v2, scale-out).**
Každá živá větev = samostatný child `ai_run`, rodič je orchestruje. Dává **reálnou GPU paralelizaci**
napříč větvemi (skutečné zrychlení wall-clock). Hloubková analýza (viz **Část B**) ukázala, že to
**nevyžaduje přepis jádra** — `waiting_children` suspend/resume je 1:1 šablona existující batch
machinery (`waiting_batch` → `WF_BATCH_RESUMER`). **Plně rozpracováno v Části B** (doporučeno pro
vysoký `beam_width` / široké stromy).

> **Pozn. k paralelismu:** i ve Variantě A je **paralelismus na úrovni jedné hladiny** dostupný hned —
> `tot_expand` udělá `Promise.all` nad *k* voláními `unifiedChat` v rámci jednoho node běhu.
> Paralelní běh **různých podstromů** jako oddělených runů je až Varianta B.

Zbytek dokumentu specifikuje **Variantu A**.

---

## 4. Datový model stromu (`state.tot`)

Strom je jeden vnořený objekt, který nody přepisují celý přes `state_patch.tot`
(plochý merge stačí, protože `tot` je jediný klíč). Pro hrany se navíc zrcadlí **ploché**
routovací klíče (`tot_action`, `tot_done`), protože evaluator hran neumí závorky ani funkce.

```ts
// services/svc-ai-chat/src/reflection/tot/types.ts  (nový)
export type ThoughtStatus = 'sure' | 'maybe' | 'impossible';

export interface ThoughtNode {
  id: string;                 // 'n0', 'n0.1', 'n0.1.2' …
  parent_id: string | null;
  depth: number;
  thought: string;            // text dílčího kroku / hypotézy
  status: ThoughtStatus | 'unevaluated';
  score: number;              // 0..1 z critic.overall
  children: string[];         // id potomků
  terminal: boolean;          // je to kandidát na finální řešení?
}

export interface ToTPolicy {
  strategy: 'bfs' | 'dfs' | 'beam';
  branching_factor: number;   // k variant na krok (default 3)
  beam_width: number;         // kolik větví drží naživu (default 3)
  max_depth: number;          // strop hloubky (default 4)
  max_expansions: number;     // tvrdý strop počtu expanzí (default 24)
  sure_threshold: number;     // score ≥ → 'sure'   (default 0.80)
  impossible_threshold: number; // score < → 'impossible' (default 0.35)
  solve_threshold: number;    // terminal & score ≥ → hotovo (default 0.85)
}

export interface ToTState {
  tree: Record<string, ThoughtNode>;  // id → node
  frontier: string[];                  // fronta id k expanzi (pořadí = strategie)
  active: string | null;               // právě zpracovávaný uzel
  best: { id: string; score: number } | null;
  expansions: number;
  policy: ToTPolicy;
}
```

Plochá routovací zrcadla, která `tot_search` zapisuje do `state` (čtou je hrany grafu):

- `tot_action`: `'expand' | 'solved' | 'exhausted' | 'backtrack'`
- `tot_done`: `true | false`

---

## 5. Nové nody (spec)

Všechny dodržují protokol `NodeHandler = (ctx) => Promise<NodeOutput>` z `reflection/types.ts`
a registrují se do `NODE_HANDLERS` (`reflection/nodes/index.ts`). Typ se přidá do Zod enumu
`NodeTypeSchema`. **Maximální reuse** — žádný nový HTTP hop, vše přes `unifiedChat` + Soulforge.

### 5.1 `tot_planner` — rozklad (fáze 1)

- **Účel:** z `state.task.description` vyrobí kořen stromu a (volitelně) první hladinu myšlenek.
- **Reuse:** `unifiedChat` se slotem `semantic`/`spark` (levné), `optimizePayload`, `resolveSlotModel`.
- **Config:** `{ slot?: 'semantic', profile?: 'balanced', initial_thoughts?: 3, policy?: Partial<ToTPolicy> }`
- **Čte:** `state.task`, `state.composed_context`.
- **Zapisuje:** `state_patch.tot` (inicializovaný strom + `policy`), `state.tot_action = 'expand'`.
- **transition_key:** `'planned'`.

### 5.2 `tot_expand` — generování variant (fáze 2)

- **Účel:** pro `tot.active` (nebo první z `frontier`) vygeneruje `branching_factor` hypotéz **paralelně**.
- **Reuse:** `Promise.all` nad `unifiedChat`; `slot: 'ember'`/`'spark'` (šířka = levné modely);
  volitelně `clow_backend.strategy === 'batch'` → `submitBatch` (−50 %) přes existující `batch_suspend`.
- **Config:** `{ slot?: 'ember', profile?: 'budget', temperature?: 0.7 }` (vyšší teplota = diverzita).
- **Čte:** `state.tot`, rodičovský `thought`.
- **Zapisuje:** přidá potomky do `tot.tree` (status `unevaluated`), posune `active`/`frontier`.
- **transition_key:** `'expanded'`. Tokeny sečteny přes `output.tokens_input/output` (budget gate je vidí).

### 5.3 `tot_evaluate` — Sure/Maybe/Impossible (fáze 3)

Tenká nadstavba nad logikou `critic` (`reflection/nodes/critic.ts`): stejné JSON-mode skórování
0..1 per rule + `overall = mean`, navíc **mapování na 3-stavový status** podle prahů z `policy`.

- **Reuse:** `critic` skórovací prompt, `slot: 'verify'` + `profile: 'maxQuality'` (hloubka = prémiový model).
- **Config:** `{ rules?: ['correctness','feasibility','progress'], slot?: 'verify', profile?: 'maxQuality' }`
- **Mapování:**

  | Podmínka | Status | Důsledek |
  |---|---|---|
  | `overall ≥ sure_threshold` (0.80) | **Sure** | drž ve frontě s prioritou; pokud `terminal` → kandidát na řešení |
  | `impossible_threshold ≤ overall < sure_threshold` | **Maybe** | drž ve frontě (nižší priorita) |
  | `overall < impossible_threshold` (0.35) | **Impossible** | **prune** — odeber z fronty, označ slepou uličku |

- **Zapisuje:** `tot.tree[id].status/score`, aktualizace `best`; ploché `score` (= `last_critic_overall`).
- **transition_key:** `'evaluated'`.

### 5.4 `tot_search` — controller BFS/DFS + backtracking (fáze 4)

Mozek ToT. **Jediný node, kde žije politika prohledávání** — záměrně, protože evaluator hran
(`evalGuardedExpression`) neumí závorky/funkce, takže veškerá netriviální logika patří sem,
ne do podmínek hran.

- **Účel:** po každé evaluaci rozhodne další krok podle `policy.strategy`.
- **Algoritmus (pseudokód):**

```
prune Impossible z frontier
if existuje terminal uzel se score ≥ solve_threshold:
    best = ten uzel; tot_action = 'solved'; tot_done = true
elif expansions ≥ max_expansions OR frontier prázdná:
    tot_action = 'exhausted'; tot_done = true        # vrať dosavadní best
else:
    seřaď frontier podle strategie:
        bfs  → podle depth ASC, pak score DESC
        dfs  → podle depth DESC, pak score DESC  (jdi hluboko po nejlepší linii)
        beam → drž jen top `beam_width` podle score, zbytek zahoď
    active = frontier[0]
    if active je slepá ulička (žádný Maybe/Sure potomek a je na max_depth):
        tot_action = 'backtrack'   # active se zahodí, příště se vezme sibling/rodič
    else:
        tot_action = 'expand'
```

- **Backtracking** = žádná engine-operace; jen vyber **jiný** uzel z `frontier`. Historie je navíc
  v `checkpoint.history` (audit „kam se model vracel").
- **Config:** `{ }` (politika je v `state.tot.policy`).
- **Zapisuje:** `state.tot` (fronta, active, best, expansions++), ploché `tot_action`, `tot_done`.
- **transition_key:** = hodnota `tot_action`.

> **Volitelně `tot_refine`:** pro status **Maybe** lze místo zahození zavolat existující `corrector`
> (feedback → vylepšená myšlenka) a uzel znovu evaluovat. Zdarma reuse — žádný nový node.

---

## 6. Graph JSON — `reasoning-tree-reflect.json`

Plně kompatibilní se schématem `GraphSchema` (`reflection/types.ts`). Hrany používají **jen**
triviální porovnání (mini-gramatika evaluatoru: `==`, `>=`, `AND/OR`, dot-paths, `.length` — **bez závorek**).
Uložit jako `services/svc-ai-chat/src/reflection/graphs/reasoning-tree-reflect.json` a naseedovat
jako řádek `ai_workflow_definitions`.

```jsonc
{
  "name": "reasoning-tree-reflect",
  "display_name": "Tree of Thoughts — deliberativní uvažování",
  "description": "ToT nad reflection enginem: planner → expand(k) → evaluate(Sure/Maybe/Impossible) → search(BFS/DFS+backtrack). Strom žije ve state.tot; levné modely na šířku, verify/maxQuality na hodnocení.",
  "context": "reflection",
  "version": 1,
  "is_active": false,                      // za feature-flagem, zapnout po PR 4
  "metadata": { "mode": "deliberative", "tier": "reasoning", "owner": "platform" },
  "graph": {
    "entry": "soulforge_classify",
    "nodes": [
      { "id": "soulforge_classify", "type": "soulforge_classify", "config": {} },
      { "id": "hippocampus_read",   "type": "hippocampus_read",   "config": { "limit": 5, "min_importance": 3 } },
      { "id": "tot_planner",        "type": "tot_planner",        "config": { "slot": "semantic", "initial_thoughts": 3,
          "policy": { "strategy": "beam", "branching_factor": 3, "beam_width": 3, "max_depth": 4, "max_expansions": 24,
                      "sure_threshold": 0.80, "impossible_threshold": 0.35, "solve_threshold": 0.85 } } },
      { "id": "tot_expand",         "type": "tot_expand",         "config": { "slot": "ember", "profile": "budget", "temperature": 0.7 } },
      { "id": "tot_evaluate",       "type": "tot_evaluate",       "config": { "slot": "verify", "profile": "maxQuality",
          "rules": ["correctness", "feasibility", "progress"] } },
      { "id": "tot_search",         "type": "tot_search",         "config": {} },
      { "id": "interrupt",          "type": "interrupt",          "config": { "channel": "in_app", "approver": "user", "reason": "tot_final_review" } },
      { "id": "hippocampus_write",  "type": "hippocampus_write",  "config": { "importance": "critic_score" } }
    ],
    "edges": [
      { "from": "soulforge_classify", "to": "hippocampus_read" },
      { "from": "hippocampus_read",   "to": "tot_planner" },
      { "from": "tot_planner",        "to": "tot_expand" },
      { "from": "tot_expand",         "to": "tot_evaluate" },
      { "from": "tot_evaluate",       "to": "tot_search" },

      { "from": "tot_search", "to": "tot_expand",        "condition": "tot_action == 'expand'" },
      { "from": "tot_search", "to": "tot_expand",        "condition": "tot_action == 'backtrack'" },
      { "from": "tot_search", "to": "interrupt",         "condition": "tot_action == 'solved'" },
      { "from": "tot_search", "to": "hippocampus_write", "condition": "tot_action == 'exhausted'" },

      { "from": "interrupt", "to": "hippocampus_write", "condition": "approved == true" }
    ]
  }
}
```

Smyčka `tot_search → tot_expand → tot_evaluate → tot_search` je ToT jádro. `interrupt` dává
**human gate** na finální řešení (reuse). `hippocampus_write` uloží learnings (skóre = důležitost).

---

## 7. Proč je to drahé — a jak to Aisha drží pod kontrolou

ToT na pozadí „vyzkouší a zahodí" velké množství textu (50 větví, 20 backtracků…), které uživatel
nevidí (leda v debug). Konstantní cena dotazu se mění na **proměnnou cenu úměrnou šířce × hloubce ×
branching factoru**. Aisha to ale neřeší novou infrastrukturou — má **5 páček, které už existují**:

| Páčka | Mechanismus | Soubor |
|---|---|---|
| **Tvrdý strop $** | budget gate halt run → `status='blocked'` při překročení per-story capu | `orchestrator.ts` → `fn_check_and_consume_ai_budget_audited` |
| **Asymetrické modely** | šířka = levné (`gemini-2.5-flash`, `claude-haiku`), hloubka/hodnocení = `claude-sonnet` | `resolveSlotModel(slot, profile)` v `soulforge.ts` |
| **Nejvhodnější backend na úkon** | `aisha_resolve_clow_backend` vybírá provider/model dle ceny, fitu, batch eligibility, benchmarků | `generator.ts` (`state.clow_backend`) |
| **Úspora tokenů** | `optimizePayload` maže tokeny, co nemění odpověď (per-slot shaping) | `soulforge.ts` |
| **Batch −50 %** | široká expanze je „embarrassingly batchable" → Anthropic/OpenAI Batch API | `generator.ts` → `submitBatch`, `batch_suspend` |

**Cost knoby ToT** (vše v `policy`): `branching_factor`, `beam_width`, `max_depth`, `max_expansions`.
Doporučené asymetrické přiřazení slotů:

| ToT node | Hladina | Slot / profile | Typický model | Proč |
|---|---|---|---|---|
| `tot_expand` | šířka (mnoho volání) | `ember`/`spark` · `budget` | gemini-flash / haiku | levné, diverzní hypotézy |
| `tot_evaluate` | hloubka (málo volání) | `verify` · `maxQuality` | claude-sonnet | přesný soud rozhoduje prořez |
| `tot_planner` | 1× na běh | `semantic` · `balanced` | haiku / sonnet | strukturní rozklad |

Závěr: nový **„tier uvažování" (reasoning)** bude dražší než běžný dotaz, ale díky výše uvedenému
je to **řízená a měřená** cena, ne runaway. Metering už teče do `ai_runs.cost_total_json.total_usd`.

---

## 8. Governance, audit, bezpečnost

- **Autorita verdiktu.** ToT skóre je `model_heuristic` v hierarchii `decisionProvenance.ts`
  (`ruleset_snapshot > core_values > compliance_policy > orchestration_policy > knowledge_retrieval >
  model_heuristic > fallback`). ToT tedy **nesmí přebít** compliance/core_values — jen vybírá mezi
  přípustnými větvemi. Toto je už vynucené, není co stavět.
- **Plný audit stromu.** Každý node běh (každá expanze i evaluace) se loguje do `ai_workflow_node_runs`
  (input/output/tokeny/transition_key). Celý strom včetně zahozených větví je tak **rekonstruovatelný**
  — to je ten „přístup k debug informacím", o kterém mluvíš.
- **Human gate.** `interrupt` node pozastaví run (`status='waiting_human'`) před finálním řešením
  rizikových úkolů. Existuje.
- **OWASP / SSRF.** Volání jdou přes `unifiedChat` providery s `ssrfHostAllowlist` (`config.ts`).
- **Enterprise source onboarding** (viz CLAUDE.md): ToT nepřidává nový datový zdroj — čte přes
  existující `composed_context` (pgvector/Ragnarok), takže klasifikace/consent/ACL platí beze změny.

---

## 9. Fázový implementační plán (malé PR, mirror self-eval doc)

| PR | Obsah | Dotčené soubory | Effort |
|---|---|---|---|
| **PR 1** | Datový model `ToTState`/`ThoughtNode` + Zod enum rozšíření + registrace 4 nodů (stuby) | `reflection/tot/types.ts`, `reflection/types.ts` (enum), `reflection/nodes/index.ts` | S |
| **PR 2** | `tot_planner` + `tot_expand` (sync `Promise.all`, *k* variant) | `reflection/nodes/tot_planner.ts`, `tot_expand.ts` | M |
| **PR 3** | `tot_evaluate` (reuse critic + Sure/Maybe/Impossible) | `reflection/nodes/tot_evaluate.ts` | S |
| **PR 4** | `tot_search` — **BFS + beam** + prune; seed `reasoning-tree-reflect.json`; feature-flag; zvýšit `LANGGRAPH_MAX_ITERATIONS` | `reflection/nodes/tot_search.ts`, `reflection/graphs/`, `config.ts`/env | M |
| **PR 5** | **DFS + backtracking** politika v controlleru | `reflection/nodes/tot_search.ts` | M |
| **PR 6** | Cost optimization — batch expanze + asymetrické sloty + rozpočtový profil ToT | `tot_expand.ts`, env `AISHA_SLOT_MODELS` | M |
| **PR 7** | Surfacing (workbench strom/debug view) + gate testy (deterministické, mock LLM) | `workbench/*`, `src/tests/gates/` | M |
| **PR 8** *(v2)* | Varianta B — paralelní podstromy jako child `ai_runs` | `reflection/orchestrator.ts` (jádro) | L |

**Nutná konfig změna:** `maxIterationsPerRun` (default **20**, env `LANGGRAPH_MAX_ITERATIONS`) je málo —
jeden ToT cyklus = ~3 node hopy, takže 20 ≈ 6 cyklů. Pro ToT graf zvednout (např. 200) a primárně se
spoléhat na `policy.max_expansions` + $ budget gate, ne na globální iteration cap.

---

## 10. Co se NEMÁ stavět (existuje produkčně)

Grafový orchestrátor + loop (`runWorkflow`) · checkpointer (`ai_runs.metadata.checkpoint`) ·
evaluator podmínek hran (`evalGuardedExpression`) · per-story budget gate + metering ·
model/backend router (`aisha_resolve_clow_backend`, `resolveSlotModel`) · `unifiedChat` multi-provider ·
Soulforge úspora tokenů · cost aggregation (`appendCost`/`estimateCostUsd`) · audit (`ai_workflow_node_runs`) ·
human gate (`interrupt`) · paměť (`hippocampus_read/write`) · batch API (`submitBatch`/`batch_suspend`).

---

## 11. Rizika a otevřené otázky

- **Evaluator hran bez závorek.** Mini-gramatika neumí `(A AND B) OR C` ani funkce. **Mitigace:**
  veškerá netriviální logika v `tot_search`; hrany jen čtou ploché `tot_action`/`tot_done`.
- **Plochý merge stavu.** `state` se mele přes shallow spread → strom drž jako **jeden** klíč `state.tot`
  a přepisuj celý přes `state_patch.tot` (žádné hluboké patche dílčích uzlů).
- **Iteration cap vs. velikost stromu.** Viz §9 — řiď přes `max_expansions`, ne globální cap.
- **Velikost checkpointu.** Velký strom + historie v `ai_runs.metadata` (JSONB). **Mitigace:** ukládat
  do `tree[id].thought` zkrácené texty; plné výstupy zůstávají v `ai_workflow_node_runs.output_data`.
- **Reálná paralelizace.** Varianta A paralelizuje jen v rámci jedné hladiny (`Promise.all`).
  Skutečné wall-clock zrychlení napříč podstromy = Varianta B (PR 8).
- **Kvalita evaluátoru = strop ToT.** Špatný `tot_evaluate` prořezává dobré větve. Drž ho na
  `verify`/`maxQuality` a měř shodu skóre s lidským verdiktem (gate test).

---

## 12. Verdikt — Část A (single-run)

„Dostat ToT do Aishy" **není výzkumný ani jádrový projekt** — je to ~4 nové reflection nody + 1 graph
definition nad infrastrukturou, kterou Aisha už má hotovou (grafový engine, kritik, výběr modelu,
budget gate, audit). Teze „je to jen o propojení toho, co Aisha zvládá by design" **platí a je
ověřená v kódu**. Doporučený postup: Varianta A (strom ve `state.tot`), PR 1–7 za feature-flagem,
Varianta B (paralelní podstromy) až podle zátěže.

---

# Část B — Orchestrační bestie: distribuované uvažování

> **Část A** drží celý strom v **jednom** runu a prohledává ho **sekvenčně** na jednom event-loopu.
> **Část B** z toho dělá **flotilu runů**: jeden **dirigent (conductor)** run řídí **vlny** paralelních
> **větvových (branch) child runů**, které prozkoumávají podstromy současně. Cíl: reálné wall-clock
> zrychlení, izolace těžkých větví a škálování za hranici jednoho procesu — **bez přepisu jádra**,
> protože všechno stojí na tom, co Aisha už má (fire-and-respond spawn, batch suspend/resume,
> sdílený story budget, `candidates[]` z `fn_get_next_graph_node`, `executeParallel` merge).

## B0. Kdy sáhnout po Části B

Část A stačí pro většinu úkolů. Bestie (B) se vyplatí, když:

- **široký strom** — vysoký `branching_factor` × `beam_width` (desítky větví na hladinu) → sekvenční běh je pomalý;
- **drahá/dlouhá evaluace** — každý `tot_evaluate` je prémiový model na sekundy → paralelně = řádové zrychlení;
- **izolace** — větev pouští nedůvěryhodný kód / tool → patří do sandboxu (`svc-agent-runner`);
- **škálování** — jeden event-loop `svc-ai-chat` přestává stačit.

Pro **DFS / úzké hluboké** stromy zůstaň u Části A — paralelní výnos je tam malý.

## B1. Ověřený substrát (co reálně máme)

Tabulka je výsledek hloubkové analýzy kódu — žádné domněnky.

| Vrstva | Realita v kódu | Soubor | Důsledek pro B |
|---|---|---|---|
| Spuštění runu | **fire-and-respond**, `void runWorkflow(id)` → HTTP 202, in-process | `routes/reflect.ts` | spawn child = další `void runWorkflow` (zdarma) |
| Vytvoření runu | `fn_create_workflow_run(wf, input, context, story, actor)`; `context` se ukládá verbatim do `metadata.context` | RPC (baseline) | parent linkage lze nést **bez migrace** v `metadata.context.parent_run_id` |
| Spawn šablona | `kickOffReflectionWorkflow()` = `fn_create_workflow_run` → `void runWorkflow` | `lib/orchestrationBridge.ts` | přesně to, co volá `tot_fanout` × K |
| Fan-out v DB | `fn_get_next_graph_node` vrací **`candidates[]`** (všechny hrany) | baseline.sql | graf je fan-out-ready; loop dnes bere jen 1 (`break`) |
| Fan-out/join precedent | `executeParallel` — `Promise.all` + `Promise.race` timeout + merge `concatenate/best/structured`, partial-tolerant | `lib/workflowEngine.ts:664` | hotová **fold/merge** logika k převzetí |
| Suspend/resume | `batch_suspend` → `status=waiting_batch` → `WF_BATCH_RESUMER` (n8n, 5 min) → `persist_batch_result_and_resume` → `POST /reflect/runs/:id/resume-batch` | `nodes/generator.ts`, `orchestrator.ts` | **1:1 šablona pro join bariéru** |
| Rozpočet | `ai_budget(scope_type, scope_id, period)` — sdílený řádek `(story, period)`, metering `FOR UPDATE` | baseline.sql:1840 | N větví se stejným `story_id` **automaticky sdílí + serializuje** jeden $ strop |
| Parent/child schema | **neexistuje** `parent_run_id` na `ai_runs`; jediný run-pointer je `ai_batch_jobs.related_run_id` | baseline.sql:2248 | doplnit sloupec (PR 9) |
| Concurrency limiter | **neexistuje** — žádná fronta/worker/`p-limit`; single replica | — | **klíčová mezera**, řeší PR 13 |

**Závěr B1:** většina „bestie" je už poskládaná; chybí tři věci — *parent/child linkage*, *join bariéra*
(triviální přes batch šablonu) a *concurrency cap* (jediná skutečná novinka).

## B2. Cílová topologie — dirigent + flotila větví

```
                 ┌──────────────────────────────────────────────────┐
                 │   CONDUCTOR RUN  (kind=reasoning_conductor)        │
                 │   graph: reasoning-tree-conductor                  │
                 │   vlastní: globální strom state.tot, beam, rozpočet│
                 └───────┬───────────────────────────────┬───────────┘
            tot_fanout × K (fn_create_workflow_run)       ▲ tot_join (fold + prune beam)
                         │                                 │ persist_branch_results_and_resume
        ┌────────────────┼────────────────┐                │
        ▼                ▼                ▼                 │
 ┌────────────┐  ┌────────────┐  ┌────────────┐            │
 │ BRANCH RUN │  │ BRANCH RUN │  │ BRANCH RUN │  …×K        │
 │ kind=      │  │ reasoning_ │  │ parent_run │            │
 │ reasoning_ │  │ branch     │  │ _id=CONDUCT│            │
 │ branch     │  │ seed=thought│ │ wave_id=N  │            │
 │ tot_expand │  │ tot_expand │  │ tot_expand │            │
 │ tot_evaluate│ │ tot_evaluate│ │ tot_evaluate│           │
 └─────┬──────┘  └─────┬──────┘  └─────┬──────┘            │
       │  branch_result (skóre, kandidáti) → ai_runs.output │
       └────────────────┴───── all terminal? ──────────────┘
                         WF_BRANCH_JOINER (n8n, poll)
```

Tři role: **Conductor** (dirigent — drží globální strom + politiku), **Branch** (worker — prozkoumá
jeden seed thought a vrátí skórované kandidáty), **Join** (bariéra — počká na vlnu, složí výsledky,
prořeže beam, rozhodne další vlnu). Volitelně 4. vrstva: **izolovaná compute plane** (`svc-agent-runner`).

## B3. Parent/child datový model

`ai_runs` dnes parent linkage **nemá**. Dvě fáze:

- **PoC (bez migrace):** nes `parent_run_id` + `root_run_id` + `wave_id` v `metadata.context`
  (`fn_create_workflow_run` je ukládá verbatim; `parent_run_id: ctx.run.id` se už dnes thready
  v `nodes/openclaw_resolve_clow.ts`). Funguje hned, ale subtree status se musí číst přes JSONB filtr.
- **Produkce (malá migrace):** přidat dotazovatelné sloupce + index:

```sql
ALTER TABLE public.ai_runs
  ADD COLUMN parent_run_id uuid REFERENCES public.ai_runs(id),
  ADD COLUMN root_run_id   uuid REFERENCES public.ai_runs(id),
  ADD COLUMN wave_id        int;
CREATE INDEX idx_ai_runs_parent ON public.ai_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
CREATE INDEX idx_ai_runs_root_wave ON public.ai_runs(root_run_id, wave_id) WHERE root_run_id IS NOT NULL;
-- rozšířit kind allowlist v create_ai_run / fn_create_workflow_run:
--   + 'reasoning_conductor', 'reasoning_branch'
-- rozšířit status doménu o 'waiting_children' (mirror 'waiting_batch')
```

`root_run_id` = id dirigenta (pro celou flotilu), `parent_run_id` = bezprostřední rodič (pro vnořené
podstromy), `wave_id` = hladina/vlna BFS (pro join bariéru a idempotenci).

## B4. Spawn — node `tot_fanout`

Conductor node, který materializuje vlnu větví. **Reuse** `kickOffReflectionWorkflow` šablony.

- **Čte:** `state.tot.frontier` (top-`wave_width` uzlů k expanzi), `policy`.
- **Dělá:** pro každý frontier uzel zavolá `fn_create_workflow_run(reasoning-branch-reflect, input={seed_thought, path}, context={parent_run_id: run.id, root_run_id, wave_id}, story_id=…)` → dostane `branch_run_id`.
- **Dispatch režim (config `dispatch`):**

  | Režim | Mechanismus | Kdy |
  |---|---|---|
  | `inproc` | `Promise.all(ids.map(runWorkflow))` v rámci nodu | PoC, malé vlny; **bez capu** |
  | `poller` | nech větve `pending`; `WF_BRANCH_SCHEDULER` je pohání s **concurrency capem** | **produkce** (mimo event-loop dirigenta) |
  | `sandbox` | dispatch do `svc-agent-runner` (`kind=workflow-exec`, profil `kata-*`) | těžké/nedůvěryhodné větve, izolace |

- **Zapisuje:** `state_patch.tot.wave = { wave_id, branch_run_ids }`, `transition_key='fanned_out'`.
- **Suspenduje dirigenta:** vrátí nový flag `children_suspend: true` → orchestrátor parkne run jako
  `status='waiting_children'` (přesný mirror `batch_suspend`). Dirigent „nedrží" event-loop, dokud děti běží.

## B5. Join bariéra — `tot_join` + resume (1:1 batch mirror)

Protože exekuce je fire-and-respond, **nelze `await`-ovat napříč runy**. Join je proto **state-based**,
postavený doslova na batch machinery:

```
CONDUCTOR: tot_fanout spawn vlny  ──► status = waiting_children   (mirror: waiting_batch)
                                         │
BRANCHE běží paralelně, každá skončí ──► ai_runs[branch].status=completed, output=branch_result
                                         │
n8n WF_BRANCH_JOINER (scheduleTrigger 5 min, mirror WF_BATCH_RESUMER):
   POST /rpc/get_completed_branches_pending_join          (mirror get_completed_batches_pending_resume)
     → vrátí conductory ve waiting_children, jejichž VŠECHNY child(wave_id) jsou terminální
   POST /rpc/persist_branch_results_and_resume(conductor)  (mirror persist_batch_result_and_resume)
     → fold child outputs do conductor.metadata.checkpoint.state.tot, status=running, audit
   POST {SVC_AI_CHAT}/reflect/runs/{conductor}/resume-children  (mirror /resume-batch)
                                         │
CONDUCTOR resume ──► pokračuje hranou tot_fanout → tot_join
   tot_join: prořež Impossible, prune na beam_width, aktualizuj best,
             rozhodni: další vlna (tot_action='expand') | hotovo ('solved') | exhausted
```

`tot_join` **přebírá fold logiku z `executeParallel`** (merge `best`/`structured`, partial-tolerant —
chybějící/padlá větev se prostě vynechá). Idempotence: join klíčován `(root_run_id, wave_id)`.

> **Klíčový insight:** join bariéra = **přejmenovaná batch resume smyčka**. `waiting_children`↔`waiting_batch`,
> `WF_BRANCH_JOINER`↔`WF_BATCH_RESUMER`, `persist_branch_results_and_resume`↔`persist_batch_result_and_resume`,
> `/resume-children`↔`/resume-batch`. Nulové nové jádro — jen druhá instance osvědčeného vzoru.

## B6. Distribuované prohledávání — paralelní beam / BFS

| Strategie | Jak se mapuje na flotilu | Paralelní výnos |
|---|---|---|
| **BFS / beam** | hladina = **vlna** `wave_width` paralelních větví; join → prune na `beam_width` → další vlna | **vysoký** — ideální pro B |
| **best-first** | vlna = top-N uzlů z fronty podle skóre napříč hladinami (speculative) | vysoký, ale dražší |
| **DFS** | inherentně sekvenční (jedna linie) | **nízký** → nech v Části A |

Dirigent tedy dělá **synchronizovaný beam search po vlnách**: spawn `wave_width` → bariéra → prune
`beam_width` → spawn → … Backtracking = po prune zůstanou ve frontě i Maybe uzly z minulých vln;
když se vlna celá zazdí (samé Impossible), `tot_join` sáhne hlouběji do fronty (rodič/sourozenci).

## B7. Concurrency control — JEDINÁ skutečná novinka

Dnes **žádný limiter**: N větví = N necapovaných LLM smyček na jednom event-loopu. Produkční bestie
ho **musí** mít. Zavést politiku `reasoning_fleet`:

```ts
interface FleetPolicy {
  wave_width: number;            // kolik větví na vlnu (default 5)
  max_concurrent_branches: number; // tvrdý strop souběhu napříč vlnami (default 8)
  max_total_branches: number;    // strop celkem na flotilu (default 64)
  dispatch: 'inproc' | 'poller' | 'sandbox';
}
```

Vynucení **mimo event-loop dirigenta**, přes `WF_BRANCH_SCHEDULER` (n8n, mirror BATCH_RESUMER):
pohání jen tolik `pending` `reasoning_branch` runů, aby `running` ≤ `max_concurrent_branches`
(počítá přes `root_run_id`). Admission RPC `fn_admit_branch(root_run_id, max_concurrent)` → allow/defer.

**$ strop zdarma:** všechny větve sdílí `story_id` → metering jde proti **jednomu** `ai_budget(story)`
řádku `FOR UPDATE` → automaticky serializuje a zastaví flotilu (`status=blocked`), když dojde rozpočet.
Backpressure: zablokovaná větev zůstává `pending`/`blocked` a je **resumovatelná**, nic se neztratí.

## B8. Agregace stavu napříč runy

Globální strom žije **jen v dirigentovi** (`conductor.metadata.checkpoint.state.tot`). Větev je
**stateless vůči globálnímu stromu** — dostane `seed_thought` + `composed_context`, vrátí skórované
kandidáty do **svého** `ai_runs.output`/`state.branch_result`. `persist_branch_results_and_resume`
fold-uje `branch_result.best` zpět do `conductor.tot.tree`. Tím **odpadá cross-run write contention**
(větve nikdy nezapisují do cizího checkpointu).

Velikost checkpointu pod kontrolou: větev drží jen svůj podstrom; dirigent drží **kostru + nejlepší
uzly** (ne plné texty — ty zůstávají v `ai_workflow_node_runs.output_data` jednotlivých větví, plně auditní).

## B9. Failure, partial results, idempotence

- **Partial-tolerant** (jako `executeParallel`): padlá/`timeout` větev = prořezaná větev; vlna se
  uzavře s tím, co dorazilo. Žádný hard-fail celé flotily.
- **Idempotence joinu:** klíč `(root_run_id, wave_id)`; opakovaný `persist_branch_results_and_resume`
  je no-op (dirigent už `running`/dál). Dedupe větví podle `branch_run_id`.
- **Crash recovery:** dirigent i větve mají checkpoint; `waiting_children` je trvanlivý stav. Po pádu
  `svc-ai-chat` poller jen znovu detekuje hotové vlny a re-invokuje resume.
- **Zombie větve:** scheduler má TTL — větev v `running` déle než `max_node_timeout` × N → označ
  `failed`, dirigent ji ignoruje (partial).

## B10. Sjednocení dvou enginů (proč „bestie", ne dva ostrovy)

Aisha má **dva** orchestrační enginy. Bestie je nesjednocuje násilím — dává každému jeho roli:

| Engine | Charakter | Role v bestii |
|---|---|---|
| `workflowEngine.ts` (chat pipeline) | synchronní, in-request, in-run fan-out (`parallel`/`critic`/`synthesis`), **necheckpointovaný** | dárce **fold/merge** logiky (`executeParallel`) + rychlý in-run fan-out uvnitř jedné větve |
| reflection orchestrator | durable, checkpoint, resume, suspend (human/batch/children) | **dirigent** flotily + worker větve |
| `svc-agent-runner` | kontejner na request (Docker/Kata), izolace | **izolovaná compute plane** pro těžké/nedůvěryhodné větve |

Bestie = **reflection orchestrátor jako durable dirigent**, `executeParallel` merge jako fold-util,
`svc-agent-runner` jako volitelná izolovaná exekuce. Tři existující stavební kameny, jedna skladba.

## B11. Nové komponenty (souhrn) — mapování na batch machinery

| ToT branch komponenta | Existující batch ekvivalent | Náročnost |
|---|---|---|
| `status='waiting_children'` | `status='waiting_batch'` | triviální (enum) |
| node `tot_fanout` (spawn vlny) | `generator` batch dispatch (`submitBatch`) | M |
| node `tot_join` (fold + prune) | — (nový, ale fold = `executeParallel`) | M |
| `children_suspend` flag v `NodeOutput` | `batch_suspend` | triviální |
| RPC `persist_branch_results_and_resume` | `persist_batch_result_and_resume` | M (mirror) |
| RPC `get_completed_branches_pending_join` | `get_completed_batches_pending_resume` | S (mirror) |
| RPC `fn_admit_branch` (concurrency cap) | — (nový) | S |
| n8n `WF_BRANCH_JOINER` | `WF_BATCH_RESUMER` | S (mirror) |
| n8n `WF_BRANCH_SCHEDULER` (cap) | — (nový) | M |
| `/reflect/runs/:id/resume-children` | `/reflect/runs/:id/resume-batch` | S (mirror) |
| sloupce `parent_run_id`/`root_run_id`/`wave_id` | `ai_batch_jobs.related_run_id` | S (migrace) |

**8 z 11 položek je mirror existujícího kódu.** Skutečně nové: `tot_join`, `fn_admit_branch`, `WF_BRANCH_SCHEDULER`.

## B12. Conductor graph JSON — `reasoning-tree-conductor.json`

```jsonc
{
  "name": "reasoning-tree-conductor",
  "display_name": "Tree of Thoughts — distribuovaný dirigent (Část B)",
  "description": "Conductor flotily: planner → fanout(vlna K větví) → [waiting_children] → join(fold+prune beam) → další vlna | solved | exhausted. Větve běží jako child reasoning_branch runy.",
  "context": "reflection",
  "version": 1,
  "is_active": false,
  "metadata": { "mode": "deliberative", "tier": "reasoning_fleet", "owner": "platform" },
  "graph": {
    "entry": "soulforge_classify",
    "nodes": [
      { "id": "soulforge_classify", "type": "soulforge_classify", "config": {} },
      { "id": "tot_planner",  "type": "tot_planner",  "config": { "slot": "semantic", "initial_thoughts": 5,
          "policy": { "strategy": "beam", "branching_factor": 3, "beam_width": 3, "max_depth": 4 },
          "fleet":  { "wave_width": 5, "max_concurrent_branches": 8, "max_total_branches": 64, "dispatch": "poller" } } },
      { "id": "tot_fanout",   "type": "tot_fanout",   "config": { "child_workflow": "reasoning-branch-reflect" } },
      { "id": "tot_join",     "type": "tot_join",     "config": { "merge_strategy": "best", "solve_threshold": 0.85 } },
      { "id": "interrupt",    "type": "interrupt",    "config": { "channel": "in_app", "approver": "user", "reason": "tot_final_review" } },
      { "id": "hippocampus_write", "type": "hippocampus_write", "config": { "importance": "critic_score" } }
    ],
    "edges": [
      { "from": "soulforge_classify", "to": "tot_planner" },
      { "from": "tot_planner",        "to": "tot_fanout" },
      { "from": "tot_fanout",         "to": "tot_join" },
      { "from": "tot_join", "to": "tot_fanout",        "condition": "tot_action == 'expand'" },
      { "from": "tot_join", "to": "interrupt",         "condition": "tot_action == 'solved'" },
      { "from": "tot_join", "to": "hippocampus_write", "condition": "tot_action == 'exhausted'" },
      { "from": "interrupt", "to": "hippocampus_write", "condition": "approved == true" }
    ]
  }
}
```

**Child graph `reasoning-branch-reflect.json`** = oříznutá Část A (list-worker, bez fanout/join):
`entry: tot_expand → tot_evaluate` (zapíše `state.branch_result = {best, score, candidates}`, terminal).
Tj. **Varianta A se nezahazuje — stává se jednotkou práce (workerem) Části B.**

## B13. Fázový plán Části B (PR 9–14, navazuje na PR 1–8)

| PR | Obsah | Dotčené soubory | Effort |
|---|---|---|---|
| **PR 9** | Schema: `parent_run_id`/`root_run_id`/`wave_id` + indexy; `kind` reasoning_*; status `waiting_children` | migrace, `create_ai_run`/`fn_create_workflow_run`, `reflection/types.ts` | S |
| **PR 10** | `tot_fanout` (režim `inproc`) + child contract + `reasoning-branch-reflect.json` | `reflection/nodes/tot_fanout.ts`, `graphs/` | M |
| **PR 11** | `tot_join` (fold = `executeParallel` logika) + `children_suspend` + `waiting_children` suspend/resume v orchestrátoru (mirror batch) | `reflection/nodes/tot_join.ts`, `orchestrator.ts`, `types.ts` | M |
| **PR 12** | Out-of-band join: `WF_BRANCH_JOINER` + `get_completed_branches_pending_join` + `persist_branch_results_and_resume` + `/resume-children` | `n8n/workflows/`, RPC SQL, `routes/reflect.ts` | M |
| **PR 13** | **Concurrency cap** (produkční předpoklad): `WF_BRANCH_SCHEDULER` + `fn_admit_branch` + `FleetPolicy` | `n8n/workflows/`, RPC SQL | M |
| **PR 14** | `dispatch='sandbox'` přes `svc-agent-runner` (izolace) + `reasoning_fleet` budget profil + distribuovaný trace (root_run_id ↔ Langfuse) | `tot_fanout.ts`, `svc-agent-runner`, observability | L |

> **Tvrdé pořadí:** PR 13 (cap) **musí** být před jakýmkoli produkčním během `dispatch≠inproc` —
> necapovaná flotila je jediný způsob, jak dnes položit event-loop `svc-ai-chat`.

## B14. Rizika Části B

- **Necapovaná concurrency** = nejvážnější. *Mitigace:* PR 13 před produkcí; `inproc` jen v devu s malou vlnou.
- **Sytost event-loopu** dirigenta. *Mitigace:* `dispatch='poller'`/`'sandbox'` — větve neběží v procesu dirigenta.
- **Latence joinu** (poller 5 min). *Mitigace:* zkrátit interval pro reasoning; nebo „last-child-triggers-join"
  (poslední dokončená větev sama zavolá `get_completed_branches_pending_join`).
- **Write contention na checkpoint.** *Mitigace:* větve jsou stateless vůči globálnímu stromu (B8).
- **Distribuovaný debugging.** *Mitigace:* `root_run_id` korelace + Langfuse trace per větev; celý strom
  rekonstruovatelný z `ai_workflow_node_runs` napříč runy.
- **Story-budget serializace** může paralelní větve zúžit (jeden `FOR UPDATE` řádek). *Mitigace:* to je
  *žádoucí* strop; pro vyšší průtok zvyš limit, ne souběh zápisů.

## B15. Verdikt — kompletní orchestrační bestie

Část A = **mozek** (deliberace ve stromu, jeden run). Část B = **flotila** (paralelní deliberace přes
runy, řízená dirigentem). Obě stojí na **téže reflection páteři** a Část B navíc z **~80 %** recykluje
existující **batch suspend/resume** machinery — `waiting_children` je jen druhá instance `waiting_batch`.
Skutečně nové jsou tři kusy: `tot_join`, `fn_admit_branch`, `WF_BRANCH_SCHEDULER` (concurrency cap).

Doporučená evoluce: **A (single-run) → A+ (DFS/backtrack) → B-`inproc` (PoC) → B-`poller`+cap (produkce) → B-`sandbox` (izolace)**.
Nepřekročitelná podmínka produkce: **concurrency cap (PR 13)**. Zbytek je skládání dílů, které Aisha
už má hotové — přesně v duchu „je to jen o propojení toho, co Aisha zvládá by design".

---

# Část C — Otěže a výkon: Aisha jako dirigent, modely jako sval

> **Sjednocující teze.** Část A (mozek) a Část B (flotila) i **externí výkon** (Claude CLI, modely
> přes gateway/API, lokální offline modely) jsou **tentýž vzor**: jednotka delegované práce —
> **`clow`** — kterou Aisha **nasměruje** na nejvhodnější backend, **odpálí** a **složí** výsledek,
> celé pod **otěžemi** (routing + strategie + náklady + kill). Modely/agenti jsou jen **sval (hrubá
> síla)**; Aisha je **dirigent**, který je řídí i nákladově, jako svou **prodlouženou součást**.
> A nejlepší zpráva: **tyhle otěže už z velké části existují** — Část C je dotahuje a zobecňuje,
> nestaví je od nuly.

## C0. „Všechno je clow" — jeden kontrakt místo tří

Dnes vypadají tři věci odděleně: (1) LLM volání v reflection nodu, (2) ToT branch run (Část B),
(3) externí výpočet (CLI/kontejner/lokální model). **Geniálnější propojení = vidět je jako jeden
kontrakt `clow`** — deskriptor jednotky práce, který Aisha resolvuje na backend:

```ts
// clow = jednotka delegované práce (už existuje jako vstup aisha_resolve_clow_backend)
interface Clow {
  purpose: string;
  capability_tags: string[];
  task_kind: 'chat' | 'analyze' | 'report' | 'eval' | 'code' | 'deploy' | …;
  expected_tokens: number;
  deadline_hours: number;     // < 1 = urgent (sync), ≥ 24 = může batch
  max_cost_usd: number;       // strop nákladu této jednotky
  allow_batch: boolean;
  allow_local: boolean;       // smí na offline lokální model
  needs_tools: boolean;
  needs_vision: boolean;
  criticality: 'low' | 'medium' | 'high' | 'critical';
}
```

Aisha na `clow` odpoví `{ backend_kind, model_id, strategy, endpoint, score, reasoning }` — a je
jedno, jestli „sval" je cloudový model, lokální Ollama, model přes gateway, **nebo Claude CLI
v kontejneru**. Generator v Části A, branch worker v Části B i externí agent jsou **executoři za
týmž `clow` kontraktem**. Tím se tři subsystémy slévají do jednoho.

## C1. Otěže, které UŽ existují (ověřeno v kódu)

Aisha má řídicí rovinu ve **dvou čistých vrstvách** — deklarativní rozhodnutí v DB + výkon v TS:

| Otěž | Co dělá | Kde (ověřeno) |
|---|---|---|
| **Strategie** (CO) | sync vs batch, mode/slot/profile, `required_capabilities`, `estimated_cost` | `aisha_choose_execution_strategy.sql` |
| **Routing** (KTERÝ sval) | skóre `bench×0.55 + local_bonus 0.20 + cost_match×0.15 + tool×0.05 + vision×0.05`; vrací `top` + ranked `candidates[]` + `reasoning` | `aisha_resolve_clow_backend.sql` |
| **Katalog** (jaký sval je) | providers × modely × benchmarky; cena, capability, health, cost_class | `ai_provider_registry`, `ai_model_registry`, `ai_model_benchmarks` |
| **Náklady** (KOLIK) | per-user denní kvóta + per-story/partner/agent budget, **post-paid halt** runu (`status=blocked`) | `fn_check_and_consume_llm_quota_audited`, `fn_check_and_consume_ai_budget_audited` |
| **Kill** (STOP) | tvrdé zastavení runu/tasku/agenta, idempotentní, auditované | `cancel_ai_run`, `cancel_ai_task`, `cancel_agent_run` |
| **Výkon** (dispatch) | `state.clow_backend` → `generator` → `unifiedChat` → `BackendRegistry` (health, circuit breaker 3→open 60 s, fallback ×3) | `nodes/openclaw_resolve_clow.ts`, `generator.ts`, `lib/{llmRouter,backendRegistry}.ts` |
| **Governance** | volba modelu = autorita `model_heuristic` (nepřebije core_values/compliance); každá volba + dispatch auditní | `lib/decisionProvenance.ts` |

> **Pozn.:** `LLM_GATEWAY_DISPATCH_INVARIANTS.md` značí wire resolver→executor jako rozbitý, ale kód
> ho už má hotový — `generator.ts` čte `state.clow_backend` (`mapBackendKindToProvider`) a `llmRouter`
> má provider `'gateway'`. **Invariants doc je v tomto bodě zastaralý**; otěže routingu jsou živé.

**`backend_kind` dnes** (CHECK v `ai_provider_registry.sql`): `direct_cloud`, `llm_gateway`,
`local_ollama`, `local_vllm`, `mcp_server`. Část C k tomu přidá **executor kinds** (níže).

## C2. Sjednocená abstrakce — Executor plane

Jedno rozhraní, mnoho svalů. Executor = „dostane resolvovaný backend + clow, vrátí výsledek + náklady".

```
                  ┌──────────── AISHA — DIRIGENT (otěže) ────────────┐
   clow ─────────▶│  CO:    aisha_choose_execution_strategy           │
  {purpose,caps,  │  KTERÝ: aisha_resolve_clow_backend (skóre+reason) │
   tokens,deadline│  KOLIK: quota + ai_budget gate (halt) + cancel    │
   max_cost,…}    │  PROČ:  decisionProvenance + audit_journal         │
                  └───────────────────────┬──────────────────────────┘
            resolved = {backend_kind, model_id, strategy, endpoint_url, auth_env_var}
   ┌───────────────┬───────────────┬───────────────┬───────────────┬───────────────┐
   ▼               ▼               ▼               ▼               ▼               ▼
 llm_sync       llm_batch       local_*        agent_container   mcp_server      (gateway
 direct_cloud   (−50 %,         ollama/vllm/   svc-agent-runner: model         agent přes
 / llm_gateway  defer,          MLX — OFFLINE   claude_cli /      přes MCP       llmgateway.io
 (cloud/proxy)  waiting_batch)  no-cloud        repo-agent        server         upstream)
   └───────────────┴───────────────┴───────────────┴───────────────┴───────────────┘
                       „SVAL" / hrubá síla  ──  výsledek + tokeny/cost → zpět pod otěže
```

| Executor kind | Co je „sval" | Dispatch cesta | Stav |
|---|---|---|---|
| `direct_cloud` (sync) | Anthropic/OpenAI/Google přímo | `unifiedChat` → provider | ✅ produkční |
| `llm_gateway` | theopenco/llmgateway proxy (gateway.backend.id3a.cz) — fronts cloud BYOK + llmgateway.io upstream (xAI/DeepSeek/Mistral/Together/OpenRouter) | `unifiedChat({provider:'gateway'})` | ✅ kód hotov, v hot-path obcházen |
| `llm_batch` | Anthropic/OpenAI Batch API (−50 %) | `submitBatch` → `waiting_batch` → poller | ✅ jen direct cloud; gateway/local batch = TODO |
| `local_ollama` / `local_vllm` | Ollama :11434 / vLLM :8100 / Docker MR :12434 / MLX — **offline** | `unifiedChat` → local URL; `+0.20` skóre když `allow_local` | ✅ kód hotov, v prod dormantní |
| `agent_container` *(nový)* | `svc-agent-runner` kontejner (docker / kata-firecracker / kata-dragonball) | `enqueue_agent_run` → kontejner → `agent_runs` lifecycle | ⚠️ plane existuje (jen `plugin-exec` image); kind net-new |
| `claude_cli` *(nový)* | `@anthropic-ai/claude-code` headless nad mountnutým repem v kontejneru | `agent_container` + image `Dockerfile.claude-cli` | ❌ net-new (nikde se dnes nespouští) |
| `mcp_server` | model/nástroj přes MCP server | MCP klient | ✅ kind existuje |

## C3. Externí „sval" — Claude CLI a agenti přes gateway/API

**Stav (ověřeno):** žádný proces dnes nespouští Claude/Codex/Aider CLI jako executor. Aisha dnes
Claude Code jen (a) **konfiguruje** (generuje `CLAUDE.md`/`.cursorrules` přes `svc-ide-context` +
`aisha-ide-bridge`) a (b) **dohlíží** (advisory hooky `.claude/hooks/*` → `/dirigent/dispatch`).
Claude CLI jako **výkon, který Aisha odpaluje**, je tedy **net-new** — ale plane pro něj existuje.

**Návrh (minimální delta, využívá hotový seam):**

1. **Rozšířit `backend_kind`** o `agent_container` (a logický pod-druh `claude_cli`) v CHECK
   `ai_provider_registry` → `aisha_resolve_clow_backend` umí **ranknout kontejnerového agenta vedle
   LLM** beze změny skórování (health/cost/capability/`allow_local`). Přidat řádek do registru
   (`slug='claude-cli'`, `endpoint_url=svc-agent-runner`, `auth_env_var=ANTHROPIC_API_KEY`).
2. **Image `Dockerfile.claude-cli`** (sourozenec `images/plugin-exec/`) — spouští `claude-code`
   headless nad mountnutým repem; read-only rootfs, `CapDrop ALL`, kata profil pro izolaci.
3. **Jeden dispatch branch + jeden reflection node `clow_dispatch`** (viz C6): když `top.backend_kind`
   je executor kind, místo `unifiedChat` zavolá `svc-agent-runner POST /runs` (kind `repo-agent`,
   image `claude-cli`) a **joinuje na `agent_runs` lifecycle** přesně jako Část B joinuje child runy.
4. **Cost capture (kritické pro otěže):** Claude CLI utrácí na `ANTHROPIC_API_KEY` **mimo** per-node
   metering Aishy. Nutno **odečíst usage z výstupu CLI** (`claude-code` reportuje tokeny) a poslat do
   `appendCost` + budget gate. Bez toho je externí sval **slepé místo nákladů**.

**Agenti přes gateway/API:** `llm_gateway` už fronts xAI/DeepSeek/Mistral/Together/OpenRouter (přes
llmgateway.io upstream, ~20–40 % levněji). Přidat „další model/agent" = **řádek v registru**; Aisha
ho začne routovat podle skóre. Žádný nový kód.

## C4. Offline režim — tři významy „offline"

| Význam | Mechanismus (ověřeno) | Stav | Co dotáhnout |
|---|---|---|---|
| **Lokální výpočet** (no-cloud) | `AISHA_EXECUTION_MODE=local` → `resolveBackends` zahodí cloud; Ollama/vLLM/MLX; `+0.20` lokální bonus | ⚠️ kód hotov, v prod **dormantní** (`.env.local.dev` only) | zapnout v prod presetu |
| **Deferred / batch** (grind přes noc) | `deadline≥24 h & tokens≥50 k & ¬chat & ¬critical` → `strategy='batch'` (−50 %), `waiting_batch`, n8n poller | ✅ direct cloud | gateway/local batch passthrough |
| **Headless flotila** (bestie bez člověka) | Část B: conductor + branch runy hnané n8n pollery, žádné live HTTP | 🆕 (Část B) | concurrency cap (PR 13) |

`hybrid` mód (lokální pro jednoduché, cloud pro těžké) je střední cesta — šetří cloud tokeny na
levných `clow` a drží kvalitu na těžkých. Otěže (budget/cancel) platí ve všech třech režimech stejně.

## C5. Otěže do hloubky — 4 + 1

1. **Routing reins** — `aisha_resolve_clow_backend` (který sval; transparentní skóre + fallback list).
2. **Strategy reins** — `aisha_choose_execution_strategy` (sync/batch/offline; mode/slot/profile).
3. **Cost reins** — kvóta + budget gate (auto-halt na hranici uzlu). **Mezera:** dnes **post-paid**
   (zastaví *další* uzel) → doplnit **prediktivní admission** (odhad `expected_tokens × price_per_m`
   z `ai_model_registry` *před* dispatchem; tvrdě odmítnout `clow` nad `max_cost_usd`/`budget_remaining`).
4. **Lifecycle reins** — spawn (`fn_create_workflow_run` / `enqueue_agent_run`), suspend/resume
   (`waiting_batch`/`waiting_children`), kill (`cancel_ai_run`/`cancel_agent_run`). **Mezera:** kill
   dnes překlopí jen DB status, **nepřeruší běžící HTTP** → doplnit **kooperativní abort token**
   (run `canceled` → `AbortSignal` do `OpenAICompatBackend` / `docker stop` kontejneru).
5. **Governance reins** — `decisionProvenance` (volba svalu = `model_heuristic`, nepřebije
   core_values/compliance) + plný audit každé resoluce a dispatche.

## C6. Geniálnější propojení = zjednodušení

Tři konkrétní zjednodušení, která z toho dělají jednu elegantní skladbu místo zoo:

- **Jeden dispatch node místo mnoha backend-specifických.** Dnes `generator`, `tot_expand`,
  `openclaw_sandbox`… každý drží vlastní cestu k backendu. Zavést **`clow_dispatch`** — node, který
  *vždy* zavolá `resolve_clow_backend` a odpálí na vítězný sval (LLM sync/batch / local / container /
  CLI). `generator` = `clow_dispatch(executor=llm)`; `tot_expand` = `clow_dispatch × k`. **Méně typů
  nodů, víc reuse, jediné místo, kde se drží otěže.**
- **Dva enginy → jedno dělení rolí (ne merge kódu).** `workflowEngine.ts` zůstává pro synchronní
  in-request chat (fan-out `parallel`/`synthesis`); reflection orchestrátor = **durable dirigent**
  pro vše deliberativní/flotilové/externí. Oba konzumují **tutéž** clow-resoluci a **tytéž** otěže.
- **Externí výkon není nový subsystém — jsou to 3 položky:** executor `backend_kind` + jeden dispatch
  branch + jeden node. Plane (`agent_runs`), resolver (`resolve_clow_backend`) i node-kontrakt
  (`state_patch`/`transition_key`) **už fungují** — jen se propojí dvě dnes oddělené roviny
  (reflection ⇄ svc-agent-runner).

## C7. Mapa nových komponent → existující precedent

| Nová věc (Část C) | Staví na | Náročnost |
|---|---|---|
| `backend_kind` `agent_container`/`claude_cli` | rozšíření CHECK `ai_provider_registry` (jako přidání providera) | S |
| image `Dockerfile.claude-cli` | `images/plugin-exec/` (read-only, kata, broker) | M |
| node `clow_dispatch` (executor-agnostic) | generalizace `generator` + `openclaw_resolve_clow` | M |
| dispatch branch → `svc-agent-runner` | `enqueue_agent_run` + `agent_runs` lifecycle + join (jako Část B) | M |
| capture CLI usage → `appendCost` | existující cost aggregation (`checkpointer.appendCost`) | S |
| prediktivní cost admission | rozšíření `aisha_resolve_clow_backend` (tvrdý gate na `max_cost`) | S |
| kooperativní abort | rozšíření `cancel_ai_run` + `AbortSignal` v backendu | M |
| offline v prod | `AISHA_EXECUTION_MODE=local` v prod-capable presetu | S |

**6 z 8 položek je rozšíření existujícího kódu.** Skutečně nové: `Dockerfile.claude-cli` image a
propojení reflection ⇄ agent-runner.

## C8. Fázový plán Část C (PR 15–20)

| PR | Obsah | Dotčené | Effort |
|---|---|---|---|
| **PR 15** | Dotáhnout/ověřit wire resolver→executor (invariants doc) — otěže routingu autoritativní pro **veškerý** dispatch; smazat zastaralé `notes` | `generator.ts`, `llmRouter.ts`, seed | S |
| **PR 16** | Node `clow_dispatch` (executor-agnostic) — sjednotí LLM dispatch | `reflection/nodes/clow_dispatch.ts` | M |
| **PR 17** | Executor `backend_kind` (`agent_container`/`claude_cli`) + registry řádky + `Dockerfile.claude-cli` | `ai_provider_registry.sql`, `images/claude-cli/` | M |
| **PR 18** | Propojit reflection ⇄ `svc-agent-runner` (dispatch branch + join na `agent_runs`) + capture CLI usage → `appendCost` | `clow_dispatch.ts`, `svc-agent-runner`, `checkpointer.ts` | L |
| **PR 19** | Prediktivní cost admission (pre-flight veto) + kooperativní abort (mid-call kill) | `aisha_resolve_clow_backend.sql`, `backendRegistry.ts`, `cancel_ai_run.sql` | M |
| **PR 20** | Offline prod preset (`AISHA_EXECUTION_MODE=local`) + gateway/local batch passthrough | `config/`, gateway daemon | M |

## C9. Rizika Část C

- **Slepé místo nákladů u externího CLI** — Claude CLI utrácí mimo per-node metering. *Mitigace:* PR 18
  capture usage → `appendCost`; bez toho otěže nákladů na CLI **neplatí**.
- **Tajemství v repu** — `AISHA_LLM_GATEWAY_KEY` je commitnutý v `.env.coolify`, což **porušuje vlastní
  pravidlo „No Secrets in Code"** (CLAUDE.md). *Mitigace:* rotovat klíč, přesunout do secret store.
- **Gateway obcházen v hot-path** → jeho per-token metering/observability nepokrývá přímá volání.
  *Rozhodnutí:* buď je gateway jediný metering chokepoint (routing change), nebo metering zůstává v DB gate.
- **Kvalita lokálních modelů** závisí na `ai_model_benchmarks` (`overall_score` default 0.5 bez řádku →
  routing degraduje). *Mitigace:* běžící eval pipeline před produkčním offline.
- **Izolace CLI executoru** — spouští kód nad repem. *Mitigace:* kata-firecracker profil + read-only +
  budget cap + `max_total_branches`.

## C10. Verdikt — kompletní orchestrační bestie pod otěžemi

Aisha **už je dirigent**: otěže routingu (`resolve_clow_backend`), strategie
(`choose_execution_strategy`), nákladů (quota + budget gate + `cancel_ai_run`) i výkonu
(`clow_backend` → `unifiedChat` → `BackendRegistry`) **existují a jsou auditované**. Část C dělá čtyři
věci, vesměs rozšířením, ne stavbou:

1. **Zobecní `clow`** na libovolný executor — LLM sync/batch, lokální offline, model přes gateway,
   **Claude CLI / kontejner** — za jedním kontraktem.
2. **Propojí** dvě dnes oddělené roviny (reflection ⇄ `svc-agent-runner`), aby branch worker mohl být
   externí sval.
3. **Dotáhne otěže nákladů na externí sval** — capture usage, prediktivní admission, kooperativní abort.
4. **Zapne offline** (lokální modely v prod, batch passthrough).

Genius zjednodušení: **jeden kontrakt (`clow`) + jeden dispatch node + mnoho svalů, vše pod jedněmi
otěžemi.** Aisha řídí cloud i lokální modely, batch i CLI agenty jako svou **prodlouženou součást** —
a protože sval je zaměnitelný, drží **kvalitu i náklady** tam, kde je potřeba. Přesně v duchu
„je to jen o propojení toho, co Aisha zvládá by design".

# Část D — Adaptivní samo-orchestrace: Aisha řídí sval podle měnících se proměnných

> **Teze.** Otěže (Část C) nesmí být **statické**. Aisha má **měřit sebe** (testy, evaly, produkční
> telemetrie, zkušenost), **aktualizovat routing signály** a **příště volit líp** — a kde to dává
> smysl, **čerpat z vlastních (lokálních) zdrojů i výkonových**. Klíč: **většina téhle samoučící
> smyčky už v kódu existuje** (`insert_model_benchmark` + `get_adaptive_model_tiers` +
> `aisha_resolve_clow_backend` + health/circuit-breaker). Část D ji **uzavírá, zapíná a zdynamičťuje** —
> nestaví ji od nuly.

## D0. Co znamená „Aisha orchestruje sama"

Tři úrovně autonomie, všechny postavené na **měnících se proměnných**, ne na pevném env:

1. **Učení z měření** — výběr modelu/backendu se řídí *naměřenou* kvalitou × cenou × latencí ×
   spolehlivostí (per `task_type`), ne natvrdo. Když se čísla změní, změní se i volba.
2. **Dynamický režim** — `local` / `hybrid` / `cloud` se rozhoduje **per `clow`** podle aktuálního
   rozpočtu, zdraví a kapacity lokálu, ne globálním `AISHA_EXECUTION_MODE`.
3. **Preference vlastních zdrojů** — když je lokální výkon dostupný, volný a *dost dobrý*, Aisha ho
   upřednostní (úspora i soběstačnost) — ale **důkazně** (podle benchmarku), ne slepě.

## D1. Samoučící smyčka, která UŽ existuje (ověřeno v kódu)

```
        ┌────────────────────── MĚŘENÍ (signály) ──────────────────────┐
        │ ai_workflow_node_runs (tokeny/latence/cost/success per uzel)  │
        │ evaluate.ts → ai_eval_results (LLM-as-judge: faithfulness…)   │
        │ ai_provider_registry.last_health_status + circuit breaker     │
        │ learnings / hippocampus / faithfulness trend / drift_state    │
        └───────────────────────────────┬──────────────────────────────┘
                       WF_MODEL_BENCHMAK (n8n) agreguje  │  insert_model_benchmark()
                                                          ▼
        ┌──────────────────────── SIGNÁL STORE ─────────────────────────┐
        │ ai_model_benchmarks (overall_score, latency, avg_cost_per_call,│
        │   success/timeout/error_rate, sample_count) per (model×task)   │
        │ ai_model_registry (latest_eval_score, pricing, slot_affinity)  │
        └───────────────────────────────┬──────────────────────────────┘
                                         ▼  čtou adaptivní rozhodovače
        ┌──────────────────────── ROZHODNUTÍ ───────────────────────────┐
        │ get_adaptive_model_tiers (2 fáze: benchmark / heuristika)      │
        │ aisha_resolve_clow_backend (bench 55 % + local 20 % + cost …)  │
        │ aisha_choose_execution_strategy (sync/batch)                   │
        └───────────────────────────────┬──────────────────────────────┘
                                         ▼
                          DISPATCH → SVAL → výsledek ──┐
                                         ▲              │  (zpět nahoru jako nové měření)
                                         └──────────────┘
```

| Článek smyčky | Co dělá | Soubor (ověřeno) | Stav |
|---|---|---|---|
| **Writer signálů** | upsert `ai_model_benchmarks` per (model × task_type × eval_run) — kvalita, latence, **cost/call**, success/timeout/error, `sample_count` | `insert_model_benchmark.sql` | ✅ existuje |
| **Měřicí WF** | n8n benchmark workflow → volá `insert_model_benchmark` | `n8n/workflows/WF_MODEL_BENCHMARK.json` | ✅ existuje |
| **Adaptivní tiery** | 2-fázový výběr: **Fáze A** z benchmarků (greeting=nejlevnější se `score≥0.6`, moderate=`score×0.6−cost×0.4`, complex=nejvyšší kvalita, deep=nejlepší reasoning); **Fáze B** heuristika dle ceny (cold-start) | `get_adaptive_model_tiers.sql` | ✅ existuje |
| **Resolver** | skóre `bench×0.55 + local 0.20 + cost 0.15 + tool/vision`; benchmark je dominantní signál | `aisha_resolve_clow_backend.sql` | ✅ existuje |
| **Scorer / pre-post** | per (provider×model) skóre + health + success_rate — pro admin a porovnání před/po update | `aisha_evaluate_provider_for_task.sql` | ✅ existuje |
| **Živá adaptace** | health probe (`last_health_status`, `consecutive_failure_count`) + circuit breaker (3 selhání → open 60 s) | `ai_provider_registry`, `lib/backendRegistry.ts` | ✅ existuje |
| **Zkušenost** | learnings/hippocampus, faithfulness trend, drift; návrhy přes `improvement_proposals` + risk gate (low=auto, high=human) | `lib/hippocampus.ts`, `STORY_SELF_EVALUATION_LOOP.md` | ⚠️ částečně |

**Tj. kostra je hotová:** měření → `insert_model_benchmark` → `ai_model_benchmarks` →
`get_adaptive_model_tiers`/resolver → dispatch. Když se model zlepší/zlevní/zrychlí, routing se
**sám** posune. To je přesně „orchestrace dle měnících se proměnných".

## D2. Kde je smyčka OTEVŘENÁ (tři mezery k zapnutí)

1. **Feeder z produkce není kontinuální.** Benchmarky plní *explicitní* `WF_MODEL_BENCHMARK`, ne
   průběžná agregace z reálných běhů (`ai_workflow_node_runs` má tokeny/latenci/cost/success
   u **každého** uzlu; `ai_eval_results` má kvalitu). → **Chybí agregátor „produkční telemetrie →
   `insert_model_benchmark`"** (rolling window + EWMA), aby se Aisha učila z *každodenního provozu*,
   ne jen z benchmark běhů.
2. **Execution mode je statický.** `getExecutionMode()` čte jen `AISHA_EXECUTION_MODE` (`local|hybrid|cloud`,
   default `cloud`). → **Chybí per-`clow` dynamické rozhodnutí** režimu z aktuálních signálů.
3. **Preference vlastních zdrojů je konstanta.** Local bonus `+0.20` je natvrdo a Aisha zná jen
   *dosažitelnost* lokálu (health probe), ne jeho **zátěž/volnou kapacitu**. → **Chybí (a)** signál
   spare-capacity (GPU/queue) a **(b)** adaptivní bonus podle zdraví/zátěže/rozpočtu/kvality.

## D3. Návrh: uzavřená adaptivní smyčka (measure → learn → route → prefer-own)

- **Measure (existuje):** každý node run loguje tokeny/latenci/cost/success do `ai_workflow_node_runs`;
  eval (faithfulness) do `ai_eval_results`.
- **Aggregate (nové, malé):** periodický job (n8n, sourozenec `WF_MODEL_BENCHMARK`) agreguje per
  (model, task_type) z produkční telemetrie → `insert_model_benchmark` s **rolling window + EWMA**
  (čerstvé vzorky váží víc; starý výkon se „zapomíná"). Tím se *zkušenost* stává routing signálem **automaticky**.
- **Learn/route (existuje):** `get_adaptive_model_tiers` + resolver okamžitě posunou volbu k měřenému
  optimu (kvalita × cena × latence × success).
- **Prefer-own (nové):** `local_bonus = base + f(budget_pressure) + f(idle_capacity)`, **ale jen když**
  `local_benchmark(task_type) ≥ quality_floor` — neobětovat kvalitu. Aisha tak „čerpá z vlastního
  výkonu, kde to jde", **důkazně**.
- **Explore/exploit (nové):** ε-greedy — občas (malé ε, jen u `criticality=low`) zkus podreprezentovaný
  model/lokál, aby narostl `sample_count` a benchmark byl statisticky platný; jinak exploituj nejlepší.
  **„Průzkum" se tím stává řízenou součástí orchestrace.**
- **Govern (existuje + napojit):** změny routingu/tierů jdou přes `improvement_proposals` s risk gate
  (low → auto-apply, high → human); `decisionProvenance` autorita; core_values guardrails. Aisha nikdy
  nepřebije compliance ani quality_floor.

## D4. Dynamický execution mode (per-clow, ne globální env)

Nahradit statický `getExecutionMode()` funkcí **`aisha_decide_execution_mode(clow, signals)`** →
`local | hybrid | cloud` **per `clow`**:

| Situace (signály) | Rozhodnutí |
|---|---|
| `budget_pressure` vysoký **a** lokál `healthy` **a** `local_benchmark ≥ floor` | **local** (šetři, čerpej vlastní výkon) |
| `criticality` high/critical **nebo** potřeba špičkové kvality/nástrojů | **cloud** (kvalita > cena) |
| jinak | **hybrid** — levné `clow` na lokál, těžké na cloud |

`AISHA_EXECUTION_MODE` zůstává jako **strop/override** (governance „nikdy do cloudu" / „jen lokál"),
ale **default = adaptivní** rozhodnutí. Tao/core_values mohou mód tvrdě omezit (např. citlivá data → `local`).

## D5. Preference vlastních zdrojů („čerpat z vlastních zdrojů i výkonových")

- **Dostupnost lokálu** = health probe (existuje: `last_health_status`).
- **Volná kapacita** = **mezera** → lehký `/metrics` z lokálního serveru (vLLM/Ollama: queue depth,
  GPU volné) → `ai_provider_registry.spare_capacity`. Tím Aisha pozná nejen „lokál žije", ale „lokál
  má teď volno".
- **Adaptivní bonus** = `base + budget_pressure_term + idle_capacity_term`, gated `quality_floor` na
  `task_type`. Výsledek: čím dražší cloud / volnější vlastní GPU / nižší rozpočet, tím víc Aisha tlačí
  na vlastní výkon — **ale jen dokud kvalita drží**.
- **Soběstačnost:** v `local` módu (D4) běží celá smyčka bez cloudu; otěže (budget/cancel/audit) platí stejně.

## D6. Tři otěžové fixy — konkrétně (akční, ne jen riziko)

1. **CLI usage capture (slepé místo).** `claude-code` reportuje `usage` (tokeny) ve výstupu →
   v dispatch branchi (Část C) ho **parsovat → `appendCost` + budget gate**. Bez toho útrata CLI
   *neexistuje* pro otěže nákladů. *Akce:* PR — `clow_dispatch` čte usage z `agent_runs.output`,
   přičte do `ai_runs.cost_total_json` a metruje proti `ai_budget`.
2. **Prediktivní admission + kooperativní abort (post-paid kill).**
   - *Admission (pre-paid pro velké uzly):* `fn_admit_clow(clow, resolved)` odhadne
     `expected_tokens × price_per_m` z `ai_model_registry` a **tvrdě odmítne PŘED dispatchem**, když
     překročí `max_cost_usd` / `budget_remaining`. Mění dnešní *post-paid* (zastaví *další* uzel) na
     *pre-paid* tam, kde jeden uzel může přestřelit.
   - *Abort (skutečné přerušení):* `cancel_ai_run` dnes překlopí jen DB status. Doplnit **kooperativní
     cancellation token** → `AbortSignal` do `OpenAICompatBackend` (zruší běžící HTTP) a `docker stop`
     pro kontejnerový executor. Poller čte `status='canceled'` → odpálí abort.
3. **Tajemství v repu (governance).** `AISHA_LLM_GATEWAY_KEY` je commitnutý v `.env.coolify` →
   **porušuje vlastní pravidlo „No Secrets in Code"** (CLAUDE.md). *Akce:* **rotovat klíč**, přesunout
   do secret store (Coolify secrets / Vault), přidat vzor do `.gitleaks.toml` + `.gitignore`, gate test,
   který selže při commitnutém `*_KEY=` v `.env.*`.

## D7. Fázový plán Část D (PR 21–26)

| PR | Obsah | Dotčené | Effort |
|---|---|---|---|
| **PR 21** | Agregátor produkční telemetrie → `insert_model_benchmark` (rolling window + EWMA); n8n sourozenec `WF_MODEL_BENCHMARK` | `n8n/workflows/`, RPC SQL, `ai_workflow_node_runs`/`ai_eval_results` | M |
| **PR 22** | Spare-capacity signál (lokální `/metrics` → `ai_provider_registry.spare_capacity`) + adaptivní `local_bonus` v resolveru s `quality_floor` | `ai_provider_registry.sql`, `aisha_resolve_clow_backend.sql`, probe | M |
| **PR 23** | `aisha_decide_execution_mode(clow, signals)` — dynamický mód per-clow; env jako override | nový RPC, `executionMode.ts`, `orchestrationBridge.ts` | M |
| **PR 24** | ε-greedy explorer (balancuje `sample_count`) + auto-apply low-risk routing přes `improvement_proposals` + rollback na regresi | resolver, `improvement_proposals`, self-eval PR 5 | L |
| **PR 25** | **3 otěžové fixy** — CLI usage capture, `fn_admit_clow` admission, kooperativní abort, rotace secretu | `clow_dispatch.ts`, `backendRegistry.ts`, `cancel_ai_run.sql`, `.gitleaks.toml` | M |
| **PR 26** | Guardrails autonomie — `quality_floor`, budget ceiling, hysteréze proti oscilaci, audit každé změny routingu | resolver, `decisionProvenance`, gate testy | M |

## D8. Rizika Část D

- **Oscilace routingu** (feedback nestabilita) — *mitigace:* EWMA + hysteréze + `min sample_count` než se signál „uzná".
- **Cena průzkumu** (ε zkouší slabší modely) — *mitigace:* malé ε, jen `criticality=low`, strop útraty na exploration.
- **Degradace kvality lokálem** — *mitigace:* tvrdý `quality_floor` per `task_type`; pod ním se lokál nevybere ani při tlaku na rozpočet.
- **Auto-apply routingu bez dohledu** — *mitigace:* risk gate (low auto / high human) + rollback na regresi (napojení na self-eval „measure outcome", PR 5) + plný audit.
- **Cold-start** (žádné benchmarky) — *už řešeno:* `get_adaptive_model_tiers` Fáze B (heuristika dle ceny).
- **Capacity signál nepřesný** — *mitigace:* fail-safe na health probe; spare-capacity je jen *bonus*, ne tvrdá podmínka.

## D9. Verdikt — Aisha jako sebeřídící dirigent

Aisha **už má adaptivní kostru**: `insert_model_benchmark` (zapisuje naměřené signály),
`get_adaptive_model_tiers` (2-fázově volí dle benchmarků), `aisha_resolve_clow_backend` (benchmark =
55 % skóre) a health/circuit-breaker (živá adaptace). Část D tuhle smyčku **uzavírá a zapíná**:

1. **Kontinuální feeder** z produkční telemetrie → benchmarky (učení z každodenního provozu).
2. **Dynamický režim** per-`clow` (`local`/`hybrid`/`cloud`) z rozpočtu, zdraví a kapacity.
3. **Evidence-based preference vlastních zdrojů** — lokální výkon, kde je volný a dost dobrý.
4. **Explore/exploit** — řízený průzkum, aby se signály udržely platné.
5. **3 otěžové fixy** — CLI usage capture, prediktivní admission + kooperativní abort, rotace secretu.

Výsledek: Aisha **řídí výběr výkonu — cloudového i vlastního — sama, podle měnících se proměnných
z testů, evalů a zkušeností, kvalitně i nákladově.** A protože kostra existuje, je to z velké části
**zapnutí a uzavření smyčky**, ne nová stavba — přesně „propojit to, co Aisha už zvládá by design".

# Část E — Transparentnost a důkaz: vidět dovnitř, porovnat, dokázat učení

> **Teze.** Aby šlo otěžím (C) a samoučení (D) **věřit**, musí být tři věci viditelné a dokazatelné:
> (1) **co je za co jak** — který executor/model/backend udělal který krok, **proč** (autorita +
> důvod) a **za kolik**; (2) **vidět dovnitř** — strom vč. prořezaných větví, flotila, rozhodnutí,
> náklady; (3) **dokázat učení** — brát výstupy, analyzovat je a ukázat **before/after** (a kauzálně
> přes champion/challenger). **Data plane je ~80 % hotová** — chybí hlavně **read-side surfacing**.

## E0. Mění Aisha výsledek? Ano — a musí to být vidět

Aisha **mění výsledek** na dvou místech: (a) **ToT** mění, *která větev* vyhraje (Část A/B);
(b) **adaptivní routing** mění, *který model/backend* odpověď vyrobí (Část C/D). Obojí je dnes
**zaznamenané, ale málo zobrazené**. Část E z dat, která už tečou, udělá **atribuci + inspekci + důkaz**.

## E1. Atribuce „co je za co jak" — co už existuje

| Signál | Co nese | Soubor / objekt | Stav |
|---|---|---|---|
| **Per-krok běh** | input/output/tokeny/`transition_key`/čas, **vč. selhaných/prořezaných** uzlů | `ai_workflow_node_runs` | ✅ zapisuje se |
| **Rozhodnutí (proč)** | chosen-vs-used, **autorita** (hierarchie), důvod, co přebilo | `lib/decisionProvenance.ts` (`provenanceSummary`) | ⚠️ **jen v paměti**, neperzistuje |
| **Event stream** | 35 typů (`llm_call`, `route_decision`, `parallel_fanout`, `critic_review`, `escalation`…), cost/tokeny per call | `ai_trace_events` (**participant RLS**) | ✅ zapisuje se |
| **Náklad** | per-run `total_usd`, per-model/per-agent, per-event | `ai_runs.cost_total_json`, `lib/costAggregator.ts`, `ai_trace_events.cost_json` | ✅ zapisuje se |
| **Trace** | OTel→Langfuse + app-level generations (tokeny/latence per LLM call) | `packages/observability`, `lib/tracer.ts` | ✅ `langfuse_trace_id` na `agent_runs` (ne na `ai_runs`) |

## E2. „Vidět dovnitř" — co uživatel dnes vidí vs. co chybí

**Vidí dnes:** `StoryTimeline.tsx` (participant — agent/status/`duration`/`cost_usd`/`files_changed` + link
na run), `AdminAiRunDetail.tsx` (per-run **plochá** timeline z `ai_trace_events`), `AdminAiObservability.tsx`
(flotila — per-agent cost/latence/error z `ai_agent_metrics_hourly`), `StoryFaithfulnessSparkline.tsx`.

**Chybí (read-side):**

1. **Vizualizace stromu** — nic nečte `ai_workflow_node_runs` + graf a nevykreslí strom s **prořezanými
   větvemi** a hranami; dnes jen plochý seznam eventů.
2. **Persistovaný `decisionProvenance`** — „proč model X, autorita Y, co přebil" existuje jen v paměti
   na výsledku enginu, není dotazovatelné ani zobrazené.
3. **Pohled na flotilu** (Část B) — `parallel_fanout` eventy jsou v datech, ale chybí UI „které větve
   běžely souběžně, která vyhrála".
4. **First-class atribuce modelu+backendu** — `ai_trace_events` nemá sloupce `model_id`/`backend_kind`;
   „$X · model Y · via Z" se nedá spolehlivě vykreslit.
5. **User-reachable run-tree endpoint** — `GET /reflect/runs/:id` je service-role + jen summary;
   `get_workflow_run_nodes_admin` je admin-only a **strhává** input/output.

## E3. Důkaz učení — co už existuje

| Mechanismus | Co dokazuje | Soubor | Stav |
|---|---|---|---|
| **Historie benchmarků** | naměřená kvalita/cena/latence/success per (model×task), **timestamp** = before/after | `ai_model_benchmarks` | ✅ |
| **Pre/post scorer** | per (provider×model) skóre + důvod; staví pro porovnání před/po | `aisha_evaluate_provider_for_task` | ✅ |
| **Learning→routing** | Fáze A volí dle benchmarků → učení je vidět jako **posun routingu** | `get_adaptive_model_tiers` | ✅ |
| **Outcome návrhu** | `score_before`/`score_after`/`delta`/`regressed` po aplikaci změny + gated rollback | `fn_record_proposal_outcome` | ✅ |
| **Regrese baseline** | latest vs 7denní průměr, severity ok/warning/critical | `fn_detect_rag_baseline_regression` + `WF_RAG_EVAL_NIGHTLY` | ✅ |
| **Trend/maturita** | faithfulness trend; 30denní maturity (novice→expert) | `fn_list_story_faithfulness_trend`, `get_story_aisha_maturity` | ✅ |
| **Concurrent A/B** | kauzální důkaz „změna *způsobila* zlepšení" (ne jen korelace) | — | ❌ **chybí** |

## E4. Návrh „vidět dovnitř" — 4 read-side přídavky (reuse existujících dat)

1. **`fn_get_run_tree(run_id)`** — vrátí `ai_workflow_node_runs` (vč. input/output, **PII redakce**)
   joinuté na `ai_workflow_definitions.graph`; **participant RLS** (zrcadlí `story_timeline`). UI vykreslí
   strom přes `transition_key` + hrany; `status='failed'`/nenavštívené = **šedé (prořezané)**;
   `parallel_fanout` potomci = **flotila**.
2. **Perzistovat `decisionProvenance`** — tabulka `decision_provenance` (nebo `provenance` JSONB na
   `ai_runs`) zapsaná z `provenanceSummary` + read RPC + panel „rozhodnutí → hodnota → autorita → důvod → co přebilo".
3. **First-class atribuce** — `model_id` + `backend_kind` na `ai_trace_events` → render „**$X · model Y · via Z**"
   v `PatchEventCard`/`AdminAiRunDetail`.
4. **Link `ai_runs` ↔ Langfuse** — `langfuse_trace_id` na `ai_runs` (už je na `agent_runs`) + deep-link „otevři trace".

## E5. Návrh „dokázat učení" — 2 přídavky + 1 volitelný

5. **`fn_compare_model_benchmarks(task_type, t0, t1)`** — diff snapshotů (`overall_score`, cena, latence,
   success) + výsledná změna `get_adaptive_model_tiers`; surface `aisha_evaluate_provider_for_task`
   v `AdminProviderRegistry` (dnes benchmarky ignoruje).
6. **Surface `fn_record_proposal_outcome`** — karta „tato změna pohnula maturity o **+N** za 24 h
   (regressed: ne)". Data už existují v `improvement_proposals.outcome`.
7. *(Volitelné, větší)* **Champion/challenger A/B** — tag `routing_variant` na `ai_runs` + split
   v `get_adaptive_model_tiers`/`route_task` → challenger obslouží podíl trafficu **souběžně**; porovnání
   přes stejné okno. **Jediná skutečně nová orchestrační logika** — vše ostatní je read-side nad daty, co už tečou.

## E6. Uzavření smyčky: změnit → vidět → analyzovat → dokázat

```
ToT/routing ZMĚNÍ výsledek ──► ai_workflow_node_runs + ai_trace_events + provenance  (CO/PROČ/ZA KOLIK)
        │                                   │
        │                         fn_get_run_tree → strom+flotila+atribuce  (VIDĚT DOVNITŘ)
        ▼                                   ▼
   ai_eval_results ◄── evaluate.ts ◄── BRÁT & ANALYZOVAT výstupy
        │
        ▼  agregace (Část D PR Epocha 4)
   ai_model_benchmarks (history) ──► fn_compare / proposal outcome / champion-challenger  (DOKÁZAT UČENÍ)
```

„Brát a analyzovat výstupy" = telemetrie→benchmark feeder (Část D) + `ai_eval_results`. Tím se kruh
spojuje s adaptivní smyčkou: **výsledek se mění → je vidět → analyzuje se → dokáže se zlepšení → routing se učí.**

## E7. Governance transparentnosti (best-practice by design)

Participant vidí **jen svou story** (RLS na `ai_trace_events`/`fn_get_run_tree`); **PII redakce** v node
output před zobrazením; admin vs participant pohled; `decisionProvenance` autorita zůstává (transparentnost
**neobchází** compliance). Volitelně audit „kdo se díval dovnitř".

## E8. Fázový plán Část E (PR 27–31)

| PR | Obsah | Dotčené | Effort |
|---|---|---|---|
| **PR 27** | `fn_get_run_tree` (participant RLS, PII redakce) + **tree/fleet UI** (prořezané = šedé) | RPC SQL, `src/pages/.../RunTree.tsx`, `routes/reflect.ts` | L |
| **PR 28** | Perzistovat `decisionProvenance` (tabulka + read RPC) + panel „proč/autorita/override" | `decisionProvenance.ts`, `workflowEngine.ts`, migrace | M |
| **PR 29** | First-class `model_id`/`backend_kind` na `ai_trace_events` + Langfuse deep-link (`langfuse_trace_id` na `ai_runs`) | `ai_trace_events.sql`, `tracer.ts`, UI | M |
| **PR 30** | `fn_compare_model_benchmarks` + surface proposal outcome (before/after UI) v `AdminProviderRegistry` | RPC SQL, `src/pages/admin/` | M |
| **PR 31** *(volitelné)* | **Champion/challenger A/B** — `routing_variant` na `ai_runs` + split + porovnání | `route_task.sql`, `get_adaptive_model_tiers.sql`, `ai_runs` migrace | L |

## E9. Verdikt — průhledná a dokazatelná bestie

Aisha **mění výsledek** (ToT větev + adaptivní routing) a **už to zaznamenává do dna**
(`ai_workflow_node_runs` vč. prořezaných větví, `ai_trace_events` s participant RLS, `decisionProvenance`,
benchmark history, proposal outcome). Část E z toho udělá **viditelné a dokazatelné**: strom+flotila+atribuce
(„co/proč/za kolik"), before/after panel a — pro kauzální důkaz — champion/challenger. **Data plane ~80 %
hotová; zbytek je surfacing** + jedna nová capability (concurrent A/B). Plně v duchu „propojit to, co Aisha
už zvládá by design" — teď i **transparentně a dokazatelně**.

---

> *Generováno jako návrh; před implementací ověř aktuální stav v kódu/DB (SoT). Reálné odkazy:*
> *Část A — `services/svc-ai-chat/src/reflection/{orchestrator,types,checkpointer,soulforge,config}.ts`,*
> *`reflection/nodes/{generator,critic,convergence_gate,corrector,openclaw_resolve_clow}.ts`,*
> *`reflection/graphs/story-plan-reflect.json`.*
> *Část B — `routes/reflect.ts`, `lib/{orchestrationBridge,workflowEngine}.ts` (`executeParallel` ~ř.664),*
> *`services/svc-agent-runner/`, `n8n/workflows/WF_BATCH_RESUMER.json`,*
> *`aisha/db/.../baseline.sql` (tabulky `ai_runs` ř.2248, `ai_batch_jobs` ř.2285, `ai_budget` ř.1840;*
> *RPC `fn_create_workflow_run`, `fn_get_next_graph_node`, `persist_batch_result_and_resume`).*
> *Část C — `lib/{llmRouter,backendRegistry,executionMode}.ts`, `lib/providers/openai-compat.ts`,*
> *`aisha/db/sql/functions/{aisha_resolve_clow_backend,aisha_choose_execution_strategy,*
> *fn_check_and_consume_ai_budget_audited,fn_check_and_consume_llm_quota_audited,cancel_ai_run}.sql`,*
> *`aisha/db/sql/tables/{ai_provider_registry,ai_model_registry,ai_model_benchmarks}.sql`,*
> *`services/svc-openclaw/`, `services/svc-ide-context/`, `packages/aisha-ide-bridge/`,*
> *`docs/architecture/LLM_GATEWAY_DISPATCH_INVARIANTS.md`, `docker-compose.coolify-llm-gateway.yml`.*
> *Část D — `aisha/db/sql/functions/{insert_model_benchmark,get_adaptive_model_tiers,*
> *aisha_evaluate_provider_for_task}.sql`, `aisha/db/sql/tables/ai_model_benchmarks.sql`,*
> *`n8n/workflows/WF_MODEL_BENCHMARK.json`, `lib/executionMode.ts`, `routes/evaluate.ts`,*
> *`docs/architecture/STORY_SELF_EVALUATION_LOOP.md`.*
> *Část E — `aisha/db/sql/tables/{ai_workflow_node_runs,ai_trace_events}.sql`, `lib/{decisionProvenance,tracer,costAggregator}.ts`,*
> *`packages/observability/`, `aisha/db/sql/functions/{get_workflow_run_nodes_admin,fn_record_proposal_outcome,*
> *fn_detect_rag_baseline_regression,get_story_aisha_maturity,fn_list_story_faithfulness_trend}.sql`,*
> *`src/pages/admin/{AdminAiRunDetail,AdminAiObservability,AdminProviderRegistry}.tsx`,*
> *`src/components/admin/story/StoryTimeline.tsx`.*
