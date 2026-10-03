# AISHA — Adresář schopností (Capability Catalog)

> Auto-generated from AISHA Expert Overlay ruleset.
> **Neupravuj ručně** — zdrojem pravdy je git working tree. Přegeneruj přes `npm run gen:catalog`.
> Generated: 2026-07-28T18:58:00.801Z

Strojově čitelná podoba: [`capabilities.json`](./capabilities.json).
Tento adresář vzniká skenováním repozitáře — co AISHA a vývojáři mají k dispozici, co to dělá a jak to použít.

## Přehled

| Kategorie | Počet |
|---|---|
| Služby (microservices) | 27 |
| Sdílené balíčky | 23 |
| Pluginy | 4 |
| Šablony domén | 8 |
| Agent commandy | 33 |
| Agent skilly | 8 |
| MCP nástroje | 39 |
| n8n workflows | 93 |
| DB katalogy a registry | 18 |
| npm skript skupiny | 50 |
| **Celkem** | **303** |

## Kategorie

### Služby (microservices)

Samostatně nasaditelné backend služby (services/*).

| Položka | Co to je | Jak použít | Kde |
|---|---|---|---|
| event-worker |  | `microservice — viz docker-compose.*.yml` | `services/event-worker` |
| gateway |  | `microservice — viz docker-compose.*.yml (Dockerfile.gateway)` | `services/gateway` |
| storage-auth |  | `microservice — viz docker-compose.*.yml` | `services/storage-auth` |
| svc-agent-runner |  | `microservice — viz docker-compose.*.yml (Dockerfile.svc-agent-runner)` | `services/svc-agent-runner` |
| svc-ai-chat |  | `microservice — viz docker-compose.*.yml (Dockerfile.svc-ai-chat)` | `services/svc-ai-chat` |
| svc-aisha-kronos-shim |  | `microservice — viz docker-compose.*.yml (Dockerfile.svc-aisha-kronos-shim)` | `services/svc-aisha-kronos-shim` |
| svc-aitg-probes |  | `microservice — viz docker-compose.*.yml` | `services/svc-aitg-probes` |
| svc-blockchain |  | `microservice — viz docker-compose.*.yml` | `services/svc-blockchain` |
| svc-communications |  | `microservice — viz docker-compose.*.yml` | `services/svc-communications` |
| svc-fio-bank |  | `microservice — viz docker-compose.*.yml` | `services/svc-fio-bank` |
| svc-github-app |  | `microservice — viz docker-compose.*.yml` | `services/svc-github-app` |
| svc-health-ai |  | `microservice — viz docker-compose.*.yml` | `services/svc-health-ai` |
| svc-homeassistant |  | `microservice — viz docker-compose.*.yml` | `services/svc-homeassistant` |
| svc-ide-context | Backend single-source-of-truth for dynamic agent instruction broadcasting across IDEs (Claude Code, Cursor, Copilot, JetBrains future). Phase 13.1 of canonical 90-day plan. | `microservice — viz docker-compose.*.yml` | `services/svc-ide-context` |
| svc-livekit |  | `microservice — viz docker-compose.*.yml` | `services/svc-livekit` |
| svc-matrix |  | `microservice — viz docker-compose.*.yml` | `services/svc-matrix` |
| svc-mcp-knowledge |  | `microservice — viz docker-compose.*.yml (Dockerfile.svc-mcp-knowledge)` | `services/svc-mcp-knowledge` |
| svc-openclaw |  | `microservice — viz docker-compose.*.yml` | `services/svc-openclaw` |
| svc-packeta |  | `microservice — viz docker-compose.*.yml` | `services/svc-packeta` |
| svc-pki-bridge |  | `microservice — viz docker-compose.*.yml` | `services/svc-pki-bridge` |
| svc-playwright-runner | Polling worker: get_next_playwright_run → npx playwright test against deployed env → record_playwright_result + upload report. | `microservice — viz docker-compose.*.yml` | `services/svc-playwright-runner` |
| svc-plugin-system |  | `microservice — viz docker-compose.*.yml (Dockerfile.svc-plugin-system)` | `services/svc-plugin-system` |
| svc-push |  | `microservice — viz docker-compose.*.yml` | `services/svc-push` |
| svc-source-broker |  | `microservice — viz docker-compose.*.yml (Dockerfile.svc-source-broker)` | `services/svc-source-broker` |
| svc-stripe |  | `microservice — viz docker-compose.*.yml` | `services/svc-stripe` |
| svc-web-artifact |  | `microservice — viz docker-compose.*.yml` | `services/svc-web-artifact` |
| ws-gateway |  | `microservice — viz docker-compose.*.yml` | `services/ws-gateway` |

### Sdílené balíčky

Interní npm workspace balíčky (packages/*) sdílené napříč službami.

| Položka | Co to je | Jak použít | Kde |
|---|---|---|---|
| acs-contracts | Agent Communication Standard — contract registry source of truth. JSON Schema (2020-12) documents for the ACS envelope and every message type, plus typed exports. Schemas are the canonical, versioned, diffable artefacts (docs/AGENT_COMMUNI… | `import z "@aisha/acs-contracts"` | `packages/acs-contracts` |
| acs-sdk | Agent Communication Standard SDK — the ONLY sanctioned way to create, sign, validate, send and receive inter-agent messages (docs/AGENT_COMMUNICATION_STANDARD.md, IP-2/IP-4). Envelope building (ULID ids, correlation/causation, intent ancho… | `import z "@aisha/acs-sdk"` | `packages/acs-sdk` |
| aisha-ide-bridge | Client-side bridge between IDE workspaces (Claude Code, Cursor, GitHub Copilot) and AISHA svc-ide-context. Syncs CLAUDE.md/.cursorrules/copilot-instructions.md with safe-write semantics — preserves user-authored sections, backs up before w… | `import z "@aisha/ide-bridge"` | `packages/aisha-ide-bridge` |
| aitg | OWASP AI Testing Guide (AITG) v1 — primitives shared across orchestrator services. Catalog metadata, Zod schemas, classifiers, the run emitter, and the `withAitgGuard()` call-site middleware live here so any service touching an LLM call ca… | `import z "@aisha/aitg"` | `packages/aitg` |
| api-core | Platform-agnostic HTTP/Realtime client shared between web and mobile (replaces the legacy hosted-BaaS JS client). | `import z "@aisha/api-core"` | `packages/api-core` |
| audience-types | Universal audience module — TypeScript domain types, IDataSource contract, tier derivation, scope rules. Shared between svc-source-broker, future broker services, and Appsmith bindings. | `import z "@aisha/audience-types"` | `packages/audience-types` |
| cache-redis | Shared Redis client for AISHA services. Wraps ioredis with DB-index isolation, AUTH from URL userinfo or env (username+password), and named primitives for: caching (WP 2.1), JWT revocation (WP 3.5), and realtime state (WP 13.4). Connects t… | `import z "@aisha/cache-redis"` | `packages/cache-redis` |
| capture-ui | Field-capture primitives shared by every surface: what only a person can supply (a signature, later a photo or a reading). Dependency-light on purpose — React only, no component library and no i18n, so a shell without either can use it. Up… | `import z "@aisha/capture-ui"` | `packages/capture-ui` |
| design-tokens |  | `workspace balíček` | `packages/design-tokens` |
| dirigent-core | Editor-neutral AISHA Dirigent contracts for IDE clients, sidecars, and ZEDBENCH. | `import z "@aisha/dirigent-core"` | `packages/dirigent-core` |
| flowboard-core | Engine-agnostic AISHA Flowboard core (ports, registry, graph+validation, engine router, n8n/sandbox compilers, provenance, recipes) shared by the web app and services. | `import z "@aisha/flowboard-core"` | `packages/flowboard-core` |
| insight |  | `workspace balíček` | `packages/insight` |
| llm-dispatch | Multi-provider LLM dispatch — the BackendRegistry + per-provider InferenceBackend implementations (OpenAI, Gemini native generateContent, Anthropic /v1/messages, vLLM/Ollama, llm-gateway, maestro). Shared so every service that resolves a b… | `import z "@aisha/llm-dispatch"` | `packages/llm-dispatch` |
| local-ingest |  | `workspace balíček` | `packages/local-ingest` |
| local-signals |  | `import z "@aisha/local-signals"` | `packages/local-signals` |
| n8n-nodes-aisha | AISHA Platform custom n8n community nodes — AISHA gateway RPC, MCP integration, audit, delivery, self-orchestration | `import z "n8n-nodes-aisha"` | `packages/n8n-nodes-aisha` |
| observability | OpenTelemetry bootstrap + Prometheus metrics adapter for AISHA orchestrator services. Single instrumentation surface, exporter routes to Langfuse OTLP (sole traces backend per Phase 12 plan, no Tempo). | `import z "@aisha/observability"` | `packages/observability` |
| postgrest-client | The ONE PostgREST RPC call contract shared by every AISHA orchestrator service. Replaces the divergent hand-rolled services/*/src/postgrest.ts copies (SVC-01 / D11) with a single canonical client: rpcService / rpcUser / rpcUserClaims + tab… | `import z "@aisha/postgrest-client"` | `packages/postgrest-client` |
| potok |  | `workspace balíček` | `packages/potok` |
| security | OWASP Top 10 hardening primitives shared across all AISHA orchestrator services (Fastify + PostgREST stack). Maps 1:1 to OWASP 2021 categories A01-A10. | `import z "@aisha/security"` | `packages/security` |
| source-adapter-money-s5 | Generic svc-source-broker adapter for Money (Seyfor) S5 API — operational documents (delivery notes '.', issued invoices './invoices') over OAuth2 client_credentials + GraphQL. First-party ecosystem connector; any instance binds its own Mo… | `import z "@aisha/source-adapter-money-s5"` | `packages/source-adapter-money-s5` |
| surface-blocks | Surface-agnostic block contract: schema-versioned view-models with mandatory provenance, fail-closed sensitivity, signed read-only snapshots. Upstream candidate (PR-7/PR-9 payload part). | `import z "@aisha/surface-blocks"` | `packages/surface-blocks` |
| workbench-core | Shared types, interfaces, and platform-agnostic adapters for AISHA Workbench and extensions | `import z "@aisha/workbench-core"` | `packages/workbench-core` |

### Pluginy

Pluginy asimilované AISHA dle plugin-manifest schématu.

| Plugin | id | Co to je | Kind / Trust | Kde |
|---|---|---|---|---|
| Eurowag Telematics | `eurowag-telematics` | Reads vehicle state, trips and drivers from the Eurowag Telematics customer API (the successor to the Webdispečink SOAP endpoint) and promotes them onto the raw signal lane. Optional by construction: a deployment that never touches Eurowag… | data_source / internal | `plugins/eurowag-telematics/manifest.json` |
| Partner Metrics Dashboard | `partner-metrics` | Reference full_stack plugin. Aggregates partner KPIs, generates AI summaries, exposes API routes for a metrics dashboard. | full_stack / internal | `plugins/partner-metrics/manifest.json` |
| T-cars Fleet | `tcars-fleet` | Reads vehicles, people, groups and the journey log from the T-cars SOAP WebService v2 and promotes them onto the raw signal lane. Optional by construction: a deployment without a T-cars contract simply does not install it. | data_source / internal | `plugins/tcars-fleet/manifest.json` |
| Webdispečink Fleet | `webdispecink-fleet` | Reads vehicles, drivers, positions and the log book from the Webdispečink SOAP API 2.0 and promotes them onto the raw signal lane. Kept alongside the Eurowag plugin rather than replaced by it: measured against the same tenant, this endpoin… | backend_provider / internal | `plugins/webdispecink-fleet/manifest.json` |

### Šablony domén

Předpřipravené šablony webů/domén (domains/templates/*).

| Položka | Co to je | Jak použít | Kde |
|---|---|---|---|
| aisha.guru |  | `šablona domény: aisha.guru` | `domains/templates/aisha.guru` |
| cafe-shop |  | `šablona domény: cafe-shop` | `domains/templates/cafe-shop` |
| company-wiki |  | `šablona domény: company-wiki` | `domains/templates/company-wiki` |
| electrician-trade |  | `šablona domény: electrician-trade` | `domains/templates/electrician-trade` |
| farm-shop |  | `šablona domény: farm-shop` | `domains/templates/farm-shop` |
| garden-blog |  | `šablona domény: garden-blog` | `domains/templates/garden-blog` |
| legal-advisory |  | `šablona domény: legal-advisory` | `domains/templates/legal-advisory` |
| site-supervision |  | `šablona domény: site-supervision` | `domains/templates/site-supervision` |

### Agent commandy

Slash-commandy pro Claude/IDE (.claude/commands/*).

| Položka | Co to je | Jak použít | Kde |
|---|---|---|---|
| AISHA Dirigent — Manual Advisor Review | Invoke the read-only AISHA Dirigent expert advisor subagent to review the | `/aisha-advise` | `.claude/commands/aisha-advise.md` |
| AISHA Compliance Gate | Check PR/branch compliance against platform standards before merge. | `/aisha-compliance` | `.claude/commands/aisha-compliance.md` |
| AISHA Dirigent — Cooldown Manager | List or clear active cooldown timers for advisory hooks. Each advisory rule | `/aisha-cooldowns` | `.claude/commands/aisha-cooldowns.md` |
| AISHA Database Operations | Run database management operations. | `/aisha-db` | `.claude/commands/aisha-db.md` |
| AISHA — Deploy Flow Operations | Provádí operace na 4-fázovém samořídicím deploy flow (drift, B/G, Sentry, dashboard). | `/aisha-deploy-flow` | `.claude/commands/aisha-deploy-flow.md` |
| AISHA Deployment Workflow | Guide through the deployment process with pre-flight validation. | `/aisha-deploy` | `.claude/commands/aisha-deploy.md` |
| AISHA — Documentation (Diataxis, from code) | Generate or refresh docs that actually match what shipped, using the Diataxis | `/aisha-document` | `.claude/commands/aisha-document.md` |
| AISHA Effort Estimation | Estimate development effort for a task. | `/aisha-estimate` | `.claude/commands/aisha-estimate.md` |
| AISHA System Health Check | Check connectivity and status of all platform services. | `/aisha-health` | `.claude/commands/aisha-health.md` |
| AISHA — Scaffold New Migration | Vytvoří novou migraci s SoT párem podle AISHA pravidel. | `/aisha-migrate-new` | `.claude/commands/aisha-migrate-new.md` |
| AISHA Next Step | Suggest what to do next based on current project context. | `/aisha-next` | `.claude/commands/aisha-next.md` |
| /aisha-propose-rule — turn local customizations into rule proposals | description: Scan generated IDE instruction files (CLAUDE.md, .cursorrules, copilot-instructions.md, …) for user-section customizations and queue them as rule proposals for the AISHA Dirigent knowledge base. Read-only by default — nothing … | `/aisha-propose-rule` | `.claude/commands/aisha-propose-rule.md` |
| AISHA — QA (real browser, real flows) | Exercise the app the way a user would, find bugs, fix them with atomic commits, | `/aisha-qa` | `.claude/commands/aisha-qa.md` |
| AISHA Code Quality Audit | Assess code quality against AISHA platform standards. | `/aisha-quality` | `.claude/commands/aisha-quality.md` |
| AISHA — Staff Engineer Review | Find the bugs that pass CI but blow up in production. The companion to | `/aisha-review` | `.claude/commands/aisha-review.md` |
| /aisha-router-config — switch slot profile | description: Switch AISHA router slot profile (budget / balanced / maxQuality) for the current dev session. Updates .aisha/dirigent.json locally; never pushes prod env. Use when router-coach advisory suggests profile change due to cost ove… | `/aisha-router-config` | `.claude/commands/aisha-router-config.md` |
| AISHA — Security Review (OWASP + STRIDE) | An adversarial security pass over a change. Leans on the platform's existing | `/aisha-security` | `.claude/commands/aisha-security.md` |
| AISHA Claude Code Setup | Interactive onboarding for new developers. Run this after `git clone` + `npm install`. | `/aisha-setup` | `.claude/commands/aisha-setup.md` |
| AISHA Story Context | Manage the active story/project context. | `/aisha-story` | `.claude/commands/aisha-story.md` |
| AISHA Dirigent — Supervisor Status | Show the current state of the AISHA Dirigent runtime supervision overlay: | `/aisha-supervise` | `.claude/commands/aisha-supervise.md` |
| AISHA Test Strategy | Evaluate and run test strategy for the specified file or hook. | `/aisha-test` | `.claude/commands/aisha-test.md` |
| Ads Agent — delegate to the `os-ads` agent | Creates ad concepts and campaign assets. (creative → campaigns) | `/os-ads` | `.claude/commands/os-ads.md` |
| Content Agent — delegate to the `os-content` agent | Turns ideas into posts, scripts, and visual briefs. (ideas → posts) | `/os-content` | `.claude/commands/os-content.md` |
| Docs Agent — delegate to the `os-docs` agent | Organizes docs, SOPs, and knowledge bases. (docs → memory) | `/os-docs` | `.claude/commands/os-docs.md` |
| Finance Agent — delegate to the `os-finance` agent | Tracks revenue, pricing, and cash decisions. (revenue → decisions) | `/os-finance` | `.claude/commands/os-finance.md` |
| Leads Agent — delegate to the `os-leads` agent | Finds leads, buyers, and partnership targets. (leads → buyers) | `/os-leads` | `.claude/commands/os-leads.md` |
| Ops Agent — delegate to the `os-ops` agent | Runs workflows, SOPs, and weekly planning. (tasks → systems) | `/os-ops` | `.claude/commands/os-ops.md` |
| Product Agent — delegate to the `os-product` agent | Turns customer pain into roadmap items. (pain → roadmap) | `/os-product` | `.claude/commands/os-product.md` |
| Research Agent — delegate to the `os-research` agent | Finds market signals and source-backed research. (signals → patterns) | `/os-research` | `.claude/commands/os-research.md` |
| Review Agent — delegate to the `os-review` agent | Checks voice, accuracy, and ship quality. (quality → ship/no-ship) | `/os-review` | `.claude/commands/os-review.md` |
| Sales Agent — delegate to the `os-sales` agent | Writes outreach, follow-ups, and deal notes. (outreach → deals) | `/os-sales` | `.claude/commands/os-sales.md` |
| Ship gate — the "anyone test" before anything leaves the company | Run the fleet's review agent (`os-review`) on an artifact before | `/os-ship` | `.claude/commands/os-ship.md` |
| Weekly brief — plan the week with the fleet | The `/os-weekly` ritual keeps `company-os/brain/weekly-brief.md` the live | `/os-weekly` | `.claude/commands/os-weekly.md` |

### Agent skilly

Skilly pro Claude/IDE (.claude/skills/*).

| Položka | Co to je | Jak použít | Kde |
|---|---|---|---|
| aisha-deploy-flow | Operate the AISHA 4-phase autonomous deploy flow — drift detection (Phase 1), blue/green orchestration (Phase 2), Sentry-driven rollback (Phase 3), and Appsmith dashboard regeneration (Phase 4). Use when investigating drift, triggering man… | `skill: aisha-deploy-flow` | `.claude/skills/aisha-deploy-flow/SKILL.md` |
| aisha-edge-fn | Create or modify a Fastify route ("edge function") in an AISHA orchestrator microservice (services/svc-*/src/routes/*.ts) with applySecurity, JWT auth, Zod validation, audited RPC calls, AITG guard on every LLM call, and SSRF-safe outbound… | `skill: aisha-edge-fn` | `.claude/skills/aisha-edge-fn/SKILL.md` |
| aisha-migration | Create database migrations for the AISHA platform with proper SoT (source-of-truth) pairing. Use when adding new tables, RPC functions, indexes, RLS policies, or modifying schema. Triggers on "create migration", "add table", "new RPC", "sc… | `skill: aisha-migration` | `.claude/skills/aisha-migration/SKILL.md` |
| aisha-n8n-workflow | Create n8n workflows for the AISHA platform with proper aishaRpc integration, audit trail, approval gate routing, and idempotent execution. Use when creating new n8n workflows (WF_*), modifying existing ones, or designing autonomous loops.… | `skill: aisha-n8n-workflow` | `.claude/skills/aisha-n8n-workflow/SKILL.md` |
| aisha-router-tuning | Tune AISHA's Soulforge slot routing + Dirigent router-coach advisory + LLM Gateway profile. Use when developer wants to switch slot profile (budget/balanced/maxQuality), debug rolling cost in dev session, configure ANTHROPIC_BASE_URL for t… | `skill: aisha-router-tuning` | `.claude/skills/aisha-router-tuning/SKILL.md` |
| aisha-rpc | Write Postgres RPC functions for the AISHA platform with SECURITY DEFINER + REVOKE/GRANT pattern, audit trail, decision provenance, and proper search_path isolation. Use when creating new RPC functions, modifying existing ones, or auditing… | `skill: aisha-rpc` | `.claude/skills/aisha-rpc/SKILL.md` |
| aisha-supervisor | AISHA Dirigent runtime supervision overlay for Claude Code agents. Use when working in this repo to understand how the agent is being advised in real time (PreToolUse / PostToolUse / Stop hooks), how to read advisory output, how to invoke … | `skill: aisha-supervisor` | `.claude/skills/aisha-supervisor/SKILL.md` |
| aisha-surfaces | Work on the extranet surfaces — sections, block masks, and deploying a surface SPA. Use when adding or changing a section (porada, workbench, registry, ask, mission_control), adding a block type, wiring a block to a data RPC, or provisioni… | `skill: aisha-surfaces` | `.claude/skills/aisha-surfaces/SKILL.md` |

### MCP nástroje

Nástroje vystavené MCP knowledge serverem (svc-mcp-knowledge).

| Položka | Co to je | Jak použít | Kde |
|---|---|---|---|
| admin_health_check | Return MCP adapter and knowledge-store health details. | `MCP tool: admin_health_check` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_auto_close_findings | Auto-close findings whose subsequent runs show N consecutive passes. Keeps the open-findings list signal-rich. | `MCP tool: aitg_auto_close_findings` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_classify_response | Run a heuristic AITG classifier (prompt injection / canary leak / toxicity) on arbitrary text without persisting. Use for self-review before sending. | `MCP tool: aitg_classify_response` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_detect_drift | Run WoW pass-rate drift detection. Creates aitg_drift_alerts rows when a test drops below threshold. | `MCP tool: aitg_detect_drift` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_get_automation | Fetch one automation by id (continuous_heartbeat, daily_reflection, nightly_full_sweep, drift_detection, auto_close_findings, runtime_sentinel, pr_gate, callsite_guard_default). | `MCP tool: aitg_get_automation` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_get_coverage | Read pass-rate per AITG test over a sliding window. Use for periodic self-assessment. | `MCP tool: aitg_get_coverage` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_get_trust_score | Single weighted trust score (0..100) across all enabled AITG tests. Use as the headline metric for self-evaluation. | `MCP tool: aitg_get_trust_score` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_health_summary | One-shot self-orientation: trust score, total runs, open findings, open drift alerts, last reflection. Call at session start. | `MCP tool: aitg_health_summary` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_list_automations | List every AITG automation with mode (automated/manual/disabled), schedule, parameters, last run. Operator-side: read-only view of the DB-controlled cadence. | `MCP tool: aitg_list_automations` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_list_open_findings | List failed AITG findings without remediation, ordered by severity. Use to discover what to fix next. | `MCP tool: aitg_list_open_findings` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_next_in_queue | Read the adaptive scheduling queue: which tests should run next based on staleness × severity + recent failures + open drifts. | `MCP tool: aitg_next_in_queue` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_observe_trend | Read your own reflection history (chronological). Use to remember your trajectory across sessions. | `MCP tool: aitg_observe_trend` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_propose_payload | Propose a new adversarial payload to the corpus. Stays pending until admin approval; does NOT activate without human review. | `MCP tool: aitg_propose_payload` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_propose_remediation | Attach a remediation proposal to an open finding. Proposal goes through the existing approval gate before any code change. | `MCP tool: aitg_propose_remediation` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_record_automation_run | Workflow callback after execution: updates last_run_at + last_run_status. Not for direct user invocation. | `MCP tool: aitg_record_automation_run` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_record_reflection | Append a reflection diary entry: short narrative + proposed actions. Auto-populates trust delta and counts from the live state. | `MCP tool: aitg_record_reflection` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_request_waiver | Request a time-bound waiver for a failing test. Auto-expires; requires justification ≥ 20 chars. | `MCP tool: aitg_request_waiver` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_run_test | Execute a single AITG runtime probe (AITG-APP-01/03/12, AITG-DAT-02) by dispatching svc-aitg-probes. Use to verify a specific suspected weakness. | `MCP tool: aitg_run_test` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_trigger_automation | Manual trigger — invokes the automation regardless of schedule. Returns trigger_id. | `MCP tool: aitg_trigger_automation` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| aitg_update_automation | Admin-only. Change mode, cron, interval, or parameters. | `MCP tool: aitg_update_automation` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| compose_context | Compose a multi-layer AI context bundle for a story and context profile. | `MCP tool: compose_context` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| draft_flow | AISHA drafts a Flowboard graph (nodes+edges JSON) from an intent. Beta: the help@ inbox recipe. The user finishes it on the canvas; compiled app-side to n8n or the governed sandbox. | `MCP tool: draft_flow` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_agent_knowledge | Load knowledge bindings for an AISHA agent slug. | `MCP tool: get_agent_knowledge` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_design_profile | Load the design DNA (brand/UX profile) for a partner id. | `MCP tool: get_design_profile` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_expert_rule | Load one published expert rule by slug. | `MCP tool: get_expert_rule` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_expertise_areas | List active expertise areas and rule counts. | `MCP tool: get_expertise_areas` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_flowboard_registry | Federated Flowboard palette feed: active agent_catalog agents. The frontend merges this with builtin + MCP-tool + n8n node providers. | `MCP tool: get_flowboard_registry` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_knowledge_item | Load one knowledge item by id or source slug. | `MCP tool: get_knowledge_item` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_knowledge_stats | Return knowledge base counts and embedding coverage. | `MCP tool: get_knowledge_stats` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_knowledge_topics_localized | List knowledge topics with localized title/summary for a locale. | `MCP tool: get_knowledge_topics_localized` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_model_registry | List AI model registry entries, optionally filtered by provider / eval status. | `MCP tool: get_model_registry` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_public_chat_channel_config | Load the active public-chat channel configuration by channel slug. | `MCP tool: get_public_chat_channel_config` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| get_story_context | Load a story context bundle by story id. | `MCP tool: get_story_context` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| list_public_chat_channels | List the public-chat channel registry. | `MCP tool: list_public_chat_channels` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| match_experts | Find experts matching an expertise area or context tags. | `MCP tool: match_experts` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| route_task | Route a task kind/risk profile to the AISHA agent pipeline. | `MCP tool: route_task` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| search_knowledge | Search expert rules and AISHA knowledge by text, category, expertise area, or context tags. | `MCP tool: search_knowledge` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| search_knowledge_v2 | Hybrid AISHA knowledge search using text fallback and optional metadata filters. | `MCP tool: search_knowledge_v2` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |
| validate_compliance | Run lightweight AISHA platform compliance checks for a code or design snippet. | `MCP tool: validate_compliance` | `services/svc-mcp-knowledge/src/routes/mcp.ts` |

### n8n workflows

Orchestrace a self-learning workflows (n8n/workflows/*).

| Položka | Co to je | Jak použít | Kde |
|---|---|---|---|
| WF_ADMIN_HEALTH_MONITOR |  | `n8n workflow: WF_ADMIN_HEALTH_MONITOR` | `n8n/workflows/WF_ADMIN_HEALTH_MONITOR.json` |
| WF_ADMIN_ORCHESTRATION |  | `n8n workflow: WF_ADMIN_ORCHESTRATION` | `n8n/workflows/WF_ADMIN_ORCHESTRATION.json` |
| WF_AISHA_COMMAND_FACTORY |  | `n8n workflow: WF_AISHA_COMMAND_FACTORY` | `n8n/workflows/WF_AISHA_COMMAND_FACTORY.json` |
| WF_AISHA_HOOK_FACTORY |  | `n8n workflow: WF_AISHA_HOOK_FACTORY` | `n8n/workflows/WF_AISHA_HOOK_FACTORY.json` |
| WF_AISHA_SKILL_FACTORY |  | `n8n workflow: WF_AISHA_SKILL_FACTORY` | `n8n/workflows/WF_AISHA_SKILL_FACTORY.json` |
| WF_AISHA_TOOLING_COMMITTER |  | `n8n workflow: WF_AISHA_TOOLING_COMMITTER` | `n8n/workflows/WF_AISHA_TOOLING_COMMITTER.json` |
| WF_AISHA_TOOLING_OBSERVER |  | `n8n workflow: WF_AISHA_TOOLING_OBSERVER` | `n8n/workflows/WF_AISHA_TOOLING_OBSERVER.json` |
| WF_AITG_CONTINUOUS |  | `n8n workflow: WF_AITG_CONTINUOUS` | `n8n/workflows/WF_AITG_CONTINUOUS.json` |
| WF_AITG_DAILY_REFLECTION |  | `n8n workflow: WF_AITG_DAILY_REFLECTION` | `n8n/workflows/WF_AITG_DAILY_REFLECTION.json` |
| WF_AITG_NIGHTLY_FULL |  | `n8n workflow: WF_AITG_NIGHTLY_FULL` | `n8n/workflows/WF_AITG_NIGHTLY_FULL.json` |
| WF_AITG_PR_GATE |  | `n8n workflow: WF_AITG_PR_GATE` | `n8n/workflows/WF_AITG_PR_GATE.json` |
| WF_AITG_RUNTIME_SENTINEL |  | `n8n workflow: WF_AITG_RUNTIME_SENTINEL` | `n8n/workflows/WF_AITG_RUNTIME_SENTINEL.json` |
| WF_ALE_FEEDBACK_PROCESSOR |  | `n8n workflow: WF_ALE_FEEDBACK_PROCESSOR` | `n8n/workflows/WF_ALE_FEEDBACK_PROCESSOR.json` |
| WF_APPROVAL_GATE |  | `n8n workflow: WF_APPROVAL_GATE` | `n8n/workflows/WF_APPROVAL_GATE.json` |
| WF_APPSMITH_DASHBOARD_BUILDER |  | `n8n workflow: WF_APPSMITH_DASHBOARD_BUILDER` | `n8n/workflows/WF_APPSMITH_DASHBOARD_BUILDER.json` |
| WF_BATCH_POLLER |  | `n8n workflow: WF_BATCH_POLLER` | `n8n/workflows/WF_BATCH_POLLER.json` |
| WF_BATCH_RESUMER |  | `n8n workflow: WF_BATCH_RESUMER` | `n8n/workflows/WF_BATCH_RESUMER.json` |
| WF_BLOCKCHAIN_SYNC |  | `n8n workflow: WF_BLOCKCHAIN_SYNC` | `n8n/workflows/WF_BLOCKCHAIN_SYNC.json` |
| WF_BLUE_GREEN_ORCHESTRATOR |  | `n8n workflow: WF_BLUE_GREEN_ORCHESTRATOR` | `n8n/workflows/WF_BLUE_GREEN_ORCHESTRATOR.json` |
| WF_CHUNK_CONTEXT_BACKFILL |  | `n8n workflow: WF_CHUNK_CONTEXT_BACKFILL` | `n8n/workflows/WF_CHUNK_CONTEXT_BACKFILL.json` |
| WF_COMPLIANCE_AGENT |  | `n8n workflow: WF_COMPLIANCE_AGENT` | `n8n/workflows/WF_COMPLIANCE_AGENT.json` |
| WF_COMPLIANCE_REROUTE |  | `n8n workflow: WF_COMPLIANCE_REROUTE` | `n8n/workflows/WF_COMPLIANCE_REROUTE.json` |
| WF_DEBUG_AGENT |  | `n8n workflow: WF_DEBUG_AGENT` | `n8n/workflows/WF_DEBUG_AGENT.json` |
| WF_DELIVERY_AGENT |  | `n8n workflow: WF_DELIVERY_AGENT` | `n8n/workflows/WF_DELIVERY_AGENT.json` |
| WF_DEPLOY_STORY |  | `n8n workflow: WF_DEPLOY_STORY` | `n8n/workflows/WF_DEPLOY_STORY.json` |
| WF_DESIGN_DNA_INTERVIEW |  | `n8n workflow: WF_DESIGN_DNA_INTERVIEW` | `n8n/workflows/WF_DESIGN_DNA_INTERVIEW.json` |
| WF_DEV_PATCH |  | `n8n workflow: WF_DEV_PATCH` | `n8n/workflows/WF_DEV_PATCH.json` |
| WF_DIRIGENT_AGENT |  | `n8n workflow: WF_DIRIGENT_AGENT` | `n8n/workflows/WF_DIRIGENT_AGENT.json` |
| WF_DIRIGENT_AGENT_WATCHDOG |  | `n8n workflow: WF_DIRIGENT_AGENT_WATCHDOG` | `n8n/workflows/WF_DIRIGENT_AGENT_WATCHDOG.json` |
| WF_DIRIGENT_BRIEFING |  | `n8n workflow: WF_DIRIGENT_BRIEFING` | `n8n/workflows/WF_DIRIGENT_BRIEFING.json` |
| WF_DIRIGENT_CLI_SPAWNER |  | `n8n workflow: WF_DIRIGENT_CLI_SPAWNER` | `n8n/workflows/WF_DIRIGENT_CLI_SPAWNER.json` |
| WF_DIRIGENT_COMPLIANCE_ENFORCEMENT |  | `n8n workflow: WF_DIRIGENT_COMPLIANCE_ENFORCEMENT` | `n8n/workflows/WF_DIRIGENT_COMPLIANCE_ENFORCEMENT.json` |
| WF_DIRIGENT_COMPLIANCE_PRE_CHECK |  | `n8n workflow: WF_DIRIGENT_COMPLIANCE_PRE_CHECK` | `n8n/workflows/WF_DIRIGENT_COMPLIANCE_PRE_CHECK.json` |
| WF_DIRIGENT_GOAL_EVALUATOR |  | `n8n workflow: WF_DIRIGENT_GOAL_EVALUATOR` | `n8n/workflows/WF_DIRIGENT_GOAL_EVALUATOR.json` |
| WF_DIRIGENT_INTENT_ADVISOR |  | `n8n workflow: WF_DIRIGENT_INTENT_ADVISOR` | `n8n/workflows/WF_DIRIGENT_INTENT_ADVISOR.json` |
| WF_DRIFT_OBSERVER |  | `n8n workflow: WF_DRIFT_OBSERVER` | `n8n/workflows/WF_DRIFT_OBSERVER.json` |
| WF_EMBEDDING_REFRESH |  | `n8n workflow: WF_EMBEDDING_REFRESH` | `n8n/workflows/WF_EMBEDDING_REFRESH.json` |
| WF_EXPERT_NOTIFICATION |  | `n8n workflow: WF_EXPERT_NOTIFICATION` | `n8n/workflows/WF_EXPERT_NOTIFICATION.json` |
| WF_FINE_TUNE_JOB |  | `n8n workflow: WF_FINE_TUNE_JOB` | `n8n/workflows/WF_FINE_TUNE_JOB.json` |
| WF_FIX_PROPOSER |  | `n8n workflow: WF_FIX_PROPOSER` | `n8n/workflows/WF_FIX_PROPOSER.json` |
| WF_GRAPH_EXTRACT_NIGHTLY |  | `n8n workflow: WF_GRAPH_EXTRACT_NIGHTLY` | `n8n/workflows/WF_GRAPH_EXTRACT_NIGHTLY.json` |
| WF_GUILD_MATCH |  | `n8n workflow: WF_GUILD_MATCH` | `n8n/workflows/WF_GUILD_MATCH.json` |
| WF_IMPROVEMENT_EVAL |  | `n8n workflow: WF_IMPROVEMENT_EVAL` | `n8n/workflows/WF_IMPROVEMENT_EVAL.json` |
| WF_INSIGHT_DIALOG_EVAL |  | `n8n workflow: WF_INSIGHT_DIALOG_EVAL` | `n8n/workflows/WF_INSIGHT_DIALOG_EVAL.json` |
| WF_INTRANET_TEMPLATE_SYNC |  | `n8n workflow: WF_INTRANET_TEMPLATE_SYNC` | `n8n/workflows/WF_INTRANET_TEMPLATE_SYNC.json` |
| WF_INTRANET_USER_ONBOARD |  | `n8n workflow: WF_INTRANET_USER_ONBOARD` | `n8n/workflows/WF_INTRANET_USER_ONBOARD.json` |
| WF_KB_COMPLIANCE_GATE |  | `n8n workflow: WF_KB_COMPLIANCE_GATE` | `n8n/workflows/WF_KB_COMPLIANCE_GATE.json` |
| WF_KB_RAGNAROK_SYNC |  | `n8n workflow: WF_KB_RAGNAROK_SYNC` | `n8n/workflows/WF_KB_RAGNAROK_SYNC.json` |
| WF_KNOWLEDGE_AGENT |  | `n8n workflow: WF_KNOWLEDGE_AGENT` | `n8n/workflows/WF_KNOWLEDGE_AGENT.json` |
| WF_LANGFUSE_PERFORMANCE_REVIEW |  | `n8n workflow: WF_LANGFUSE_PERFORMANCE_REVIEW` | `n8n/workflows/WF_LANGFUSE_PERFORMANCE_REVIEW.json` |
| WF_LEDGER_CHAIN_ANCHOR |  | `n8n workflow: WF_LEDGER_CHAIN_ANCHOR` | `n8n/workflows/WF_LEDGER_CHAIN_ANCHOR.json` |
| WF_LEDGER_CHAIN_VERIFY |  | `n8n workflow: WF_LEDGER_CHAIN_VERIFY` | `n8n/workflows/WF_LEDGER_CHAIN_VERIFY.json` |
| WF_MAESTRO_DIALOG_AGENT |  | `n8n workflow: WF_MAESTRO_DIALOG_AGENT` | `n8n/workflows/WF_MAESTRO_DIALOG_AGENT.json` |
| WF_MATRIX_AISHA_TRIAGE |  | `n8n workflow: WF_MATRIX_AISHA_TRIAGE` | `n8n/workflows/WF_MATRIX_AISHA_TRIAGE.json` |
| WF_MCP_BRIDGE |  | `n8n workflow: WF_MCP_BRIDGE` | `n8n/workflows/WF_MCP_BRIDGE.json` |
| WF_MCP_PROBE |  | `n8n workflow: WF_MCP_PROBE` | `n8n/workflows/WF_MCP_PROBE.json` |
| WF_MODEL_ADVISORY |  | `n8n workflow: WF_MODEL_ADVISORY` | `n8n/workflows/WF_MODEL_ADVISORY.json` |
| WF_MODEL_BENCHMARK |  | `n8n workflow: WF_MODEL_BENCHMARK` | `n8n/workflows/WF_MODEL_BENCHMARK.json` |
| WF_MODEL_ROUTER |  | `n8n workflow: WF_MODEL_ROUTER` | `n8n/workflows/WF_MODEL_ROUTER.json` |
| WF_NIGHTLY_STORY_AUDIT |  | `n8n workflow: WF_NIGHTLY_STORY_AUDIT` | `n8n/workflows/WF_NIGHTLY_STORY_AUDIT.json` |
| WF_NODE_FACTORY |  | `n8n workflow: WF_NODE_FACTORY` | `n8n/workflows/WF_NODE_FACTORY.json` |
| WF_OCCIPITUM_DESIGN |  | `n8n workflow: WF_OCCIPITUM_DESIGN` | `n8n/workflows/WF_OCCIPITUM_DESIGN.json` |
| WF_OCCIPITUM_REDESIGN |  | `n8n workflow: WF_OCCIPITUM_REDESIGN` | `n8n/workflows/WF_OCCIPITUM_REDESIGN.json` |
| WF_OPENCLAW_NOTIFY |  | `n8n workflow: WF_OPENCLAW_NOTIFY` | `n8n/workflows/WF_OPENCLAW_NOTIFY.json` |
| WF_OPENCLAW_SANDBOX_RUNNER |  | `n8n workflow: WF_OPENCLAW_SANDBOX_RUNNER` | `n8n/workflows/WF_OPENCLAW_SANDBOX_RUNNER.json` |
| WF_OUTCOME_ROLLUP |  | `n8n workflow: WF_OUTCOME_ROLLUP` | `n8n/workflows/WF_OUTCOME_ROLLUP.json` |
| WF_PIPELINE_EXECUTOR |  | `n8n workflow: WF_PIPELINE_EXECUTOR` | `n8n/workflows/WF_PIPELINE_EXECUTOR.json` |
| WF_PKI_CERT_ROTATION |  | `n8n workflow: WF_PKI_CERT_ROTATION` | `n8n/workflows/WF_PKI_CERT_ROTATION.json` |
| WF_PLAYWRIGHT_RUN |  | `n8n workflow: WF_PLAYWRIGHT_RUN` | `n8n/workflows/WF_PLAYWRIGHT_RUN.json` |
| WF_PROPOSAL_OUTCOME_REVIEW |  | `n8n workflow: WF_PROPOSAL_OUTCOME_REVIEW` | `n8n/workflows/WF_PROPOSAL_OUTCOME_REVIEW.json` |
| WF_PROVIDER_HEALTH_PROBE |  | `n8n workflow: WF_PROVIDER_HEALTH_PROBE` | `n8n/workflows/WF_PROVIDER_HEALTH_PROBE.json` |
| WF_PR_COMPLIANCE_GATE |  | `n8n workflow: WF_PR_COMPLIANCE_GATE` | `n8n/workflows/WF_PR_COMPLIANCE_GATE.json` |
| WF_PUBLIC_CHATBOT |  | `n8n workflow: WF_PUBLIC_CHATBOT` | `n8n/workflows/WF_PUBLIC_CHATBOT.json` |
| WF_PUSH_CAMPAIGN_CRON |  | `n8n workflow: WF_PUSH_CAMPAIGN_CRON` | `n8n/workflows/WF_PUSH_CAMPAIGN_CRON.json` |
| WF_PUSH_REMINDER_CRON |  | `n8n workflow: WF_PUSH_REMINDER_CRON` | `n8n/workflows/WF_PUSH_REMINDER_CRON.json` |
| WF_RAGNAROK_AGENT |  | `n8n workflow: WF_RAGNAROK_AGENT` | `n8n/workflows/WF_RAGNAROK_AGENT.json` |
| WF_RAG_EVAL_NIGHTLY |  | `n8n workflow: WF_RAG_EVAL_NIGHTLY` | `n8n/workflows/WF_RAG_EVAL_NIGHTLY.json` |
| WF_RETRY_FAILED_EVENTS |  | `n8n workflow: WF_RETRY_FAILED_EVENTS` | `n8n/workflows/WF_RETRY_FAILED_EVENTS.json` |
| WF_RULE_PROPAGATION |  | `n8n workflow: WF_RULE_PROPAGATION` | `n8n/workflows/WF_RULE_PROPAGATION.json` |
| WF_RUNTIME_HEALTH_PROBE |  | `n8n workflow: WF_RUNTIME_HEALTH_PROBE` | `n8n/workflows/WF_RUNTIME_HEALTH_PROBE.json` |
| WF_SELF_DEPLOY |  | `n8n workflow: WF_SELF_DEPLOY` | `n8n/workflows/WF_SELF_DEPLOY.json` |
| WF_SELF_LEARNING_LOOP |  | `n8n workflow: WF_SELF_LEARNING_LOOP` | `n8n/workflows/WF_SELF_LEARNING_LOOP.json` |
| WF_SELF_LEARNING_TRIGGER |  | `n8n workflow: WF_SELF_LEARNING_TRIGGER` | `n8n/workflows/WF_SELF_LEARNING_TRIGGER.json` |
| WF_SENTRY_MONITOR |  | `n8n workflow: WF_SENTRY_MONITOR` | `n8n/workflows/WF_SENTRY_MONITOR.json` |
| WF_SENTRY_OBSERVER |  | `n8n workflow: WF_SENTRY_OBSERVER` | `n8n/workflows/WF_SENTRY_OBSERVER.json` |
| WF_SLA_AUTO_ESCALATION |  | `n8n workflow: WF_SLA_AUTO_ESCALATION` | `n8n/workflows/WF_SLA_AUTO_ESCALATION.json` |
| WF_STATIC_DEFENSE_COMMITTER |  | `n8n workflow: WF_STATIC_DEFENSE_COMMITTER` | `n8n/workflows/WF_STATIC_DEFENSE_COMMITTER.json` |
| WF_STORY_REMINDER_CRON |  | `n8n workflow: WF_STORY_REMINDER_CRON` | `n8n/workflows/WF_STORY_REMINDER_CRON.json` |
| WF_STORY_SCAFFOLD |  | `n8n workflow: WF_STORY_SCAFFOLD` | `n8n/workflows/WF_STORY_SCAFFOLD.json` |
| WF_TRAINING_EXPORT |  | `n8n workflow: WF_TRAINING_EXPORT` | `n8n/workflows/WF_TRAINING_EXPORT.json` |
| WF_VERIFIER |  | `n8n workflow: WF_VERIFIER` | `n8n/workflows/WF_VERIFIER.json` |
| WF_VULNERABILITY_SCAN |  | `n8n workflow: WF_VULNERABILITY_SCAN` | `n8n/workflows/WF_VULNERABILITY_SCAN.json` |
| WF_WEB_ARTIFACT_INGEST |  | `n8n workflow: WF_WEB_ARTIFACT_INGEST` | `n8n/workflows/WF_WEB_ARTIFACT_INGEST.json` |

### DB katalogy a registry

Tabulky typu katalog/registry (aisha/db/sql/tables/*).

| Položka | Co to je | Jak použít | Kde |
|---|---|---|---|
| agent_catalog | katalog tabulka | `tabulka: agent_catalog` | `aisha/db/sql/tables/agent_catalog.sql` |
| agent_phase_catalog | katalog tabulka | `tabulka: agent_phase_catalog` | `aisha/db/sql/tables/agent_phase_catalog.sql` |
| ai_cost_class_catalog | katalog tabulka | `tabulka: ai_cost_class_catalog` | `aisha/db/sql/tables/ai_cost_class_catalog.sql` |
| ai_model_registry | registry tabulka | `tabulka: ai_model_registry` | `aisha/db/sql/tables/ai_model_registry.sql` |
| ai_provider_registry | registry tabulka | `tabulka: ai_provider_registry` | `aisha/db/sql/tables/ai_provider_registry.sql` |
| ai_runtime_registry | registry tabulka | `tabulka: ai_runtime_registry` | `aisha/db/sql/tables/ai_runtime_registry.sql` |
| ai_task_kind_registry | registry tabulka | `tabulka: ai_task_kind_registry` | `aisha/db/sql/tables/ai_task_kind_registry.sql` |
| aitg_test_catalog | katalog tabulka | `tabulka: aitg_test_catalog` | `aisha/db/sql/tables/aitg_test_catalog.sql` |
| auth_provider_registry | registry tabulka | `tabulka: auth_provider_registry` | `aisha/db/sql/tables/auth_provider_registry.sql` |
| custom_node_registry | registry tabulka | `tabulka: custom_node_registry` | `aisha/db/sql/tables/custom_node_registry.sql` |
| data_sensitivity_registry | registry tabulka | `tabulka: data_sensitivity_registry` | `aisha/db/sql/tables/data_sensitivity_registry.sql` |
| document_registry | registry tabulka | `tabulka: document_registry` | `aisha/db/sql/tables/document_registry.sql` |
| li_source_registry | registry tabulka | `tabulka: li_source_registry` | `aisha/db/sql/tables/li_source_registry.sql` |
| mcp_server_registry | registry tabulka | `tabulka: mcp_server_registry` | `aisha/db/sql/tables/mcp_server_registry.sql` |
| plugin_catalog | katalog tabulka | `tabulka: plugin_catalog` | `aisha/db/sql/tables/plugin_catalog.sql` |
| product_catalog | katalog tabulka | `tabulka: product_catalog` | `aisha/db/sql/tables/product_catalog.sql` |
| symptom_catalog | katalog tabulka | `tabulka: symptom_catalog` | `aisha/db/sql/tables/symptom_catalog.sql` |
| web_tracking_registry | registry tabulka | `tabulka: web_tracking_registry` | `aisha/db/sql/tables/web_tracking_registry.sql` |

### npm skript skupiny

Skupiny npm skriptů z kořenového package.json — jak věci spouštět.

| Skupina | Počet | Skripty (ukázka) |
|---|---|---|
| `ai:*` | 6 | ai:auto, ai:mode, ai:mode:cloud, ai:mode:hybrid, ai:mode:local, ai:status |
| `aisha:*` | 43 | aisha:ale:test, aisha:bridge:deploy, aisha:chat:interactive, aisha:chat:interactive:prod, aisha:chat:test, aisha:chat:test:local … |
| `appsmith:*` | 1 | appsmith:provision |
| `audit:*` | 1 | audit:repo |
| `build:*` | 2 | build:dev, build:packages |
| `check:*` | 1 | check:i18n |
| `cockpit:*` | 1 | cockpit:host |
| `cold-start:*` | 2 | cold-start:verify, cold-start:verify:json |
| `company-os:*` | 2 | company-os:agent-spec, company-os:init |
| `coolify:*` | 5 | coolify:domains:apply, coolify:domains:check, coolify:watch, coolify:watch:live, coolify:watch:wait |
| `db:*` | 29 | db:convergence:verify, db:init:generate, db:migrate, db:migrate:dry, db:migrate:local, db:migration:register … |
| `db-mgr:*` | 4 | db-mgr:access, db-mgr:flow, db-mgr:lint, db-mgr:source |
| `debug:*` | 1 | debug:verify |
| `deploy:*` | 4 | deploy:init, deploy:init:dry, deploy:wipe, deploy:wipe:dry |
| `dev:*` | 5 | dev:e2e, dev:stack, dev:stack:down, dev:stack:full, dev:stack:status |
| `dirigent:*` | 4 | dirigent:bootstrap, dirigent:bootstrap:mcp, dirigent:skill:install, dirigent:source-pack |
| `docker:*` | 5 | docker:ai:setup, docker:ai:setup:check, docker:ai:status, docker:ai:test, docker:ai:warm |
| `docs:*` | 1 | docs:build |
| `env:*` | 4 | env:doctor, env:doctor:dry, env:doctor:omni, env:doctor:report |
| `evymo:*` | 8 | evymo:db, evymo:deploy, evymo:dirigent, evymo:health, evymo:next, evymo:quality … |
| `ext:*` | 5 | ext:build, ext:build:force, ext:install, ext:install:force, ext:watch |
| `func:*` | 3 | func:list, func:list:live, func:validate |
| `gate:*` | 5 | gate:branding, gate:branding:baseline, gate:owasp, gate:workarounds, gate:workarounds:baseline |
| `gen:*` | 19 | gen:catalog, gen:catalog:check, gen:claude-app, gen:claude-app:offline, gen:company-os, gen:company-os:check … |
| `i18n:*` | 13 | i18n:bracket-check, i18n:bracket-check:strict, i18n:check, i18n:content:build, i18n:content:check, i18n:content:dump … |
| `insight:*` | 4 | insight:down, insight:logs, insight:revalidate, insight:up |
| `lint:*` | 1 | lint:console |
| `mesh:*` | 4 | mesh:discover, mesh:discover:json, mesh:sync, mesh:sync:apply |
| `mlx:*` | 8 | mlx:serve, mlx:serve:bg, mlx:setup, mlx:setup:check, mlx:setup:safe, mlx:status … |
| `models:*` | 3 | models:check, models:preset, models:wizard |
| `n8n:*` | 7 | n8n:publish, n8n:release, n8n:release:dry, n8n:release:major, n8n:release:minor, n8n:restart … |
| `ollama:*` | 7 | ollama:serve, ollama:serve:bg, ollama:setup, ollama:setup:check, ollama:status, ollama:stop … |
| `operator:*` | 4 | operator:inputs:json, operator:setup, operator:setup:check, operator:setup:verify |
| `package:*` | 2 | package:claude-app, package:claude-app:check |
| `pre-deploy:*` | 2 | pre-deploy:check, pre-deploy:full |
| `redeploy:*` | 3 | redeploy:heal, redeploy:plan, redeploy:status |
| `regen:*` | 1 | regen:check |
| `(top-level)` | 16 | allinone, build, cockpit, db-mgr, dev, gate … |
| `setup:*` | 8 | setup:backend, setup:full, setup:insight, setup:n8n, setup:reset, setup:status … |
| `smoke:*` | 4 | smoke:autopilot, smoke:insight, smoke:routing, smoke:routing:canonical |
| `sso:*` | 4 | sso:check, sso:provision, sso:provision:local, sso:provision:prod |
| `stack:*` | 6 | stack:bringup, stack:health, stack:health:json, stack:health:local, stack:health:prod, stack:health:wait |
| `story:*` | 1 | story:sync:pull |
| `surfaces:*` | 1 | surfaces:build:all |
| `test:*` | 56 | test:claude-app, test:claude-cli:local, test:cosmos, test:cosmos:init, test:coverage, test:db … |
| `typecheck:*` | 1 | typecheck:repo |
| `validate:*` | 1 | validate:static |
| `verify:*` | 5 | verify:claude-app, verify:from-zero, verify:from-zero:db, verify:redis:acl, verify:redis:acl:heal |
| `warmup:*` | 7 | warmup:all, warmup:dry, warmup:local, warmup:local:down, warmup:local:status, warmup:quick … |
| `workbench:*` | 2 | workbench:build, workbench:dev |

<!-- aisha:user-section:start -->

## Poznámky (ručně, přežijí regeneraci)

_Sem patří kontext, který nelze odvodit z gitu — priority, deprecace, odkazy na ADR apod._

<!-- aisha:user-section:end -->
