# ACS Audit — verifikace tvrzení ACS v1.0 proti kódu

> **Status:** Dokončený audit, opravy promítnuty do [AGENT_COMMUNICATION_STANDARD.md](AGENT_COMMUNICATION_STANDARD.md) (v1.1)
> **Datum:** 2026-07-08
> **Spouštěč:** maintainer zpochybnil tvrzení „Supabase RPC" → plná reverifikace všech tvrzení ACS v1.0

---

## Metodika

Každé faktické tvrzení ACS v1.0 bylo ověřeno **přímo v kódu** (rg + čtení souborů), bez zprostředkovaných shrnutí. Verdikty: ✅ potvrzeno · ⚠️ nepřesné/dovozené · ❌ chybné. U každého nálezu je důkaz (soubor, příp. řádek).

Pozn. k procesu: jeden nález (`gen:ide`) prošel dvěma koly — první grep s useknutým výstupem (`head -8`) vedl k falešnému „neexistuje", přímý grep existenci potvrdil (`package.json:150`). Verdikt se smí vynést jen nad úplným důkazem; useknutá evidence je sama o sobě zdroj šumu.

## Nálezy

| # | Tvrzení v ACS v1.0 | Verdikt | Skutečnost (důkaz) | Oprava v v1.1 |
|---|--------------------|---------|--------------------|----------------|
| 1 | „Supabase (PG)", „Supabase RPC + RLS jako neobejitelný chokepoint" | ❌ | **Supabase (produkt) v platformě není.** Self-hosted PostgreSQL; Fastify gateway emuluje Supabase-kompatibilní API surface kvůli SDK kompatibilitě (`services/gateway/src/routes/rest.ts:14` — „apikey (Supabase SDK pattern) passed through"; routes `rest/storage/functions/realtime`). DB přístup přes vlastní PostgREST vrstvu `rpcService`/`rpcUser` (`services/svc-ai-chat/src/postgrest.ts`); `lib/rpcAdapter.ts` je jen compat shim nad ní. DDL/seed žijí v `aisha/db/` | IP-3 přeformulován: PG funkce + trigger volané přes vlastní postgrest vrstvu; default-deny přes DB práva (REVOKE INSERT + SECURITY DEFINER funkce), ne „Supabase RLS". Pojem Supabase z ACS odstraněn |
| 2 | Event backbone: PG LISTEN/NOTIFY → Redis → ws-gateway; fire-and-forget JSON bez envelope | ✅ | `services/event-worker/src/config.ts` (pgChannels, redisUrl, webhookRoutes, n8nWebhookUrl), `worker.ts` (loose parse, skip na ne-JSON, žádný dedup/podpis) | Beze změny; doplněno: `pg_notify` má ~8 kB limit → envelope v NOTIFY nese **jen ID** (pass-by-reference i na transportní vrstvě) |
| 3 | 5 n8n agentů (Knowledge, Compliance, Delivery, Ragnarok + Dirigent master) | ⚠️ s výhradou | n8n vrstva doložena (`docs/N8N_AGENT_ARCHITECTURE.md` v2.1, 2026-03, AishaLlmRouter node). ALE kódové SoT orchestrace = **reflection engine** (`services/svc-ai-chat/src/reflection/orchestrator.ts`) + `orchestrationBridge` + `svc-agent-runner` (fronta `claude_cli_task`, NOTIFY `agent_run_queued`). Ragnarok je primárně RAG engine (`packages/insight/il/`, dle P5 proposal), n8n agent je jeho obálka | ACS rozšířen o reflection engine (nová §4) a svc-agent-runner jako primární adoptery; n8n přestává být rámováno jako jádro orchestrace |
| 4 | „Dnes korelace jen přes Langfuse" | ⚠️ | Podceněno: gateway je OTel **trace root** s W3C `traceparent` propagací do svc-* (`services/gateway/src/server.ts`); `run_id` v chat flow; `ai_runs` vzniká přes `fn_create_workflow_run` (`lib/orchestrationBridge.ts:1436+`); existuje **`lib/decisionProvenance.ts`** — hierarchie autorit rozhodnutí (ruleset_snapshot > compliance_policy > orchestration_policy > knowledge_retrieval > model_heuristic > fallback) se zákazem tichého override | ACS staví na traceparent + ai_runs + decisionProvenance (R3/R7 = rozšíření o intent lineage), nezavádí paralelní svět |
| 5 | Tabulky `ai_runs`/`ai_trace_events` existují | ✅ | `orchestrationBridge.ts`, `costAggregator.ts`, `decisionProvenance.ts`; navíc `ai_workflow_definitions`, `ai_workflow_node_runs` (ToT doc + seed) | Beze změny |
| 6 | toolExecutor má validaci parametrů a ACL guardy | ✅ | Param validace (`lib/toolExecutor.ts` ~ř. 160), channel-centric `allowed_tools`, guardrails access level, SSRF guard (`@aisha/security`) | Beze změny |
| 7 | llmRouter = multi-provider abstrakce s `unifiedChat` | ✅ | `lib/llmRouter.ts` (OpenAI, Anthropic, Google, Ollama, Docker, vLLM, MLX, maestro), `routes/chat.ts:983` | Doplněno: skutečné dispatch jádro je `packages/llm-dispatch` (BackendRegistry) → IP-1 pokrývá i registry |
| 8 | Codegen pipeline `npm run gen:ide` | ✅ | `package.json:150–152` (`generate-ide-instructions.mjs`); navíc `gen:catalog` a `db:types:gen:local` (`scripts/db/gen-types.mjs`) | Beze změny; `db:types:gen:local` označen jako přirozený domov generování kontraktních typů |
| 9 | „31 microservices" (tvrzení průzkumu, do ACS se nedostalo) | ❌ | 28 (`ls services`) | Jen pro záznam |
| 10 | OWASP guardy | ✅ | `svc-aitg-probes` (toxic-output probe), `createSafeLogger` (OWASP A09) v event-worker | Beze změny |
| 11 | **ToT/reflection vrstva v ACS v1.0 zcela chyběla** | ❌ opomenutí | ToT v1 je na `main`: `reflection/graphs/reasoning-tree-reflect.json`, nody `tot_planner`/`tot_expand`/`tot_evaluate`/`tot_search`, strom ve `state.tot`, seed `aisha/db/seed/core/33_reflection_graphs.sql`. Graf v JSONB **bez DB constraintů**; jediná typová brána = Zod `NodeTypeSchema` + registr `NODE_HANDLERS` (`reflection/types.ts`, `tot/types.ts`) | Nová sekce ACS §4 (ACS × ToT) + nový injection point IP-11 |

## Root cause analýza

**Primární příčina:** architektura byla převzata ze shrnutí průzkumného subagenta bez vlastní verifikace proti zdroji. To je přesně failure mode, který ACS zakazuje — *derived* tvrzení bez `source_ref` přijato jako fakt (porušení R3/R7 v mém vlastním procesu). Audit sám je důkaz teze standardu: interpretace bez kotvy na originál se stala kritickým místem.

**Sekundární příčina:** platforma **záměrně emuluje Supabase API** (gateway: rest/storage/functions/realtime proxy, apikey pattern) a starší dokumenty odkazují na `supabase/functions/` — povrchní průzkum bez čtení gateway kódu tak zákonitě vyhodnotí „Supabase". Kompatibilní povrch ≠ produkt pod ním.

**Terciární příčina:** useknutá evidence (viz Metodika) málem vyrobila druhý chybný nález. Pravidlo pro ACS verifier: verdikt jen nad úplným důkazem, jinak `insufficient_evidence`, nikdy odhad.

## ToT — hloubkový nález (proč je to pro ACS nejdůležitější místo)

Ověřený stav: `ThoughtNode {id, parent, depth, content: string, status: unevaluated|sure|maybe|impossible, score}`, `ToTPolicy {bfs|dfs|beam, wave_width, sure_threshold 0.80, impossible_threshold 0.35, max_expansions}`, routing plochým `tot_action` enumem, audit uzlů v `ai_workflow_node_runs`, checkpointing, deliberation kernel (`deliberation/planDeliberation.ts`), `clow` kontrakt + `runtime_dispatch`, fleet mód v návrhu ([AISHA_ORCHESTRATION_MASTERPLAN.md](proposals/AISHA_ORCHESTRATION_MASTERPLAN.md)).

Klíčové zjištění: **uvnitř ToT stromu se komunikační šum kumuluje nejrychleji v celé platformě** — `content` je volná próza, každá expanze re-enkóduje rodiče, evaluace prózu interpretuje; hloubka *d* = *d* překódování. Větev může být „sure" vůči svému rodiči a přitom driftovat od zadání — strom bez kotvy optimalizuje konzistenci se sebou samým, ne se zadáním. Řídicí rovina je naopak už dnes z velké části čistá (uzavřené enumy `ThoughtStatus`/`tot_action` — nativní soulad s R2). Slabiny: výstupy nodů se mergují do `state.tot` bez schema validace, graf definice nemají registr/verze, myšlenky nenesou `intent_id`, fleet komunikace nemá envelope. Kompletní mapování R1–R7 na ToT: [AGENT_COMMUNICATION_STANDARD.md §4](AGENT_COMMUNICATION_STANDARD.md).

## Provedené opravy (ACS v1.0 → v1.1)

Odstraněn pojem Supabase (IP-3, §1.1, §3 přepsány na PostgreSQL + postgrest vrstvu + `aisha/db`); doplněn reflection engine a ToT jako první občan standardu (nová §4, IP-11, ToT stopa ve fázích plánu); přiznány existující základy (traceparent, decisionProvenance, ai_runs) místo jejich ignorování; NOTIFY limit → ID-only envelope na transportu; llm-dispatch registry zahrnut do IP-1.
