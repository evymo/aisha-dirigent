# Impl 01 — Dynamický top-K výběr toolů (implementačně připraveno)

> Navazuje na spec `01-dynamic-tool-selection-rag.md`. **Pořadí:** 3. v sekvenci. Sdílí prerekvizit (model context window) s impl 03 a `embed-dispatcher` s RAG vrstvou.

## 1. Reálný stav (ověřeno)
- `services/svc-mcp-knowledge/src/routes/mcp.ts`: `interface ToolDefinition { name; description; … }`, `const TOOL_DEFINITIONS: ToolDefinition[]` (ř. 63), `tool(name, description)` factory, role Sety `AUTHENTICATED_TOOLS`/`AITG_TOOLS`/`FLOWBOARD_TOOLS`, `listToolsForUser` = `TOOL_DEFINITIONS.filter(d => canUseTool(user, d.name))`. **Vrací VŠE, co projde rolí — žádný top-K.**
- `services/svc-mcp-knowledge/src/lib/embed-dispatcher.ts`: `embed(opts: EmbedOptions): Promise<number[][]>`, model se nikdy nedefaultuje, volitelně `dimensions`.
- `toolBuilder.ts`: fail-closed metadata (`accessTierMin`, `requiresConsent`, `shouldDefer`).

## ⚠️ ROZSAH (viz 15 §K3): tento impl pokrývá JEN chat cestu
> Wire-up níže platí pro **chat path** (`chat.ts` → `channelConfig.allowed_tools` × `route_task.toolsAllowlist`). **Reflection graf** (`/reflect`/`runWorkflow`) bere tooly z **per-node `node.config`**, `toolsAllowlist` tam neexistuje — governed tool selection pro agenty je **samostatný node-runtime hook** (allowlist check v node handleru), **mimo nutné jádro** (jen pokud agentní nodes volají široký tool set). Neslévat obě cesty.

## ✅ NEJNOVĚJŠÍ (viz 11-stack-readiness §1.1): v1 = ZAPOJIT existující `route_task` allowlist
> **AISHA už dynamicky počítá povolené tooly** — `RoutePlan.toolsAllowlist` z `route_task` RPC (`routeViaAisha`). V `chat.ts:523` se volá, `aishaRoutePlan` se nastaví (ř.538), ale tooly se v ř.592 berou z `channelConfig.allowed_tools` → **allowlist se neaplikuje**. v1 = **protnout** je:
> ```ts
> let names = Array.isArray(channelConfig.allowed_tools) ? channelConfig.allowed_tools : [];
> if (aishaRoutePlan?.toolsAllowlist?.length) names = names.filter(n => aishaRoutePlan.toolsAllowlist.includes(n));
> const toolDefs = await toolExecutor.loadToolsByNames(names);
> ```
> Žádný `resolveToolSet`, žádný intent-engine, žádná tabulka. Lepší governance (route_task = AISHA) i menší kód. **Intent-routing (níže) a embeddings = fallback jen při měřené potřebě.**

## ⚠️ Předchozí návrh (viz 08 §2): intent routing — jen fallback k route_task allowlistu
> **OVĚŘENO:** `analyzeChatQueryIntent(msg): ChatQueryIntent` už existuje (`orchestrationBridge`) a rodiny `AUTHENTICATED_TOOLS`/`AITG_TOOLS`/`FLOWBOARD_TOOLS` jsou hotové Sety. **Nutné jádro `resolveToolSet()` = `ALWAYS` ∪ rodiny dle existujícího intentu ∪ filtr `canUseTool`. Žádná tabulka, žádný RPC, žádný rebuild skript, žádný nový klasifikátor.**
>
> **Sekce 2–3 níže (embedding index na pgvectoru) = DEFERRED v2** — nasadit jen pokud intent routing prokazatelně nestačí (měřeno Langfuse precision/recall). Není součástí nutného jádra.

### v1 (nutné jádro) — `resolveToolSet()` přes existující intent
```ts
const ALWAYS = new Set(['manage_memory', 'ask_user']);
const INTENT_FAMILIES: Record<ChatKnowledgeIntent, string[]> = { /* rule_lookup→…, document_lookup→…, hybrid→…, greeting→[], … */ };
export function resolveToolSet(query: string, user: McpAuthContext): string[] {
  const intent = analyzeChatQueryIntent(query).knowledgeIntent;        // REUSE
  const candidate = new Set<string>([...ALWAYS, ...(INTENT_FAMILIES[intent] ?? [])]);
  return [...candidate].filter(name => canUseTool(user, name));        // REUSE gate po výběru
}
```

---

## 2. (DEFERRED v2) Index toolů (pgvector, NE ChromaDB)
**Migrace** (SoT → baseline): tabulka `agent_tool_embeddings`:
```sql
CREATE TABLE IF NOT EXISTS public.agent_tool_embeddings (
  tool_name          text PRIMARY KEY,
  description        text NOT NULL,
  embedding          vector,              -- rozměr dle modelu (viz embedding_model_id)
  embedding_model_id text NOT NULL,
  tier               text,                -- z toolBuilder.accessTierMin
  family             text,                -- authenticated|aitg|flowboard
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_tool_embeddings_ivf
  ON public.agent_tool_embeddings USING ivfflat (embedding vector_cosine_ops);
```
Grants: SELECT pro authenticated/service_role (anon žádné — viz audit grants). RLS dle konvence.

