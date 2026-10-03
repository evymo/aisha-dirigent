# Finální implementační plán — AISHA AI Orchestrator

> **Verze:** 1.0 | **Datum:** 2025-02  
> **Zdroj:** `idea-full-implmentation-orchestrator.md` (992 řádků)  
> **Baseline:** Aktuální stav DB (160+ tabulek, 40 enumů)

---

## Obsah

1. [Gap analýza: Blueprint vs Existující stav](#1-gap-analýza)
2. [Klíčový insight: Projekt = Story](#2-klíčový-insight)
3. [Architektonická rozhodnutí](#3-architektonická-rozhodnutí)
4. [Fáze implementace](#4-fáze-implementace)
5. [Migrace a datový tok](#5-migrace-a-datový-tok)
6. [Rizika a mitigace](#6-rizika-a-mitigace)

---

## 1. Gap analýza

### 1.1 Co EXISTUJE a lze využít (reuse / extend)

| Blueprint entita | Existující tabulka | Stav | Akce |
|--|--|--|--|
| `accounts` | `partner_profiles` | Částečný overlap — má `guild_tier`, `guild_bio`, `expertise_summary`, ale nemá `type`, `slug`, multi-account model | **Extend** — přidat `account_type`, nebo vytvořit novou + VIEW |
| `member_status` | `memberships` | Existuje s `tier`, `status`, `payment_type`, tokeny | **Extend** — přidat `level` (membership_level) |
| `catalog_products` | `products` | Existuje (47 sloupců!) — má `stripe_product_id`, `sku`, `price`, `token_price` | **Reuse** — přidat `type` (product_type) pokud chybí |
| `billing_subscriptions` | `member_subscriptions` | Existuje s `stripe_subscription_id`, `period_start/end`, `amount_paid` | **Reuse** — rozšířit o `account_id` referenci |
| `billing_purchases` | `orders` | Existuje s `stripe_payment_intent_id`, `status`, `total` | **Reuse** — přidat `provider` kolumnu |
| `onboarding_questionnaires` | `questionnaires` | Existuje s `questions` (jsonb), `questionnaire_type`, `is_active` | **Reuse** — filtrovat přes `questionnaire_type = 'onboarding'` |
| `onboarding_responses` | `questionnaire_responses` | Existuje s `responses` (jsonb), `score`, `completed_at` | **Reuse** — přidat `status` (qualification_status) |
| `qualification_attempts` | `qualification_results` | Existuje s `score`, `passed`, `answers` | **Extend** — přidat `kind`, `status`, `notes` |
| `expertise_areas` | `guild_expertise_areas` | Existuje (10 sloupců: `slug`, `name_key`, `icon`, `parent_id`) | **Reuse** přímo — alias nebo VIEW |
| `guild_expertise` | `guild_member_expertise` | Existuje | **Check schema** + případně rozšířit |
| `expert_rules` | `expert_rules` | ✅ Existuje (24 sloupců včetně `content_embedding` vector) | **Extend** — přidat `severity`, `author_membership_id` |
| `expert_rule_versions` | `expert_rule_versions` | ✅ Existuje (rule_id, version_no, body_markdown, ai_instructions) | **Reuse** — přidat `ai_context_tags` |
| `rule_bindings` (universal) | `expert_rule_agent_bindings` | Existuje ale jen pro `agent_configuration_id` | **Migrate** → rozšířit na universal + VIEW |
| `knowledge_items` | `knowledge_posts` + `knowledge_topics` | Částečný overlap — `knowledge_topics` má `expert_rule_id` referenci | **Nová tabulka** — unifikovaný model |
| `ai_runs` / `ai_trace_events` | `audit_journal` | Audit journal existuje, ale nemá strukturu pro AI pipeline | **Nová tabulka** — separate AI observability |
| `storyloops` | `story_entries` | Story entries existují ale jako flat entries bez orchestrace | **Extend** — storyloop = mechanismus vzniku dalších stories |

### 1.2 Co NEEXISTUJE (kompletně nové)

| Blueprint entita | Popis | Priorita |
|--|--|--|
| `accounts` + `account_members` | Multi-account (individual/company) model | P2 |
| `account_entitlements` | Feature flags + limity per account | P2 |
| `catalog_plans` | Plány (Starter/Professional/Enterprise) | P2 |
| `knowledge_items` | Unifikovaný knowledge typ (rule + doc + playbook) | **P1** |
| `knowledge_chunks` | Chunked content pro embedding | **P1** |
| `knowledge_embeddings` | Separátní embedding storage | **P1** |
| `guild_memberships` | Formalizované guild členství | P3 |
| `rule_bindings` (universal) | Nahrazuje agent_bindings + project + plan bindings | **P1** |
| `story_rulesets` | Snapshot pravidel pro story/projekt (fingerprint) | **P1** |
| `story_contexts` | MCP kontext per story | **P1** |
| `story_participants` | Kdo spolupracuje na story (member, expert, aisha) | P2 |
| `story_environments` | Coolify deploymenty per story | P3 |
| `consultations` | Plánované konzultace v kontextu story | P4 |
| `ai_runs` | AI pipeline tracking | P2 |
| `ai_trace_events` | Detailní audit AI operací | P2 |
| `qualification_attempts` | Kvalifikační pokusy (rozšíření qualification_results) | P2 |
| `member_status` | Lightweight membership level tracking | P2 |

> **Poznámka:** Blueprint's `projects`, `project_checkouts`, `storyloops`, `storyloop_participants`,
> `storyloop_stories` se NEVYTVÁŘÍ — nahrazuje je rozšíření `partner_stories` + child tabulky.
> Viz sekce 2 „Klíčový insight: Projekt = Story".

### 1.3 ENUM status

| Blueprint enum | Existuje? | Akce |
|--|--|--|
| `guild_tier` | ✅ Existuje (apprentice, journeyman, master, grandmaster) | Reuse |
| `rule_category` | ✅ `expert_rule_category` existuje (15 hodnot, matching) | Reuse (alias) |
| `rule_status` | ✅ `expert_rule_status` existuje | Reuse |
| `account_type` | ❌ | Vytvořit |
| `membership_level` | ❌ | Vytvořit |
| `product_type` | ❌ | Vytvořit |
| `entitlement_key` | ❌ | Vytvořit |
| `qualification_status` | ❌ | Vytvořit |
| `rule_binding_type` | ❌ | Vytvořit |
| `environment_kind` | ❌ | Vytvořit |
| `ai_event_type` | ❌ | Vytvořit |
| `knowledge_item_type` | ❌ | Vytvořit |
| `project_status` | ❌ → zbytečný | Realizováno jako `partner_stories.delivery_status` (text check) |
| `storyloop_status` | ❌ → zbytečný | Storyloop není entita, je to `partner_stories.origin` |

### 1.4 MCP funkce v DB

Existující RPC funkce (z předchozí migrace, aplikovány na DB):
- `mcp_search_knowledge` — vektorové vyhledávání v `expert_rules.content_embedding`
- `mcp_get_rule_detail` — detail pravidla
- `mcp_get_expertise_areas` — seznam oblastí
- `mcp_match_experts` — matching expertů
- `mcp_get_agent_knowledge` — knowledge pro agenta

**Stav:** Funkce běží v DB, ale migrační soubor je prázdný (user undo). Potřeba:
1. Obnovit obsah migračního souboru (aby odpovídal DB stavu)
2. Rozšířit funkce pro Knowledge Graph model (knowledge_items, chunks, embeddings)

### 1.5 Edge Functions stav

| Funkce | Stav | Problém |
|--|--|--|
| `mcp-knowledge-server/index.ts` | ✅ Existuje (6 tools) | Importuje z `_shared/mcp-protocol.ts` který je PRÁZDNÝ |
| `generate-embeddings/index.ts` | ✅ Nově vytvořen | Netestováno, zapisuje do `expert_rules.content_embedding` |
| `_shared/mcp-protocol.ts` | ⚠️ PRÁZDNÝ (undo) | Nutno obnovit — blokuje MCP server |

---

## 2. Klíčový insight: Projekt = Story

### 2.1 Existující Story model (to co máme)

Platforma již má bohatý story ekosystém:

```
partner_stories          — Hlavní entita: story = případ člena
├── story_entries        — Timeline záznamy (journal, notes, docs)
├── story_ai_sessions    — AI konzultace v kontextu story
├── story_labels         — Štítky pro organizaci
└── story_reminders      — Upomínky
```

**Kdo co dělá:**
- **Člen** dostane **první story automaticky** (`ensure_member_story_exists` RPC, idempotent)
- **Partner** vytváří další stories přes `NewStoryDialog` → `create_story_audited`
- **Aisha** konzultuje v kontextu story (`AishaConsultPanel`)

### 2.2 Mapování blueprint → rozšíření story

Blueprint navrhoval `projects`, `project_checkouts`, `storyloops` jako nové tabulky.
Ve skutečnosti:

| Blueprint koncept | Realizace | Jak |
|---|---|---|
| `project` | = `partner_stories` | Story JE projekt člena. Rozšířit o `repo_url`, `ruleset_id`, `mcp_endpoint`. |
| `project_checkout` | = Vytvoření nové story | Partner vybere program + answers → vznikne story. Přidat `checkout_metadata` jsonb. |
| `project_status` (state machine) | = Rozšíření `partner_stories.status` | Přidat nové statusy do existujícího enum/check. |
| `storyloop` (mechanismus) | = Způsob jak vzniká 2.+ story | Není separátní entita. Story označená `origin = 'storyloop'` + `storyloop_request_id`. |
| `storyloop_participants` | = Rozšíření story modelu | Přidat `story_participants` tabulku (kdo spolupracuje na story). |
| `storyloop_stories` (sub-tasks) | = `story_entries` s `entry_type = 'task'` | Již existuje: `story_entries` má `entry_type`, `content`, `metadata`, `is_internal`. |
| `project_environments` | Nová child tabulka k story | `story_environments` (preview, staging, production URL). |
| `project_rulesets` | Nová child tabulka k story | `story_rulesets` — fingerprint pravidel pro story. |
| `project_contexts` | Rozšíření story | MCP kontext, build config — do `story_contexts` nebo jsonb. |

### 2.3 Vizualizace: Story lifecycle (rozšířený)

```
Člen se registruje
    │
    ▼
ensure_member_story_exists()     ← 1. story automaticky
    │
    ▼
Partner přidává entries          ← journal, dokumenty, poznámky
    │
    ▼
Partner/Člen requestne storyloop ← potřeba expertise/spolupráce
    │
    ▼
Aisha matchne guild experty      ← search_knowledge, match_experts
    │
    ▼
Vzniká 2. story (storyloop)     ← partner creates via dialog/API
    │ └── story_participants (člen + expert + aisha)
    │ └── story_rulesets (fingerprint pravidel)
    │ └── story_contexts (MCP endpoint, build config)
    │ └── story_environments (preview URL)
    │
    ▼
Delivery loop                    ← analyze → scaffold → develop → QA → deliver
    │ └── story_entries(entry_type='task') = acceptance criteria
    │ └── story_entries(entry_type='ai_note') = Aisha trace
    │ └── story_entries(entry_type='compliance') = gate results
    │
    ▼
Story delivered/archived
```

### 2.4 Co to zjednodušuje

1. **Odpadají 3 nové tabulky** (`projects`, `project_checkouts`, `storyloops`)
2. **Story zůstává single source of truth** pro případ člena
3. **Existující UI funguje** — StoryLoop page, entries, labels, AI sessions
4. **Přidáváme jen child tabulky** — rulesets, contexts, environments, participants
5. **Existující hooky** (`useStoryLoop`, `useCreateStory`, `useEnsureMemberStory`) se pouze rozšíří

---

## 3. Architektonická rozhodnutí

### 3.1 Přístup: Evoluce, ne revoluce

Blueprint navrhuje ~30 nových tabulek. S 160+ existujícími tabulkami v produkci je **plná implementace najednou nereálná a riskantní**.

**Strategie:** Inkrementální evoluce ve 6 fázích, kde každá fáze přináší měřitelnou hodnotu.

### 3.2 Klíčová rozhodnutí

| Rozhodnutí | Volba | Důvod |
|--|--|--|
| `projects` vs `partner_stories` | **Rozšířit** `partner_stories` | Projekt = story člena. Přidat sloupce pro repo, ruleset, delivery status. Story je single source of truth. |
| `accounts` vs `partner_profiles` | **Nový** `accounts` + VIEW pro zpětnou kompatibilitu | Partner_profiles je příliš specifická (healthcare, certifikace). Accounts je čistý business model. |
| Knowledge model | **Nový** `knowledge_items` + `chunks` + `embeddings` | `expert_rules.content_embedding` funguje pro pravidla, ale unifikovaný model pojme i docs, playbooks, case studies. Expert rules zůstanou jako zvláštní typ s vlastní tabulkou. |
| Rule bindings | **Rozšířit** `expert_rule_agent_bindings` → `rule_bindings` | Přidat `target_type` + `target_id` místo `agent_configuration_id`. Zachovat VIEW pro zpětnou kompatibilitu. |
| Billing | **Reuse** existující `products` + `orders` + `member_subscriptions` | Fungující Stripe integrace se nemění. Přidat `catalog_plans` jako novou vrstvu nad products. |
| Questionnaires | **Reuse** existující `questionnaires` + `questionnaire_responses` | Přidat `questionnaire_type = 'onboarding'` filtr. Netvořit duplicitní tabulky. |
| AI observability | **Nové** `ai_runs` + `ai_trace_events` | `audit_journal` je pro security audit. AI pipeline potřebuje vlastní structured tracing. |
| Storyloops | **Mechanismus, ne tabulka** | Storyloop = způsob jak vzniká 2.+ story. Přidat `story_participants` + `origin` sloupec na story. |

### 3.3 Dependency graf

```
Fáze 1: Knowledge Graph Foundation
  └── knowledge_items, knowledge_chunks, knowledge_embeddings
  └── Obnovení MCP protocol + migration souboru
  └── WF_RULE_PUBLISH_AND_INDEX logika

Fáze 2: Story Delivery Context (Ruleset + Fingerprint)
  └── story_rulesets, story_contexts, story_participants
  └── Rozšíření partner_stories (repo_url, delivery_status, origin)
  └── MCP get_story_context tool
  └── Závisí na: Fáze 1 (knowledge indexed)

Fáze 3: PR Compliance Gate
  └── MCP validate_compliance tool
  └── WF_PR_COMPLIANCE_GATE (n8n nebo edge function)
  └── Závisí na: Fáze 2 (ruleset fingerprint)

Fáze 4: Accounts + Entitlements + Billing
  └── accounts, account_members, account_entitlements
  └── catalog_plans, rozšíření member_subscriptions
  └── WF_BILLING_ENTITLEMENTS_UPSERT
  └── Závisí na: Nezávislé (ale potřebné pro Fázi 5)

Fáze 5: Story Delivery Engine (Aisha orchestrace)
  └── story_environments, Aisha state machine
  └── WF_STORY_SCAFFOLD (repo + Coolify + MCP token)
  └── Storyloop mechanismus (2.+ story via guild expert matching)
  └── Závisí na: Fáze 1+2+3+4

Fáze 6: Guild Formalizace + Full Autonomy
  └── guild_memberships (formalizace z partner_profiles)
  └── WF_GUILD_APPLICATION_EVALUATE
  └── WF_NIGHTLY_STORY_AUDIT
  └── Závisí na: Fáze 4+5
```

---

## 4. Fáze implementace

### Fáze 0: Oprava revertnutých souborů (Blokující)

**Cíl:** Obnovit funkčnost MCP serveru a migrace.

| # | Úkol | Deliverable |
|---|------|-------------|
| 0.1 | Obnovit `mcp-protocol.ts` | McpServer class, JSON-RPC dispatcher, content helpers |
| 0.2 | Obnovit migrační soubor | `20260228000000_mcp_knowledge_vector_search.sql` — pgvector, content_embedding, 5 MCP RPC funkcí |
| 0.3 | Ověřit MCP server | `mcp-knowledge-server` funkční s obnoveným protokolem |

**Odhad:** 1 session

---

### Fáze 1: Knowledge Graph Foundation (P1)

**Cíl:** Unifikovaný knowledge model, embedding pipeline, vylepšený MCP search.

**Blueprint sekce:** 2.6 Knowledge Graph, 7.4 WF_RULE_PUBLISH_AND_INDEX, 4.1 search_knowledge

#### Migrace 1A: Knowledge Graph tabulky + enumy

```sql
-- Nové enumy
CREATE TYPE knowledge_item_type AS ENUM ('expert_rule','engineering_doc','domain_doc','playbook','case_study');
CREATE TYPE rule_binding_type AS ENUM ('instructions','knowledge_source','guardrail','reference');

-- Nové tabulky
CREATE TABLE knowledge_items (...);       -- Unifikovaný knowledge typ
CREATE TABLE knowledge_chunks (...);      -- Chunked content
CREATE TABLE knowledge_embeddings (...);  -- pgvector embeddings

-- Rozšíření rule_bindings (univerzální)
CREATE TABLE rule_bindings (...);         -- target_type + target_id
CREATE VIEW expert_rule_agent_bindings_v AS ...;  -- Zpětná kompatabilita
```

#### Migrace 1B: Sync expert_rules → knowledge_items

```sql
-- Trigger: při INSERT/UPDATE na expert_rules → mirror do knowledge_items
CREATE FUNCTION sync_rule_to_knowledge_item() ...;
CREATE TRIGGER trg_sync_rule_knowledge AFTER INSERT OR UPDATE ON expert_rules ...;

-- Backfill existujících 10 pravidel
INSERT INTO knowledge_items (type, source, title, body_markdown, tags, ...)
SELECT 'expert_rule', 'guild_db', title, body_markdown, ai_context_tags, ...
FROM expert_rules;
```

#### Edge Function: Generate Embeddings v2

- Rozšířit `generate-embeddings/index.ts` pro `knowledge_chunks` model
- Chunking strategie: ~500 tokenů per chunk, s overlapem 50 tokenů
- Batch processing: zpracovat všechny items bez embeddings

#### MCP rozšíření

- `search_knowledge` → vyhledávat v `knowledge_embeddings` (ne jen expert_rules)
- Přidat `types` filtr (expert_rule, engineering_doc, ...)
- Přidat `visibility` filtr

#### Deliverables

| # | Deliverable | Test |
|---|------------|------|
| 1.1 | Migrační soubor s knowledge_items + chunks + embeddings | `npm run db:migrate:local` + types gen |
| 1.2 | Sync trigger expert_rules → knowledge_items | INSERT expert_rule → verify knowledge_item exists |
| 1.3 | Chunking + embedding pipeline | Edge function generuje embeddings do knowledge_embeddings |
| 1.4 | MCP search_knowledge v2 | Vektorové hledání přes knowledge_embeddings |
| 1.5 | Backfill 10 existujících pravidel | Všech 10 v knowledge_items s embeddings |
| 1.6 | Import knowledge-extraction/ docs | Docs jako knowledge_items(type=engineering_doc) |

**Odhad:** 2-3 sessions

---

### Fáze 2: Story Delivery Context + Ruleset Fingerprint (P1)

**Cíl:** Story (= projekt) má reprodukovatelný snapshot pravidel a delivery kontext.

**Blueprint sekce:** 2.7 Projects, 4.4 get_project_context, 3.3 Expert rule lifecycle

#### Migrace 2A: Rozšíření partner_stories + child tabulky

```sql
-- Rozšíření partner_stories
ALTER TABLE partner_stories 
  ADD COLUMN IF NOT EXISTS repo_url text,
  ADD COLUMN IF NOT EXISTS repo_provider text DEFAULT 'github',
  ADD COLUMN IF NOT EXISTS default_branch text DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS delivery_status text,  -- analyzing, matched, scaffolding, ready, in_progress, qa, delivering, delivered
  ADD COLUMN IF NOT EXISTS origin text DEFAULT 'manual',  -- 'auto' (first), 'manual' (partner), 'storyloop' (guild collab)
  ADD COLUMN IF NOT EXISTS checkout_metadata jsonb DEFAULT '{}'::jsonb;  -- answers, program, tech_stack

-- Ruleset per story
CREATE TABLE story_rulesets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES partner_stories(id) ON DELETE CASCADE,
  ruleset_fingerprint text NOT NULL,  -- sha256(rule_id:version sorted)
  rule_ids uuid[] NOT NULL,
  rule_versions jsonb NOT NULL,       -- { rule_id: version }
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'aisha'
);

-- MCP/delivery kontext per story
CREATE TABLE story_contexts (
  story_id uuid PRIMARY KEY REFERENCES partner_stories(id) ON DELETE CASCADE,
  ruleset_id uuid NOT NULL REFERENCES story_rulesets(id),
  mcp_endpoint text,
  mcp_token_id uuid,
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,  -- build cmd, test cmd, env hints
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Participants (pro storyloop kolaboraci)
CREATE TABLE story_participants (
  story_id uuid NOT NULL REFERENCES partner_stories(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('member','partner','guild_expert','aisha')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id, role)
);
```

#### MCP tool: get_story_context

```typescript
// Input:  { story_id: uuid }
// Output: { story, ruleset, build_config, mcp_endpoint, participants }
```

#### Fingerprint algoritmus

```
fingerprint = sha256(
  sorted(rule_ids).map(id => `${id}:${version}`).join('|')
)
```

#### Deliverables

| # | Deliverable | Test |
|---|------------|------|
| 2.1 | Migrace: rozšíření partner_stories + story_rulesets + story_contexts + story_participants | DB migrate |
| 2.2 | RPC: `create_story_ruleset(story_id, rule_ids[])` | Vrátí fingerprint |
| 2.3 | MCP tool: `get_story_context` | Vrátí kontext + ruleset |
| 2.4 | Hook: `useStoryRuleset` | React hook pro UI |
| 2.5 | Rozšíření `useCreateStory` o delivery metadata | Origin, checkout_metadata |

**Odhad:** 1-2 sessions

---

### Fáze 3: PR Compliance Gate (P1)

**Cíl:** Automatická validace PR diffu proti rulesetu projektu.

**Blueprint sekce:** 4.5 validate_compliance, 7.6 WF_PR_COMPLIANCE_GATE

#### MCP tool: validate_compliance

```typescript
// Input:  { project_id, code_diff, severity_threshold }
// Output: { passed, violations[], score }
```

Implementace:
1. Načte ruleset pro projekt (get_project_context)
2. Pro každé pravidlo se severity >= threshold:
   - Vygeneruje prompt: "Zkontroluj tento diff proti pravidlu X"
   - LLM evaluace (OpenAI) → violations
3. Agreguje výsledky

#### Workflow: WF_PR_COMPLIANCE_GATE

**Dvě varianty realizace:**

A) **Edge Function** (jednodušší, pro začátek):
   - GitHub webhook → Edge Function → MCP validate_compliance → GitHub status check

B) **n8n workflow** (pro produkci):
   - GitHub webhook → n8n → MCP client → report do PR

#### Deliverables

| # | Deliverable | Test |
|---|------------|------|
| 3.1 | MCP tool `validate_compliance` | Diff + ruleset → violations[] |
| 3.2 | Edge Function / n8n webhook handler | GitHub PR event → compliance check |
| 3.3 | GitHub status check reporter | Výsledek jako GitHub check run |

**Odhad:** 2-3 sessions

---

### Fáze 4: Accounts + Entitlements + Onboarding (P2)

**Cíl:** Multi-account model, entitlementy, kvalifikace členů.

**Blueprint sekce:** 2.2 Identity, 2.3 Billing, 2.4 Onboarding, 3.1 Qualified member

#### Migrace 4A: Accounts a Entitlements

```sql
CREATE TYPE account_type AS ENUM ('individual','company');
CREATE TYPE membership_level AS ENUM ('registered','subscriber','qualified_member','guild_candidate','guild_member','staff','admin');
CREATE TYPE entitlement_key AS ENUM (...);
CREATE TYPE qualification_status AS ENUM (...);

CREATE TABLE accounts (...);
CREATE TABLE account_members (...);
CREATE TABLE member_status (...);
CREATE TABLE catalog_plans (...);
CREATE TABLE account_entitlements (...);
CREATE TABLE qualification_attempts (...);
```

#### Kompatibilita s existujícími tabulkami

- `partner_profiles` zůstane → VIEW `v_accounts` spojí obě
- `memberships` zůstane → `member_status` je nová lightweight verze
- `products` zůstane → `catalog_plans` je nadstavba
- `orders` + `member_subscriptions` zůstanou → přidají se FK na `accounts`
- `questionnaires` rozšířit o `questionnaire_type = 'onboarding'`
- `qualification_results` → migrovat data do `qualification_attempts`

#### Workflow: WF_BILLING_ENTITLEMENTS_UPSERT

- Stripe webhook → upsert billing → recompute entitlements → update member_status

#### Deliverables

| # | Deliverable |
|---|------------|
| 4.1 | Migrace: accounts + entitlements + member_status |
| 4.2 | RPC: `get_account_entitlements(account_id)` |
| 4.3 | RPC: `check_entitlement(account_id, key)` |
| 4.4 | Kvalifikační flow (onboarding → qualification) |
| 4.5 | Stripe webhook handler pro entitlementy |
| 4.6 | Hooks: `useAccount`, `useEntitlements`, `useMemberStatus` |

**Odhad:** 3-4 sessions

---

### Fáze 5: Story Delivery Engine + Storyloop mechanismus (P2)

**Cíl:** Aisha jako Dirigent — story checkout → analyze → scaffold → deliver. Storyloop jako způsob vzniku 2.+ story.

**Blueprint sekce:** 2.7 Projects, 2.8 Storyloops, 3.4 Project delivery, 5.1 Aisha runtime

#### Migrace 5A: Story Environments

```sql
CREATE TYPE environment_kind AS ENUM ('preview','staging','production');

CREATE TABLE story_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES partner_stories(id) ON DELETE CASCADE,
  kind environment_kind NOT NULL,
  coolify_resource_uuid text,
  url text,
  status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(story_id, kind)
);
```

#### Migrace 5B: AI Observability

```sql
CREATE TYPE ai_event_type AS ENUM (...);

CREATE TABLE ai_runs (...);
CREATE TABLE ai_trace_events (...);
```

#### Aisha orchestrace (delivery state machine na story)

`partner_stories.delivery_status` state machine:
1. `analyzing` → Aisha: z `checkout_metadata` extrahuje doménu, tech stack, rizika
2. `matched` → MCP: vybere rules + verze, vytvoří `story_rulesets`
3. `scaffolding` → n8n: repo + Coolify + MCP token
4. `ready` → Notification klientovi
5. `in_progress` → Monitor PRs + CI, story_entries jako log
6. `qa` → Compliance gate (validate_compliance)
7. `delivering` → Deploy přes Coolify
8. `delivered` → Report, archivace

#### Storyloop mechanismus (2.+ story)

Storyloop NENÍ separátní entita — je to flow:
1. Člen/partner requestne spolupráci → `story_entries(entry_type='storyloop_request')`
2. Aisha matchne guild experty → `mcp_match_experts`
3. Partner vytvoří nový story → `create_story_audited(origin='storyloop', ...)`
4. Přidají se participants → `story_participants(role='guild_expert')`
5. Expert pracuje na story → entries, tasks, AI sessions
6. Hotovo → story delivered

#### n8n: WF_STORY_SCAFFOLD

- Vytvořit GitHub repo z template
- Commit `.github/copilot-instructions.md` z pravidel (story_rulesets)
- Coolify: create app + env vars + deploy → `story_environments`
- Callback na Aishu

#### Deliverables

| # | Deliverable |
|---|------------|
| 5.1 | Migrace: story_environments |
| 5.2 | Migrace: ai_runs + ai_trace_events |
| 5.3 | Rozšíření `create_story_audited` → delivery_status + checkout_metadata |
| 5.4 | Aisha orchestration loop (story delivery state machine) |
| 5.5 | Storyloop flow: request → match → create story → assign participants |
| 5.6 | n8n WF_STORY_SCAFFOLD workflow |
| 5.7 | Hooks: `useStoryDelivery`, `useStoryEnvironments`, `useAiRun` |
| 5.8 | UI: Story delivery dashboard + status tracker (rozšíření StoryDetail) |

**Odhad:** 4-6 sessions

---

### Fáze 6: Guild Formalizace + Full Autonomy (P3)

**Cíl:** Formalizovaný guild model, nightly audit, plná autonomie.

**Blueprint sekce:** 2.5 Guild, 7.3/7.7/7.8 Workflows

#### Migrace 6A: Guild Memberships

```sql
CREATE TABLE guild_memberships (...);
-- Migrate data z partner_profiles.guild_tier/guild_bio

CREATE TABLE guild_expertise (...);
-- Migrate data z guild_member_expertise
```

#### Migrace 6B: Consultations

```sql
CREATE TABLE consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid REFERENCES partner_stories(id),  -- v kontextu story, ne storyloop
  scheduled_at timestamptz,
  duration_minutes int,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

#### Workflows

- WF_GUILD_APPLICATION_EVALUATE (guild kandidát → evaluace → membership)
- WF_GUILD_STORYLOOP_MATCH_AND_ASSIGN (request → match expert → create story via storyloop)
- WF_NIGHTLY_STORY_AUDIT (automatický compliance check aktivních stories)

#### Deliverables

| # | Deliverable |
|---|------------|
| 6.1 | Migrace: guild_memberships (s migrací dat z partner_profiles) |
| 6.2 | Migrace: consultations |
| 6.3 | n8n: WF_GUILD_APPLICATION_EVALUATE |
| 6.4 | n8n: WF_GUILD_STORYLOOP_MATCH_AND_ASSIGN |
| 6.5 | n8n: WF_NIGHTLY_STORY_AUDIT |
| 6.6 | Hooks + UI: Guild dashboard, rozšířený StoryLoop pro storyloop flow |

**Odhad:** 3-5 sessions

---

## 5. Migrace a datový tok

### 5.1 Pravidla pro migrace

1. **Zpětná kompatibilita** — existující tabulky se NEMAŽOU, přidávají se VIEWs
2. **Žádné breaking changes** — existující hooky musí fungovat bez úprav
3. **Inkrementální** — každá fáze má vlastní migrace, testovatelné izolovaně
4. **RPC-only** — nové funkce jen přes `supabase.rpc()`, žádné `.from()`

### 5.2 Naming konvence pro migrace

```
supabase/migrations/
├── 20260228000000_mcp_knowledge_vector_search.sql  (obnovit!)
├── 20260301_phase1a_knowledge_graph_tables.sql
├── 20260301_phase1b_knowledge_sync_triggers.sql  
├── 20260302_phase2a_story_rulesets_contexts.sql
├── 20260302_phase2b_story_participants.sql
├── 20260303_phase3a_compliance_functions.sql
├── 20260304_phase4a_accounts_entitlements.sql
├── 20260305_phase5a_story_environments.sql
├── 20260305_phase5b_ai_observability.sql
├── 20260306_phase6a_guild_memberships.sql
└── 20260306_phase6b_consultations.sql
```

### 5.3 Datový tok: Expert Rule → Knowledge Graph → MCP → Story

```
┌──────────────────┐     trigger      ┌──────────────────┐
│  expert_rules    │ ───────────────→ │ knowledge_items   │
│  (guild source)  │                  │ (unified model)   │
└──────────────────┘                  └────────┬─────────┘
                                               │ chunk+embed
                                               ▼
                                    ┌──────────────────┐
                                    │ knowledge_chunks  │
                                    │ knowledge_embed.  │
                                    └────────┬─────────┘
                                             │
                                             ▼
                                    ┌──────────────────┐
                                    │ MCP Server        │
                                    │ (search, get,     │
                                    │  validate, ctx)   │
                                    └──────────────────┘
                                             │
                          ┌──────────────────┼──────────────────┐
                          │                  │                  │
                          ▼                  ▼                  ▼
                    Copilot/Cursor      End-user chat       CI/CD gate
                          │                  │                  │
                          └──────────────────┼──────────────────┘
                                             │
                                             ▼
                                    ┌──────────────────┐
                                    │ Story (projekt)   │
                                    │ story_rulesets    │
                                    │ story_contexts    │
                                    │ story_environ.    │
                                    └──────────────────┘
```

---

## 6. Rizika a mitigace

| Riziko | Impact | Mitigace |
|--------|--------|----------|
| Revertnuté soubory (migration + protocol) | 🔴 Vysoký — MCP server nefunkční | Fáze 0: okamžitá oprava |
| 160+ existujících tabulek — collision | 🟡 Střední | VIEWs pro zpětnou kompatibilitu, nikdy DELETE tabulky |
| Knowledge embedding kvalita | 🟡 Střední | Iterativní tuning chunk size + overlap |
| n8n infrastruktura | 🟡 Střední | Začít s Edge Functions, n8n přidat až pro Fázi 5 |
| Stripe webhook race conditions | 🟡 Střední | Idempotency keys v entitlements |
| Blueprint scope creep | 🔴 Vysoký | Striktní fázování — nedělat více než 1 fázi najednou |
| Story model rozšíření | 🟡 Střední — přidané sloupce na existující tabulku | Nullable sloupce, postupné rollout, VIEW pro kompatibilitu |

---

## Souhrn: Doporučené pořadí

```
IHNED:    Fáze 0  — Opravit revertnuté soubory (1 session)
SPRINT 1: Fáze 1  — Knowledge Graph Foundation (2-3 sessions)
SPRINT 2: Fáze 2  — Story Delivery Context + Ruleset (1-2 sessions)
SPRINT 3: Fáze 3  — PR Compliance Gate (2-3 sessions)
SPRINT 4: Fáze 4  — Accounts + Entitlements (3-4 sessions)
SPRINT 5: Fáze 5  — Story Delivery Engine + Storyloop (4-6 sessions)
SPRINT 6: Fáze 6  — Guild Formalizace + Full Autonomy (3-5 sessions)

Celkem: ~16-23 sessions
```

**Okamžitý next step:** Fáze 0 → Fáze 1 (obnovit soubory + Knowledge Graph Foundation).
