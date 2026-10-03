# IDE-axis → aisha.guru backend: napojení & mezery (assessment 2026-07-07)

> Vyhodnocení: náš Claude-Code-VSCode-like editor + varianty pro řízení vývoje, jejich napojení na
> aisha.guru backend (AISHA-jako-model), co je hotové, kde jsou mezery, co dodělat.
> Ověřeno přímou inspekcí `main` (a90b0866) — NE z paměti ani z jednoho průzkumu (agent-2 se v build-stavu sekl).

## TL;DR

- **Backend (AISHA-jako-model) JE postavený a nasazený** přes #614 (bfd67b65) — `svc-ai-chat/src/routes/v1-chat.ts`
  (533 ř., governed pipeline: `authenticateOmni → story-bind → fn_admit_clow 402/202 → 403 no-onprem →
  resolveAvailableModel`), veřejná tvář `ask.aisha.guru/v1` přes `services/gateway/src/routes/v1.ts` (streaming proxy).
  PAT auth kompletní: `create_mcp_token`/`validate_mcp_token` + `mcp_auth_tokens(user_id, scoped_to_story_id, story_id, token_hash, scope)`.
- **`ask.aisha.guru/v1` JE LIVE** — `POST /v1/messages` → **401** `{"error":"Unauthorized"}` (Omni authenticateOmni), invalid PAT → 401 (validate_mcp_token). Coolify: `aisha-ai-chat`/`aisha-core`/`aisha-edge`/`aisha-llm-gateway` všechny `running:healthy`. (Dřívější „timeout" byl artefakt GET-probu na POST-only route — NE nezdravý backend. Blocker #1 NEEXISTUJE.)
- **4 editory postavené+nainstalované**: AISHA Workbench (VSCodium fork), VS Code ext `aisha-dirigent` (0.7.0),
  Claude App `.mcpb` (26 tools), Zed ext. + Steerty overlay (`.claude/`) + 12 gen:ide adapterů.
- **ALE žádný editor neroutuje své LLM volání přes Omni /v1** — jedou na Copilot / Claude-direct. To je jádro „napoj".

## Co je HOTOVÉ ✅

| Vrstva | Stav | Důkaz |
|---|---|---|
| Omni /v1 facade (governed) | ✅ built, merged #614 | `services/svc-ai-chat/src/routes/v1-chat.ts` (533 ř.); `config/services.json` ai-chat `_comment` |
| Veřejná model-tvář `ask.<tld>/v1` | ✅ built | `services/gateway/src/routes/v1.ts`; `derive-domains.mjs` `GATEWAY_DOMAIN_PUBLIC=ask.<tld>` |
| PAT auth + story scope | ✅ schema kompletní | `create_mcp_token`(8)/`validate_mcp_token`(4); `mcp_auth_tokens` má user_id/scoped_to_story_id/story_id/token_hash/scope |
| Editory (4) | ✅ built+installed | Workbench `workbench/vscodium/…AISHA Workbench.app`; `extensions/aisha-dirigent` (.vsix 0.7.0); `extensions/aisha-dirigent-claude` (.mcpb, 26 tools); `extensions/aisha-dirigent-zed` (Rust/WASM) |
| Steerty overlay (dev-steering L1) | ✅ live | `.claude/hooks/aisha-advise-*.sh` (8 hooks), `aisha-advisor.md`, gen:ide claude-overlay |
| gen:ide pipeline (11 adapterů) | ✅ full, drift-gated | `scripts/ide-adapters/registry.mjs` + `__tests__` |
| Dirigent MCP server | ✅ 26 tools | `extensions/aisha-dirigent-claude/server/tools.mjs` |

## MEZERY / co dodělat ⚠️ (prioritizované)

### ✅ 1. Backend health — VYŘEŠENO (nebyl blocker)
Diagnóza (2026-07-07): `POST ask.aisha.guru/v1/messages` → **401** (rychle, Omni authenticateOmni). Coolify AISHA
tenant `running:healthy`. Backend je LIVE — žádný prod fix netřeba. (Nezdravé jsou jen `tenant-*`/`example-*` = jiní tenanti.)

### 🔴 2. Editor → Omni /v1 wiring (jádro „napoj")
Žádný editor neroutuje LLM přes AISHU. Potřebuje: `ANTHROPIC_BASE_URL=https://ask.aisha.guru` +
`ANTHROPIC_API_KEY=mcp_<PAT>` (Anthropic proto `POST /v1/messages`) NEBO `OPENAI_BASE_URL=https://ask.aisha.guru/v1`
+ `OPENAI_API_KEY=mcp_<PAT>`. Per editor:
- **Claude Code** (CLI/ext): env `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`.
- **AISHA Workbench** (VSCodium): `defaultChatAgent` je dnes Copilot → přidat AISHA jako model-providera (nebo bake ANTHROPIC_BASE_URL do product.json/settings).
- **VS Code ext `aisha-dirigent`**: neregistruje `languageModelChat` providera → buď registrovat AISHA providera na ask.aisha.guru/v1, nebo dokumentovat env.
- **Zed**: `.zed/settings.json` anthropic `api_url` → ask.aisha.guru.
**Config SoT:** přidat do `.aisha/dirigent.template.json` profilu `aisha` pole `modelEndpoint: https://ask.aisha.guru` (dnes je tam jen `aishaUrl=api.aisha.guru` = data/MCP plane).

### 🔴 3. PAT minting (KLÍČOVÝ ENABLER — teď hlavní blocker napoj)
`create_mcp_token` je **admin/staff-gated DB RPC** (`IF NOT is_admin_or_staff() THEN RAISE 42501`) + **žádný user-facing
surface** (endpoint/CLI/MCP tool). Regular dev si `mcp_` klíč nevyrobí. Bez PAT se editor nenapojí.
**Akce (PR):** (a) CLI `npm run aisha:mint-pat` (admin JWT → PostgREST rpc create_mcp_token) pro rychlý start;
(b) edge route `POST /auth/v1/pats` (KC-JWT → create_mcp_token) pro self-service; zvážit relaxaci admin-gate na
„authenticated může mintit vlastní story-scoped token" (dnes admin-only). Bez tohoto je napoj jen pro adminy.

### ✅ 4. Stale config/docs (gateway.aisha.guru → ask.aisha.guru) — VYŘEŠENO
`.claude/skills/aisha-router-tuning/SKILL.md` měl model-napoj na `gateway.<tld>/v1` — model-tvář se
přesunula na `ask.aisha.guru` (#614; „stop calling everything gateway"). **Vyřešeno** (fix/destale-gateway-to-ask):
model-axis `ANTHROPIC/OPENAI_BASE_URL` → `ask.aisha.guru/v1` + PAT; driver-axis (`LLM_GATEWAY_URL`, dispatch table)
→ interní `http://llm-gateway:4000` (kontejner je `public:false`); zamčeno gatem `model-face-naming`.

### 🟡 5. Dirigent supervision L2 nenasazená
HTTP relay → `services/svc-ai-chat/src/routes/dirigent-supervisor.ts` → n8n `WF_DIRIGENT_*` playbooky
(goal_evaluator/compliance) je code-ready, ale n8n WFs nenasazené → runtime steering (nudges, goal-eval) nefiří.
**Akce:** deploy n8n WF_DIRIGENT_* + zapnout relay hooky v `.claude/settings.json` přes gen:ide.

### 🟢 6. Editor polish (nižší priorita, z 07-02 auditu — ověřit aktuálnost)
Workbench `defaultChatAgent=Copilot`; Zed ext orphaned z CI/release (Apache-2.0 vs ELv2, Cargo.lock gitignored);
stale generated `CLAUDE.md/.cursorrules/.windsurfrules` (thin) vs `.rules` (rich); `dirigent-core/workbench-core/ide-bridge`
built-but-unconsumed (VS Code ext vendoruje duplikáty).

## Doporučené pořadí

1. **(user authz)** Ověřit + zdravě nasadit Omni backend → `ask.aisha.guru/v1` vrací 401 (ne timeout).
2. **(PR, bezpečné)** PAT mint surface (#3) — bez něj se nedá vyrobit klíč pro editor.
3. **(local + PR)** Editor→/v1 wiring (#2): dirigent config `modelEndpoint`, per-editor recept, stale-doc fix (#4).
4. **(PR)** Deploy L2 supervision (#5).
5. **(PR, průběžně)** Editor polish (#6).

**Verify (až backend zdravý):** vyrobit PAT → `ANTHROPIC_BASE_URL=https://ask.aisha.guru ANTHROPIC_API_KEY=mcp_… claude`
→ prompt → odpověď proteče přes AISHA (Langfuse trace, `ai_trace_events`, dynamický model-select per-task).
