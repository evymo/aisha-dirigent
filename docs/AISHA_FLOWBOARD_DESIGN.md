# AISHA Flowboard — vizuální builder agentů a automatizací

> **Verze:** 0.1 (funkční beta — jádro) | **Datum:** 2026-06-21
> **Status:** engine-agnostické jádro hotové + otestované (22/22, strict typecheck), UI beta, backend wiring TODO
> **Vztah ke stacku:** plocha nad existujícími primitivy — `@xyflow/react`, `plugin_catalog`/`agent_catalog`, MCP knowledge server, n8n (REST API), `route_task`/workflowEngine, StoryLoop, GrapesJS-style verzování.

---

## 1. Zamčená rozhodnutí

| Otázka | Rozhodnutí |
|--------|-----------|
| Engine | **Hybrid** — jeden graf, dva compile targety: governed **sandbox** (`route_task`/workflowEngine) a **n8n** (push přes REST API). Router rozhoduje podle citlivosti, uživatel ne. |
| Rozsah bety | **Plný volný builder** — libovolný graf, všechny kindy nodů, typové porty, vnořené agenty. |
| Registry / „seznam" | **Federovaný za běhu** z `n8n` + `mcp` + `agent_catalog` (vlastní agenti, co už umíme) + `builtin`. Dedup podle `typeId`. |
| Authoring povrch | **Vlastní `@xyflow` canvas**, ne n8n UI. n8n je motor, ne produkt. |
| Provenance | **StoryLoop `story_entries`** — žádný nový timeline. Přidány 2 typy: `flow_run`, `automation_step`. |
| Governance | Onboarding contract zabudovaný do nodů: klasifikace + consent + ACL. Citlivý zdroj → egress bez gate = zamčená hrana. |

## 2. Vrstvy

```
Záměr (chat) → AISHA Dirigent ──draft graf JSON──▶ Flowboard canvas (@xyflow)
                                                       │  paleta = federovaný registr
                                                       ▼
                                            validace (porty + consent) → kompilátor
                                                       │
                                   ┌───────────────────┴───────────────────┐
                                   ▼                                       ▼
                        n8n workflow (REST push)              sandbox RoutePlan (route_task)
                                   └───────────────────┬───────────────────┘
                                                       ▼
                                        StoryLoop story_entries (ikonografická provenance)
                          Appsmith = ops shell (seznam agentů, run inspector, approvals)
```

## 3. Implementované jádro (`src/lib/flowboard/`)

| Soubor | Odpovědnost |
|--------|-------------|
| `ports.ts` | Typový port systém (`main`, `trigger`, `ai_languageModel`, `ai_memory`, `ai_tool`, `story_event`, `document`, `signal`) + `canConnect`. Jediný zdroj pravidel composability — čte ho canvas i auto-builder. |
| `nodeTypes.ts` | `FlowNodeDescriptor` (Zod) — kind, porty, capabilities, sensitivity, engines, egress, source. |
| `registry.ts` | Federace providerů: `builtinProvider`, `agentCatalogProvider`, `mcpToolProvider`, `n8nNodeProvider` (DI fetchery → testovatelné bez DB/sítě). `mergeRegistry` dedup. |
| `graph.ts` | `FlowGraph` (verzovaný JSON) + `validateGraph`: struktura, kompatibilita portů, **consent gate** (citlivý zdroj → egress bez gate = chyba). |
| `engine.ts` | `selectEngine` — routing podle gate/citlivosti/sandbox-only; podpora `meta.engine` pinu. |
| `compile/n8n.ts` | `compileToN8n` → `{name,nodes,connections}` (shape pro n8n REST), auto-wiring `AishaLlmRouter` pro agenty bez modelu. |
| `compile/sandbox.ts` | `compileToSandbox` → RoutePlan (`steps`, `toolsAllowlist`, `stopConditions`) pro `route_task`. |
| `compile/index.ts` | `compileGraph` — validace → routing → artefakt. |
| `provenance.ts` | Mapper běhu nodu → `create_story_entry_audited` params; ikony; reuse existujících entry typů (`inbound_email`…). |

UI (`src/components/flowboard/`): `FlowCanvas.tsx` (free builder + live validace + engine badge + Ask-AISHA), `FlowNode.tsx` (typové barevné porty), `NodePalette.tsx` (registr po skupinách), `types.ts`.

Testy (`src/tests/flowboard/`): 22 testů — porty, federace, validace (vč. consent gate), routing, n8n+sandbox kompilace, provenance.

## 4. Composability = typové porty