**Rebuild** (`scripts/db/build-tool-index.mjs`, spouštěné na deploy/migraci, ne za běhu):
- vezmi `TOOL_DEFINITIONS` (name+description) + tier/family z toolBuilderu,
- `embed({ model, input: description, dimensions })` přes embed-dispatcher (invariant: query model == index model),
- upsert do `agent_tool_embeddings` s `embedding_model_id`.

## 3. Resolver: `services/svc-mcp-knowledge/src/lib/resolveToolSet.ts`
```ts
export interface ToolSelectionContext {
  query: string; user: McpAuthContext;
  contextWindow?: number;            // z impl 03 → dynamické K
  profile?: string;
}
const ALWAYS = new Set(['manage_memory', 'ask_user']); // ambientní — vždy

export async function resolveToolSet(ctx: ToolSelectionContext): Promise<string[]> {
  const k = dynamicK(ctx.contextWindow);                       // ne konstanta
  const qVec = (await embed({ model: indexModel, input: ctx.query }))[0];
  const hits = await rpc('match_agent_tools', { q: qVec, k }); // pgvector cosine top-K
  const keyword = keywordFallback(ctx.query);                  // doménové seedy (compliance, flowboard, knowledge…)
  const candidate = new Set<string>([...ALWAYS, ...hits.map(h => h.tool_name), ...keyword]);
  // BEZPEČNOST: gates AŽ po výběru — nikdy neobcházet
  return [...candidate].filter(name => canUseTool(ctx.user, name));
}

function dynamicK(win?: number): number {
  if (!win) return 8;
  if (win <= 16_000) return 6;
  if (win <= 32_000) return 10;
  return 16;
}
```
`match_agent_tools` = SECURITY DEFINER RPC (cosine `<=>` nad `agent_tool_embeddings`, filtr na `embedding_model_id`).

## 4. Integrace — SPRÁVNÝ bod: `chat.ts` allowed_tools (NE mcp.ts) 🔴
> **OVĚŘENO (viz 09-final-review §B-1):** LLM tool set se NEbere z MCP `tools/list`. `chat.ts:592` čte `channelConfig.allowed_tools` → `loadToolsByNames` → `toOpenAIToolSpecs`. **`mcp.ts tools/list` je protokolová discovery pro klienty — NESMÍ se filtrovat dynamicky** (rozbilo by MCP klienty).
>
> Hook tedy v `chat.ts` PŘED `loadToolsByNames`:
```ts
// chat.ts ~ř.592
let channelToolNames = Array.isArray(channelConfig.allowed_tools) ? channelConfig.allowed_tools : [];
if (FLAGS.dynamic_tool_selection && lastUserMessage) {
  const selected = resolveToolSet(lastUserMessage, { user });          // intent routing
  channelToolNames = channelToolNames.filter(n => selected.includes(n)); // jen zúžení v rámci allowed_tools
}
const toolDefs = await toolExecutor.loadToolsByNames(channelToolNames);
```
`mcp.ts` zůstává netknutý. Zúžení je vždy podmnožinou `allowed_tools` (bezpečnost zachována).

## 5. Telemetrie (Langfuse)
Logovat: zvolené tooly vs. skutečně volané → precision/recall výběru; práh a `dynamicK` ladit dle dat.

## 6. Testy
- trivální prompt („test") → jen `ALWAYS` (žádná doménová schémata).
- doménový prompt → relevantní tool přítomen (recall ≥ baseline na eval setu toolů).
- **regrese bezpečnosti**: low-tier/non-admin user nikdy nedostane gated tool, i kdyby byl v top-K (gates po výběru).
- flag off → identické s dnešním `listToolsForUser`.

## 7. Task checklist
- [ ] Migrace `agent_tool_embeddings` + `match_agent_tools` RPC (SoT → baseline).
- [ ] `scripts/db/build-tool-index.mjs` (rebuild na deploy).
- [ ] `resolveToolSet.ts` (ALWAYS + top-K + keyword fallback + gates po výběru).
- [ ] Hook v `mcp.ts listToolsForUser` + předání query z svc-ai-chat.
- [ ] Langfuse telemetrie výběru.
- [ ] Testy (recall, security regrese, flag-off parity).
- [ ] Feature flag `dynamic_tool_selection`.

## 8. Vazby
- `contextWindow` (impl 03) → dynamické K. Bez něj fallback K=8.
- `embed-dispatcher` invariant (model nedefaultovat, query==index model) — povinný.
- Multilingual CZ/EN: index model musí zvládat oba (Brick3).
- **Pozn.:** ChromaDB se NEzavádí — index je na pgvectoru (viz spec 06 §3).