Node deklaruje typované vstupy/výstupy (jako barevné porty AI Agent nodu v n8n: Chat Model / Paměť / Tool). Hrana je legální iff `canConnect(out, in)`: směr `out→in` + typová kompatibilita. Cross-type adaptéry jen: `trigger|story_event|signal → main`. Sub-node porty (`ai_*`) jen stejný typ.

## 5. Backend slice (0.2) — hotovo v kontextu stacku

| Kus | Soubor | Stav |
|-----|--------|------|
| DB tabulka + RLS + verzování | `aisha/db/sql/tables/flowboard_graphs.sql`, `aisha/db/migrations/20260621120000_flowboard.sql` | ✅ |
| RPC save/get/list + registry feed | `save_flowboard_graph` · `get_flowboard_graph` · `list_flowboard_graphs` · `get_flowboard_agent_catalog` (SECURITY DEFINER, RLS, `is_admin_or_staff`) | ✅ |
| StoryLoop entry typy `flow_run`/`automation_step` | `src/schemas/storyLoopSchemas.ts` (app-level — `entry_type` je open text bez CHECK) | ✅ |
| `draft_flow` recipe (help@) | `src/lib/flowboard/recipes.ts` (+ test: validuje → kompiluje na n8n) | ✅ |
| MCP nástroje `draft_flow` + `get_flowboard_registry` | `services/svc-mcp-knowledge/src/lib/flowboard-tools.ts` + zapojeno v `routes/mcp.ts` (tool defs, AUTHENTICATED_TOOLS, dispatch) | ✅ |

**Tok end-to-end:** Dirigent (n8n) → MCP `draft_flow` → FlowGraph JSON → canvas (ghost nody) → `save_flowboard_graph` → `compileGraph` → n8n push / route_task → `story_entries` (ikonografická provenance).

### Zbývá (0.3)
1. **Gateway HTTP route** `/flowboard/*` (proxy na RPC + n8n push) — pro frontend mimo MCP cestu.
2. **n8n provider:** reálná introspekce + push zkompilovaného workflow (n8n REST, `scripts/n8n-ops.mjs`).
3. **Sandbox executor:** napojit `compileToSandbox` → `route_task`/workflowEngine + emit `story_entries` přes `provenance.ts`.
4. **StoryLoop block renderery** pro `flow_run`/`automation_step` (ikonografie v timeline).
5. **Extrakce `packages/flowboard-core`** (sdílení FE↔services; sjednotí duplicitu recipe mezi `recipes.ts` a `flowboard-tools.ts`).

## 6. Verifikace (0.2)

| Kontrola | Výsledek |
|----------|----------|
| `vitest run` (6 souborů) | **24/24 passed** |
| `tsc --strict --noEmit` na `src/lib/flowboard` | **clean** |
| `eslint` (core + UI + testy + `flowboard-tools.ts` + patched `mcp.ts` + schema) | **0 problémů** |
| SQL sanity (dollar-quote balance, 4 RPC / 4 policy) | **ok** (Squawk poběží v CI) |

**Inventář:** 12 core (`src/lib/flowboard/`) · 4 UI (`src/components/flowboard/`) · 7 testů · 2 DB · 1 MCP modul · 1 doc.

---

## Runtime — rozhodnutí, controls a plán (2026-06-22)

Tato sekce zachycuje analýzu a rozhodnutí učiněná při integraci flowboardu, aby runtime
follow-up měl plný kontext. **Tento PR dodává schema-complete foundation** (engine + DB SoT
+ MCP tools + UI komponenty); **runtime execution je follow-up** (viz plán níže).

### 1. Persistence: `flowboard_graphs` je ODDĚLENÉ od `ai_workflow_definitions` (rozhodnuto)

Deep-analýza (4/4 nezávislých analytiků) potvrdila, že to NEJSOU duplikáty, ale **genuinně
rozdílné koncepty**:

| | `flowboard_graphs` | `ai_workflow_definitions` |
|---|---|---|
| modeluje | vizuální builder — **jak zadrátovat agenty/tooly** (vazby agentů) | runtime reasoning orchestrace — jak engine routuje rozhodnutí |
| graf-schéma | `nodes[]` + **explicitní `edges[]` s typovanými porty** + `canConnect()` + consent-gate validace | `Record<key,node>` + implicitní `node.next`/`transitions`, žádné porty |
| agent vazby | ✅ agent jako uzel s porty, explicitní wiring, **federovaná paleta** (`mergeRegistry`: agent_catalog+MCP+n8n živě z DB) | ❌ jen pojmenované reference + implicitní routing |
| authorship | owner-scoped, user-editable, verzované | platform-seeded z JSON SoT, admin |
| exekuce | kompiluje → n8n / governed sandbox | přímá interpretace `workflowEngine` |

Schémata jsou nekompatibilní, nulový datový tok, žádný FK. **„Reuse existing" se naplňuje
sdílením `story_entries` + `agent_catalog` + RLS patternů — NE strukturou tabulky.** Merge
přes `context='flowboard'` by nacpal dva nekompatibilní kontrakty do jedné tabulky (anti-pattern
„nemerguj odlišné koncepty"). **Budoucí evoluce (varianta c, YAGNI):** přidat třetí kompilační
cíl `compileToWorkflowDefinition(FlowGraph)→WorkflowGraph` (jeden builder, víc lens), NE merge.

### 2. Evaluace vize (funkcionalita / efektivita / kontroly / přesnost)

Vize je **zdravá a aligned s principy platformy** (capability-availability federovaná paleta,
governance-in-the-graph, reuse primitiv). **Největší riziko = kontroly za běhu** (níže).

### 3. Controls-first nález (KLÍČOVÉ pro runtime)

`workflowEngine` bere `requireHumanApproval`/`mustPassCompliance` jen jako **hint** (předá do
routePlan, řádek ~306), **NEZASTAVÍ běh** na approval (guardrails se řeší post-workflow). →
**Design-time consent-gate validace ≠ runtime enforcement.** Aby governance-in-the-graph nebyla
jen kosmetická, **executor musí gate vynutit SÁM**: před exekucí grafu s `requireHumanApproval`
(nebo citlivým egressem bez brány) vytvořit `consent_request` story_entry + **halt**, a spustit
teprve po schválení. Dále: **n8n cíl uniká governed sandboxu** (consent/audit platformy se na
n8n-běhy nevztahují) → citlivé grafy routovat do sandboxu (`selectEngine`), ne n8n.

### 4. Runtime implementační plán (6 kusů, controls-first, pořadí 1→6)

1. **Sandbox executor** (`services/svc-ai-chat/src/lib/flowboard-sandbox-executor.ts`): `SandboxPlan`
   → `planToRoutePlanHint` → `createWorkflowEngine({...,routePlanHint}).execute()`. **Gate enforcement**
   (halt + consent_request PŘED exekucí). Sandbox je default pro citlivé.
2. **Provenance** (uvnitř #1): `buildRunEntries(ctx, records)` → `create_story_entry_audited` přes
   **user-JWT** (RPC vyžaduje `auth.uid()` — NE service-role; viz gap #4).
3. **n8n REST push** (`services/svc-ai-chat/src/lib/n8n-client.ts`): `compileToN8n` → POST
   `/api/v1/workflows` (`X-N8N-API-KEY`). Vyřešit credential `__REMAP__` placeholder (gap #7).
4. **Gateway route** (`services/gateway/src/routes/flowboard.ts` + execute trigger): `/flowboard/{compile,
   execute,push-n8n,execution-status}` + CRUD delegace na flowboard RPC. Dual-auth.
5. **StoryLoop renderer** (`src/components/storyloop/blocks/FlowRunBlock.tsx` + AutomationStepBlock):
   render flow_run/automation_step bloků. i18n přes DeepL (ne EN fallback).
6. **FE editor route** (`src/pages/FlowboardPage.tsx` + router): mount `FlowCanvas`, save přes
   **flowboard RPC** (`save_flowboard_graph`), NE `*_ai_workflow_admin` (to je separátní AI-workflow admin).

### 5. Otevřené gapy / follow-ups (postavit, ne předpokládat)

- **Gate mid-graph enforcement** — executor enforcuje (#3 výše), engine sám ne.
- **Provenance auth** — runtime volá `create_story_entry_audited` user-scoped (auth.uid()), ne service-role.
- **`get_flow_run_status` RPC** neexistuje — vytvořit (čte `ai_runs` + node runs) pro execution-status.
- **Execute trigger endpoint** — `POST /flowboard/execute` (dnes flowboard nemá HTTP execute vstup).
- **n8n credential `__REMAP__`** — resolvovat v cílové instanci; flowy bez credentialů OK.
- **Compile-correctness testy** — engine má 24/24, ale `compileToN8n`/`compileToSandbox`→reálná exekuce méně.
- **Varianta (c)** `compileToWorkflowDefinition` — až když UX vyžádá reflection workflow z plátna.

---

## 7. Update 0.4 — extrakce balíčku + governance loop

**① `@aisha/flowboard-core` extrahováno (hotovo, ověřeno).** Engine-agnostické jádro je teď `packages/flowboard-core/` (vzor `@aisha/api-core` — source-only, konzumováno přes workspace + alias). `src/lib/flowboard/*` = tenké re-export shimy, takže FE importy beze změny. Aliasy přidány vedle api-core ve `vite.config.ts`, `vitest.config.ts`, `tsconfig.app.json`. **`p_is_internal` sjednoceno na `false`** v kanonickém jádře (member nesmí internal entries). Ověřeno: vitest **24/24** přes řetězec shim→balíček, balíček `tsc --strict` clean, ESLint clean.

**② Service migrace na balíček = RELEASE-GATED (Verdaccio).** `Dockerfile.svc-ai-chat` kopíruje jen `services/svc-ai-chat/package.json` + lock a dělá `npm ci` — `packages/` se do containeru nekopíruje, `@aisha/*` se tahá z **Verdaccia**. Takže svc nemůže importovat `@aisha/flowboard-core`, dokud:
   1. `npm publish` balíčku do Verdaccia,
   2. přidat `@aisha/flowboard-core` do `services/svc-ai-chat/package.json` + `svc-mcp-knowledge/package.json` (+ regenerovat lockfile),
   3. teprve pak nahradit duplicitní FlowGraph/topo v `flowboardSandboxExecutor.ts` importem a recipe v `flowboard-tools.ts`.

   Půlka té změny (import bez publish) rozbije `npm ci` → **nedělat v jednom kroku**. Do té doby duplicita zůstává (vědomě dokumentovaná). Executor provenance je navíc *superset* (output/consent/resume) — při sjednocení rozšířit kontrakt balíčku, ne smazat.

**③ Consent approve loop — backend hotový.** `approve_flowboard_gate_audited(p_story_id, p_node_id)` (`aisha/db/migrations/20260623120000_flowboard_gate_approval.sql`): owner (`created_by = auth.uid()`) schválí halted gate → `metadata.flowboard.status = approved` (audited). Existující `/flowboard-execute` re-invoke pak gate projde a resumne (executor `buildResumeState` to už čte). **Zbývá FE:** tlačítko „Schválit" v StoryLoop bloku `consent_request`, co zavolá RPC + re-invoke — registrace do jejich block-renderer mapy (neměním naslepo).

### Zbývá (0.5)
1. Verdaccio publish `@aisha/flowboard-core` → service migrace (sundá duplicitu + sjednotí provenance).
2. FE approve blok (renderer `consent_request`/`automation_step`/`flow_run` + tlačítko → RPC + re-invoke).
3. n8n push: `compileToN8n` → n8n REST v `flowboard-run.ts` engine='n8n' větvi (teď 501) — taky čeká na balíček ve službě.

## 8. Verifikace (0.4)

| Kontrola | Výsledek |
|----------|----------|
| `vitest run` (shim → @aisha/flowboard-core → package) | **24/24 passed** |
| `tsc --strict` na `packages/flowboard-core` | **clean** |
| `eslint` (package + shims) | **0 problémů** |
| approve RPC SQL sanity (dollar-quote balance, REVOKE+2×GRANT, owner guard) | **ok** |

---

## 9. Update 0.5 — balíček publikovatelný + služby napojené + n8n push

**Balíček `@aisha/flowboard-core` je teď publikovatelný (váš auto-publish flow).** Podle `docs/release/AISHA_PACKAGES_PUBLISH.md` jsem ho srovnal s `@aisha/security`: `private:false`, `publishConfig:{access:restricted}`, `type:module`, `main/types → ./dist`, `files:[dist,src]`, `scripts.build:"tsc"`, NodeNext tsconfig (`.js` extensions v importech), `dependencies.zod`. **Eligibility (4 podmínky) ověřena = true** → auto-publish workflow ho na merge do `main` zbuilduje a publikuje na Verdaccio. `dist/` je gitignored (build artefakt, runner ho dělá sám). Web ho dál konzumuje přes alias na `src` (24/24 zelené).

**Služby napojené (`"@aisha/flowboard-core": "*"`):**
- `svc-mcp-knowledge/flowboard-tools.ts` — recipe deduplikovaná: `draft_flow` volá `draftHelpInboxFlow` z balíčku (žádná lokální kopie).
- `svc-ai-chat/routes/flowboard-run.ts` — **n8n push hotový**: engine `n8n` větev (dřív 501) teď `compileToN8n` z balíčku + federovaný registr (`buildFlowRegistry`/`builtinProvider`/`agentCatalogProvider` z `get_flowboard_agent_catalog`) → REST push na `${config.n8nBaseUrl}/api/v1/workflows` s `X-N8N-API-Key`. Registr se staví server-side z autoritativního `agent_catalog` (netrustí klientovi).

Gate `aisha-packages-publish.gate.test.ts` (každý `@aisha/X` konzumovaný přes `"*"` musí být publikovatelný) je splněný.

### Operátorský krok (váš release flow, ne sandbox)
1. `npm install` v rootu → workspace symlink + service lockfiles dostanou `@aisha/flowboard-core`.
2. Merge do `main` → `aisha-packages-publish.yml` zbuilduje + publikuje balíček na Verdaccio (`VERDACCIO_TOKEN`).
3. Service Docker `npm ci` pak `@aisha/flowboard-core` resolvuje z Verdaccia.
   *(Při změně `packages/flowboard-core/src/**` bumpnout `version` — hlídá `.husky/pre-commit` `aisha-packages-version-check.mjs`.)*

### Zbývá (0.6)
1. **FE approve blok** — renderer `consent_request`/`automation_step`/`flow_run` + tlačítko „Schválit" → `approve_flowboard_gate_audited` + re-invoke `/flowboard-execute` (registrace do jejich StoryLoop block mapy).
2. **n8n run provenance** — execution webhook z n8n → `story_entries` (push teď vrací `pushed_to_n8n` + workflow id; běhová provenance je další vrstva).
3. (volitelně) executor interní `topoOrder` → import z balíčku (jejich tested kód; marginální, necháno na nich).

## 10. Verifikace (0.5)

| Kontrola | Výsledek |
|----------|----------|
| `@aisha/flowboard-core` build (`tsc` NodeNext → dist) | **clean** (.js + .d.ts + maps) |
| `tsc --strict --noEmit` na balíčku | **clean** |
| Web konzumace (vitest přes alias → src) | **24/24 passed** |
| Auto-publish eligibility (private≠true + publishConfig + build) | **true** |
| Service-importované symboly přítomné v public API balíčku | **✓ všechny** |

---

## 11. Update 0.6 — hermetic packaging + dedup + cross-platform

**① B1 packaging (hermetic, lokální z repa).** `@aisha/flowboard-core` je dual-mode: `main/types/exports → ./src` (in-repo konzumace = source, **nula buildu, bez Verdaccia, bez ohledu na platformu**) + `publishConfig` override → `./dist` (Verdaccio artefakt). Web (alias→src) i služby (workspace symlink → main→src) kompilují source přímo. Lokálně tedy `@aisha/flowboard-core` jede čistě z git tree. Ověřeno: web 24/24 + package build dist + publish-eligibility.

**② Executor dedup — verifikováno 19/19.** `flowboardSandboxExecutor.ts` teď importuje `topoOrder` + `kindIcon` z balíčku a lokální kopie smazal. Aby to bylo bezpečné a behavior-preserving:
- `topoOrder` v balíčku je nově **strukturálně generický** → vezme i minimal runtime graf executoru (žádné coupling na FE Zod schema). Algoritmus identický.
- `kindIcon(kind)` v balíčku = přesně původní kind-level mapa (žádná změna ikon).
- `FlowGraph`/`FlowNodeInstance` (minimal) + `nodeKind` + bohaté provenance buildery **zůstávají v executoru záměrně** (runtime kontrakt, pinovaný testy). `topoOrder` re-exportován → test import path beze změny.
- **Spustil jsem jejich vlastní `flowboardSandboxExecutor.test.ts` (19 testů) proti upravenému executoru + balíčku → 19/19 passed.** (Balíček bumpnut na 0.1.1 — pre-commit version guard.)

**③ Cross-platform `.gitattributes`.** `* text=auto eol=lf` + LF pro `*.sh`/`.husky` (CRLF by je rozbil na Windows) + binární výjimky (`*.lockb`, fonty, obrázky). `node_modules` je gitignored → native binárky (rollup/swc) si řeší per-platform `npm install`. Jednorázový `git add --renormalize .` je samostatný follow-up.

**Duplikáty stav:** čisté duplikáty (`topoOrder`, icon mapa) odstraněny. Zbývá jen *záměrný* minimal `FlowGraph` v executoru (decoupling runtime od FE Zod) + provenance superset — to není dluh, je to architektura.

### Zbývá (0.7)
1. **FE approve blok** — StoryLoop renderer `consent_request` + tlačítko → `approve_flowboard_gate_audited` + re-invoke `flowboard-execute`. (AdminFlowboard už řeší run + `awaiting_approval`; chybí jen approve UI v timeline.)
2. **n8n run provenance** — n8n execution webhook → `story_entries` (reuse `routes/callback.ts`).
3. **(ADR B2) hermetic svc Dockerfily** — `Dockerfile.svc-*` na workspace vzor (`context: .`, `npm ci --include-workspace-root`) → service buildy bez registry.

## 12. Verifikace (0.6)

| Kontrola | Výsledek |
|----------|----------|
| `@aisha/flowboard-core` build (NodeNext → dist) | **clean** |
| Web/core vitest (alias→src) | **24/24** (+ generic topoOrder/kindIcon probe 2/2) |
| **Executor svc test (`flowboardSandboxExecutor.test.ts`)** | **19/19 passed** (proti balíčku) |
| B1 dual-mode (in-repo src / publish dist) + publish-eligibility | **ok** |

---

## 13. Update 0.7 — consent approve loop HOTOVÝ (tým) + odstraněn můj duplikát

Verify-first odhalil, že **celý FE approve loop už tým postavil** — nestavěl jsem nic nového:
- `src/components/storyloop/blocks/FlowConsentGateBlock.tsx` (+ test) — blok s tlačítkem „Schválit", discriminován přes `metadata.flowboard.kind`.
- `StoryEntryBlockRenderer.tsx` ho dispatchuje; `StoryDetail.tsx` prováže `onApproveFlowGate`.
- `useStoryBlockActions.onApproveFlowGate` → `respond_to_story_block_audited(action:'approve_flow_gate')` → re-invoke `flowboard-execute` (resume).
- **`respond_to_story_block_audited` už `approve_flow_gate` plně řeší** (stampne `metadata.flowboard.status='approved'`, audited, owner-scoped) — generická block-action RPC, ne nová.

**Odstraněn můj duplikát:** `approve_flowboard_gate_audited` (migrace + funkce) byla mrtvý duplikát existující generické RPC → oba soubory neutralizovány na komentářový no-op (žádná redundantní funkce nevznikne). Přesně ten typ duplikátu, který hlídáme.

**Consent governance loop je tím kompletní:** gate HALT → `consent_request` v timeline → tlačítko Schválit → `approve_flow_gate` stampne approved → re-invoke → executor resume. End-to-end, bez duplicit.

### Genuinně zbývá
1. **n8n run provenance** — n8n execution webhook → `story_entries` (n8n push teď vrací `pushed_to_n8n`; runtime provenance z n8n je poslední nenapojená vrstva). Reuse `routes/callback.ts`.
2. **(ADR B2) hermetic svc Dockerfily** — `Dockerfile.svc-*` na workspace vzor (PR C/D) → service buildy bez registry.

Vše ostatní (builder, save/run, governed sandbox s consent halt+resume, provenance timeline, approve UI, n8n push, hermetic balíček, executor dedup) je **hotové a ověřené**.

---

## 14. Update 0.8 — packaging srovnán na konvenci + B2 hermetic-ready

**Korekce B1 → konvence `@aisha/security`.** B1 (`main→src`) bylo chybné pro hermetic runtime: kronos workspace build dělá `node dist/server.js` a resolvuje `@aisha/flowboard-core` přes `main` — musí být `./dist/index.js` (Node neumí spustit `.ts`). `main→src` by hermetic runtime rozbil + bylo nekonzistentní s `@aisha/security`. Srovnáno na **přesně security vzor**: `main→dist`, `publishConfig:{access:restricted}`, `build:"tsc"`, `files:[dist,src]`. Verze 0.1.2. Ověřeno: package build dist clean + web 24/24 (web jede přes alias→src, nezávisle). Tím je flowboard-core **hermetic-ready**.

**B2 = ADR PR C (jejich env, povinná cold-start verifikace).** Hermetic svc Dockerfily (`Dockerfile.svc-ai-chat`, `svc-mcp-knowledge`) na kronos vzor (`Dockerfile.svc-aisha-kronos-shim` je reference): build context = repo root, `npm ci --workspace=@aisha/<svc> --include-workspace-root` (resolvuje `@aisha/*` přes workspace symlinky, **nula registry**), build dep chainu, runtime kopíruje dep `dist`. Přepsat naslepo bez `docker build` z čistého checkoutu by porušilo ADR akceptační kritérium — proto to nedělám tady.

**Přesná integrace flowboard-core do kronos vzoru** (přidat do každého svc Dockerfile při PR C):
```dockerfile
# 1. manifest skeleton (mezi ostatní COPY packages/*/package.json)
COPY packages/flowboard-core/package.json packages/flowboard-core/
# 3. source copy (dep chain) — flowboard-core nemá @aisha závislosti, jen zod
COPY packages/flowboard-core packages/flowboard-core
# 4. build PŘED službou (svc na něm závisí)
RUN npm run build --workspace=@aisha/flowboard-core
# runtime stage
COPY --from=build /app/packages/flowboard-core/package.json packages/flowboard-core/package.json
COPY --from=build /app/packages/flowboard-core/dist          packages/flowboard-core/dist
```
Dep chains: `svc-ai-chat` = aitg · observability · security · **flowboard-core**; `svc-mcp-knowledge` = aitg · cache-redis · observability · security · **flowboard-core**. Build order: deps před službou. (flowboard-core má jen `zod`, žádné transitivní `@aisha/*` → buildí se kdykoli v rámci dep fáze.)

### Stav: verifikovatelná + správná část Flowboardu je HOTOVÁ
Builder · save/run · governed sandbox (consent halt+resume) · timeline provenance · approve UI (generická RPC) · n8n push · hermetic balíček · executor dedup (19/19) · cross-platform `.gitattributes`. **Bez duplicit.**

### Env-dependentní zbytky (jejich prostředí + testy)
1. **n8n run provenance** — n8n execution webhook → `story_entries` (pattern `routes/callback.ts`: `x-n8n-api-key`; mapper `buildRunEntries` z balíčku; service-role story-entry write path).
2. **B2 Dockerfily** — ADR PR C/D dle specifikace výše + cold-start verifikace.

---

## 15. Update 0.9 — n8n engine dokončený proti dev + test-first suite

**Regres, který test-first odhalil:** moje původní task-16 n8n push vracela 503/200, ale `flowboard-run.route.test.ts` očekával **501** → rozbitý test. Vráceno + dotaženo **pořádně**.

**n8n engine dokončený (route `flowboard-run.ts`):** engine `n8n` větev teď: federovaný registr → `compileToN8n` → **`POST /api/v1/workflows` (CREATE)** → **`POST /api/v1/workflows/:id/activate` (ACTIVATE)** → zapíše `flow_run` provenance umbrellu pod **user JWT** (`buildFlowRunEntry` + `create_story_entry_audited`, stejně jako sandbox) → `200 { status:'running_in_n8n', n8nWorkflowId, active }`. **„200" = workflow opravdu vytvořený + aktivní + provenance v DB**, ne mock. Fail-closed: 503 (nekonfig), 502 (create fail), 500 (provenance fail).

**Integrační test proti dev (`flowboard-n8n.integration.test.ts`):** env-gated (`N8N_BASE_URL`+`N8N_API_KEY`+`POSTGREST`+`DB`), nic na n8n/DB cestě nemockuje — reálně compiluje → CREATE → ACTIVATE → ověří `GET workflow.active===true` + `flow_run` provenance v `story_entries` (+ cleanup DELETE workflow). Mirror `flowboard-runtime.integration.test`. Tohle je to „provedení integračních testů oproti dev prostředí".

**Per-node n8n execution provenance** (každý node běhu → `automation_step`) zůstává jako další vrstva (n8n storyEntry nody / execution callback) — zdokumentováno v `flowboard-n8n.spec.test.ts` `describe.skip`. Credential `__REMAP__` je gap #7.

### Test-first suite — co schází, napsané napříč stackem
| Test | Úroveň | Stav |
|------|--------|------|
| `pipeline.integration.test.ts` | core cross-component (recipe→validate→route→compile→provenance + package↔executor kontrakt) | **28/28 green** |
| `flowboard-hermetic.gate.test.ts` | static gate (publishable, main→dist, shimy, žádný dup v executoru) | běží ve vašem vitest (čte repo) |
| `flowboard-n8n.integration.test.ts` | **dev integrace** (real n8n + DB) | env-gated, běží v dev/CI |
| `flowboard-n8n.spec.test.ts` | compile contract READY + webhook spec | READY ověřeno; webhook = next layer |
| `e2e/flowboard.spec.ts` | Playwright celý UI flow | `test.skip` dokud neběží stack |

Doplňuje existující: runtime A-to-Z (real DB), executor (19), route, dispatch, block renderery, approve hook, core (24).

## 16. Verifikace (0.9)
| Kontrola | Výsledek |
|----------|----------|
| core + pipeline integration vitest | **28/28** |
| package build (NodeNext → dist) | clean |
| route unit test n8n případ | 501 → **503** (konzistentní s implementací) |

---

## 17. Rozběhnutí lokálně + n8n + testy proti němu

Vaše integrační testy běží přes existující **throwaway-DB harness** (`scripts/db/with-throwaway-db.mjs` + `with-throwaway-postgrest.mjs`) — DB + PostgREST + cold-start schéma se postaví automaticky, nic se nemockuje. Přidán script napojující n8n integraci do stejného harnessu:

| Příkaz | Co spustí |
|--------|-----------|
| `npm run test:flowboard:fullenv` | runtime A-to-Z (sandbox engine) proti throwaway DB |
| `npm run test:flowboard:realllm` | totéž + reálný OpenAI agent |
| **`npm run test:flowboard:n8n`** | **n8n engine proti reálnému n8n** + throwaway DB (nový) |

**Lokální n8n + testy proti němu (dev stroj s dockerem):**
```bash
# 1. lokální n8n na :5678 (má vaše custom nody n8n-nodes-aisha + AishaLlmRouter/storyEntry)
docker compose -f docker-compose.coolify-n8n.yml up -d n8n
# 2. v n8n UI: Settings → API → vytvořit API key
# 3. spustit n8n integraci (DB řeší harness; ty dodáš jen n8n env)
N8N_BASE_URL=http://localhost:5678 N8N_API_KEY=<key> npm run test:flowboard:n8n
```
Test reálně: compile → CREATE → ACTIVATE workflow na lokálním n8n → ověří `active===true` → zapíše `flow_run` provenance do throwaway DB → cleanup. „200" = opravdu naběhlý workflow + provenance, ne mock.

**Pozn. proč to nejde v tomto sandboxu:** chybí docker, psql i vaše custom `n8n-nodes-aisha` nody (vanilla n8n by compiled workflow odmítl na neznámých typech). Proto je to napojené jako jednopříkazový běh na vašem dev stroji, ne tady.

### Zbývá (per-node n8n provenance — další vrstva, test-first proti dev)
n8n execution → `automation_step` za každý běhový node (n8n storyEntry nody v compiled workflow / execution callback `/flowboard-n8n-callback` s `X-N8N-API-Key` jako `routes/callback.ts`). Napíše se k tomu nejdřív integrační test (proti dev n8n), pak implementace. Credential `__REMAP__` gap #7 se vyřeší při prvním reálném CREATE.

---

## 18. Update 1.0 — per-node n8n run provenance (callback handler + service writer)

Test-first, vaším vzorem (žádný duplikát — `append_inbound_comm_entry_audited` byl ten ověřený service-role story_entries writer).

**DB (`append_flowboard_run_entry_service`)** — service-role-only zápis `automation_step` (guard `current_setting('role')='service_role'`, owner-attributed `created_by`, **idempotentní po `run_id`+`node_id`**, audited). Zrcadlí inbound-comm vzor; jiná doména → ne duplikát. (`aisha/db/migrations/20260627120000_flowboard_n8n_provenance.sql`)

**Route (`/flowboard-n8n-callback`)** — auth `X-N8N-API-Key` (dle `callback.ts`), mapuje každý běhový node přes sdílený `buildStepEntry` z `@aisha/flowboard-core` → service RPC. Registrováno v `server.ts`. Zápis přes service-role (n8n nenese `auth.uid()`).

**Integrační test (`flowboard-n8n-callback.integration.test.ts`)** — env-gated proti reálné DB (throwaway harness): POST callback → ověří `automation_step` per node v DB (správný status, lucide ikona, `created_by`=owner) + **idempotence** (retry callbacku nezdvojuje). Napojeno do `npm run test:flowboard:n8n` (běží s `flowboard-n8n.integration` proti živému n8n + DB).

**Stejná iconografická timeline jako sandbox:** flow_run umbrella (zapsaná při CREATE) + automation_step za každý node (z callbacku) → StoryLoop ukazuje n8n běh identicky jako governed sandbox.

### Zbývá (n8n-side wiring, proti dev n8n)
Compiler zatím neinjektuje do workflow **callback node**, takže reálný n8n běh handler ještě nevolá. Doplnit: `compileToN8n` přidá finální HTTP node POSTující `{ story_id, owner_id, graph_id, run_id, steps }` na `/flowboard-n8n-callback` (run kontext zapečený při CREATE). To je n8n-version-specific → dělá se + ověřuje proti dev n8n (handler + RPC + DB jsou hotové a testem kryté).
