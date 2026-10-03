# Universal Member Model + Aggregation + AI Tier Access

> **Hlavní teze (key insight z user feedbacku):**
> Source-specifické entity (GAR/LING/DC, Gakyil role, teacher kategorie) **nejsou nové koncepty** — jsou specifické manifestace existující aisha tier progrese **registered → active → qualified → partner**. Z toho plyne: minimal new tables, maximum konfigurace + agregace.
>
> **Tento dokument definuje:**
> 1. Mapping tier model (source → aisha) — jak konkrétní source role/entity sedí v existujícím aisha modelu
> 2. Aggregation flow — kde a jak se počítají statistiky, princip "no raw backend data"
> 3. AI integration per tier — využití existujícího aisha story/chat + guardrails
> 4. Upstream-mergeable strategy — co je generic, co zůstane ve forku

---

## 1. Universal member tier progression

Aisha už má v `profiles` + `memberships` + `partner_profiles` + `study_consultants` + permission systému veškerou potřebnou strukturu pro **5-tier member progresi**:

```
┌──────────────────────────────────────────────────────────────────┐
│                    MEMBER TIER PROGRESSION                       │
└──────────────────────────────────────────────────────────────────┘

   ANONYMOUS  ─►  REGISTERED  ─►  ACTIVE  ─►  QUALIFIED  ─►  PARTNER
                                                                  │
                                                                  ▼
                                                            [+ AUDIENCE]
                                                            (computed)
```

### 1.1 Tier definice (universal)

| Tier | aisha equivalent (DB stav) | Permission gate | Capabilities |
|---|---|---|---|
| **Anonymous** | No `auth.users` row | Public-only | Read public pages, view marketing |
| **Registered** | `auth.users` + `profiles.user_id` exists, `memberships.status='active' | 'basic'` | `member` Keycloak role | Own profile, basic dashboard, read scoped content |
| **Active** | `profiles` + recent activity (last 30d engagement signal) | `member` + activity threshold | Receive notifications, contribute, join events |
| **Qualified** | `partner_profiles.is_certified=true` + `certification_passed_at` | `practitioner` Keycloak role | Expanded capabilities, can be assigned to scope |
| **Partner** | `partner_profiles.is_visible=true` AND `is_production_provider=true` | `partner` permission code | **Has own audience** (computed); creates content; admin-grade scope view of OWN data |

### 1.2 Source mapping

| Source entity | aisha equivalent | Realizace |
|---|---|---|
| Registered source-app user | `profiles` row | Auto-sync přes source-api connector |
| Active source-app user (logged in last 30 days) | `profiles` + `engagement_aggregate.app_accesses_30d > 0` | Computed (no new tier table) |
| Qualified — někdo, kdo prošel kvalifikací (např. SMS dokončený course) | `partner_profiles.is_certified` + `certification_level` | Upgrade přes admin akci nebo automatickou kvalifikaci |
| **GAR/LING/DC** (organization affiliation) | `partner_profiles` rows where `business_name = 'Berlin DC'` etc. + `services[]` markers | Není separátní entita — jsou to **partner_profiles records s typed `services` tag** indikujícím "DC" / "LING" / "GAR" |
| **Gakyil role** (Blue/Yellow/Red Gakyil, Secretary, Communication) v centru | `study_consultants`-like pattern generalized: `crm.role_assignment(contact_user_id, organization_partner_id, role_name, status, started_at, ended_at)` | Single generic table, source just seeds role names |
| **Teacher** (active partner s audiencí) | `partner_profiles.is_visible AND is_certified AND (creates events)` + audience metric computed | NIC nového — Teacher = Partner s computed audience |
| **Teacher specialization** (SMS / Khaita / Vajra Dance / Yantra Yoga) | `partner_profiles.services TEXT[]` se seed hodnotami `['SMS']`, `['Khaita', 'Vajra Dance']` atd. | NIC nového — služby pole už existuje |

### 1.3 Co zůstává jediné "nové"

Po této redukci zbývá **jen 4 skutečně nové koncepty**:

1. **`crm.engagement_aggregate`** — denně cachované statistiky per contact (app_accesses, events_created, audience_size, ...). Pro list-view filtering a sorting. **Žádné raw data**, jen aggregate.
2. **`crm.connector_registry`** — registry konektorů (parallel `mcp_server_registry`).
3. **`crm.connector_credentials`** — encrypted secrets per connector.
4. **`crm.connector_sync_state`** — last_sync_at, cursor, retry tracking per connector + entity_type.

Plus 1 **nová role assignment tabulka** (generalizace `study_consultants` na non-study context):

5. **`crm.role_assignment`** — universal scoped role binding `(user_id, scope_type, scope_id, role_name, status, started_at, ended_at)`. Source seedne role names; jiný tenant seedne svoje.

A nakonec **3 extensions na existující aisha tabulky** (backward-compat ALTER ADD COLUMN):

6. `context_profiles.data_scope_rule JSONB` — kdo vidí jaký scope (pro creator-stats)
7. `notification_campaigns.channel TEXT[]` (rozšířit z `send_push/send_inapp` boolean) — email/sms/whatsapp/matrix
8. `notification_campaign_runs` → přidat per-recipient sub-table `notification_campaign_recipient` pro tracking

**Z 16 původně plánovaných nových položek se redukujeme na 5 nových + 3 extensions.** To je 50 % redukce a všechno upstream-mergeable.

---

## 2. Aggregation flow (princip "no raw backend data")

### 2.1 Princip

> **Audience modul nikdy nevrací raw rows ze source systémů (source-api, atd.). Vrací jen pre-computed aggregates v kontextu uživatele.**

To znamená:
- Když creator otevře "My Audience" tab, frontend dostane `{eventCount: 12, totalAttendance: 340, audienceGrowth30d: 0.18}`, NE `SELECT events JOIN attendees WHERE creator=...`.
- Když admin filtruje contacts podle "events_published > 5", filtr operuje nad `crm.engagement_aggregate.events_published_30d`, NE nad source-api Event tabulkou.
- Live detail view dělá GraphQL/REST volání do source-api **přes connector layer s permission check**, výsledek je vždy aggregate (`getMyEventStats(eventId)` → `{attendance, growth, ...}`), ne tabulkový dump.

### 2.2 Sequence diagram — denní engagement sync

```
┌────────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  cron-scheduler│    │ svc-crm-connector│    │  source-api     │    │ aisha postgres  │
│  (event-worker)│    │  /sync trigger   │    │ (Django/PG10)   │    │  crm.* schema   │
└───────┬────────┘    └────────┬─────────┘    └────────┬────────┘    └────────┬────────┘
        │                      │                       │                      │
        │ 00:00 nightly trigger│                       │                      │
        ├─────────────────────►│                       │                      │
        │                      │                       │                      │
        │                      │ POST /readonly/aggregate_engagement_since(timestamp)
        │                      ├──────────────────────►│                      │
        │                      │                       │                      │
        │                      │                       │ EXEC SECURITY DEFINER│
        │                      │                       │ fn returns aggregates│
        │                      │ [(user_id, app_accesses_30d, events, ...)]   │
        │                      │◄──────────────────────┤                      │
        │                      │                       │                      │
        │                      │ UPSERT crm.engagement_aggregate              │
        │                      │ (per user_id, snapshot_date=today)          │
        │                      ├──────────────────────────────────────────────►
        │                      │                       │                      │
        │                      │ NOTIFY pg_notify('crm_aggregate_updated')   │
        │                      ├──────────────────────────────────────────────►
        │                      │                       │                      │
        │ done; next run tomorrow                      │                      │
        │◄─────────────────────┤                       │                      │
        │                      │                       │                      │
```

### 2.3 Sequence — creator opens "My Audience" tab (live)

```
┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌─────────────────┐  ┌──────────┐
│ Browser  │  │ gateway  │  │ PostgREST    │  │ svc-crm-connect │  │source-api│
│ (React)  │  │ (Fastify)│  │  (aisha DB)  │  │  (Fastify)      │  │          │
└────┬─────┘  └────┬─────┘  └──────┬───────┘  └────────┬────────┘  └────┬─────┘
     │ GET /api/me/audience       │                   │                │
     ├────────────►│              │                   │                │
     │             │ JWT verify   │                   │                │
     │             │ extract sub  │                   │                │
     │             │              │                   │                │
     │             │ GET /rpc/crm_my_audience()       │                │
     │             ├─────────────►│                   │                │
     │             │              │ RLS gate: caller has role 'partner'│
     │             │              │ AND auth.uid() = creator_user_id   │
     │             │              │                   │                │
     │             │              │ SELECT FROM crm.creator_audience_v │
     │             │              │ WHERE creator_user_id = auth.uid() │
     │             │              │                                    │
     │             │              │ (no rows yet — fresh view)         │
     │             │              │                                    │
     │             │              │ TRIGGER materialize via FDW        │
     │             │              ├──────────────────►│                │
     │             │              │                   │ SELECT from   │
     │             │              │                   │ source-api    │
     │             │              │                   │ readonly fns  │
     │             │              │                   ├───────────────►│
     │             │              │                   │ aggregated    │
     │             │              │                   │ result        │
     │             │              │                   │◄──────────────┤
     │             │              │ aggregated rows   │                │
     │             │              │◄──────────────────┤                │
     │             │              │                   │                │
     │             │ {audience: 340, growth: 0.18, ...}                │
     │             │◄─────────────┤                                    │
     │ {audience: 340, ...}       │                                    │
     │◄────────────┤              │                                    │
     │             │              │                                    │
```

**Klíčové vlastnosti:**
- Browser **nikdy** nedotazuje source-api přímo.
- PostgREST RLS **gates** dotazy podle Keycloak JWT claims (auth.uid()).
- `crm.creator_audience_v` je **VIEW** (materialized when stale), ne tabulka — schovává JOIN/aggregate complexity.
- Connector je **server-side proxy** mezi PostgREST a source-api, drží FDW connection a SP contract.

### 2.4 Scope rules (kdo vidí co)

| Caller (Keycloak role + tier) | Co vidí | RLS implementace |
|---|---|---|
| `admin` | Vše napříč všemi creators | `is_admin_or_staff() = true` |
| `partner` (creator) | Vlastní audience (events kde `created_by = auth.uid()`) | `creator_user_id = auth.uid()` |
| `practitioner` | Vlastní + audience role-scoped (např. partneři, které spravuje) | `creator_user_id = auth.uid() OR scope_member_of(auth.uid(), creator_user_id)` |
| `member` (registered) | Pouze vlastní engagement (NEvidí audience cizích creators) | `target_user_id = auth.uid()` |
| Anonymous | Public KPIs (community-wide aggregates) | `is_public_metric = true` |

### 2.5 Implementace scope (re-use `context_profiles`)

Místo budování nové RLS infrastruktury **rozšíříme `context_profiles`** o `data_scope_rule JSONB`:

```sql
ALTER TABLE context_profiles ADD COLUMN data_scope_rule JSONB DEFAULT '{}';

-- Source creator scope:
INSERT INTO context_profiles (slug, display_name, data_scope_rule, ...) VALUES
  ('crm_creator_self', 'Creator: own audience',
   '{"filter": "creator_user_id = auth.uid()", "tier_required": "partner"}'::jsonb,
   ...);

-- RLS function:
CREATE FUNCTION crm.user_can_see_creator_stats(target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT
    is_admin_or_staff()
    OR target_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM crm.role_assignment ra
      JOIN profiles p ON p.user_id = target_user_id
      WHERE ra.user_id = auth.uid()
        AND ra.scope_type = 'organization'
        AND ra.scope_id = p.organization_partner_id
        AND ra.status = 'active'
        AND ra.role_name IN ('Communication', 'Secretary')
    );
$$;
```

---

## 3. AI integration per tier (re-use aisha story/chat/guardrails)

Aisha už má:
- **`svc-ai-chat`** — chat service s AI capabilities
- **`storyloop/`** komponenty — story-based AI interakce (CommunicationBlockTemplate, AgentActivityStream)
- **`context_profiles`** — per-role context config (layers, token budget, reranker)
- **Guardrails** přes JWT-scoped permissions + permission codes
- **`ai_provider_registry`** + **`ai_model_registry`** — pluggable LLM backends

### 3.1 Tier-gated AI capabilities

Mapování každého tieru na typ AI interakce + context profile:

| Tier | AI capability | Context profile slug | Reasoning scope |
|---|---|---|---|
| **Anonymous** | ❌ Žádné AI | — | — |
| **Registered** | Generic AI assistant (FAQ, navigation) | `crm_ai_basic` | Public content + member's own profile data |
| **Active** | Generic AI + recommendations (content discovery) | `crm_ai_engaged` | + member's engagement history |
| **Qualified** | Personalized insights (own progress, certifications) | `crm_ai_certified` | + qualification record + study data |
| **Partner** | Audience analytics AI (creator stories, content suggestions) | `crm_ai_creator` | + own audience aggregates + engagement trends + content performance |
| **Admin** | Full operational AI (cross-creator, system-wide insights) | `crm_ai_operator` | All data, no scope filter |

### 3.2 Context profile per tier — config example

```json
{
  "slug": "crm_ai_creator",
  "display_name": "AI: Creator analytics",
  "layers": [
    {"type": "ruleset", "id": "creator_ethics"},
    {"type": "kb_retrieval", "namespaces": ["source_creator_guides"]},
    {"type": "context", "scope": {"$ref": "data_scope_rule"}},
    {"type": "memory", "user_scope": true}
  ],
  "token_budget": 12000,
  "priority_order": ["ruleset", "context", "memory", "kb_retrieval"],
  "reranker_provider": "vllm_local",
  "data_scope_rule": {
    "filter": "creator_user_id = auth.uid()",
    "tier_required": "partner",
    "permission_required": "view_own_audience_stats"
  },
  "tier_required": "partner",
  "is_active": true
}
```

### 3.3 Chat vs Story — kdy které

- **Chat** (svc-ai-chat): synchronous Q&A — krátké interakce, "kdy je můj příští event?", "jaká je moje audience tento měsíc?"
- **Story** (storyloop): asynchronous, long-form — "review my last 3 events and suggest improvements" — generuje story blocks (CommunicationBlockTemplate, AgentActivityStream) s plánem, výzkumem, doporučeními

Tier-gated access:
- Anonymous/Registered: pouze chat, žádné story
- Active: chat + read-only story (vidí story sdílené komunitou)
- Qualified+: může spustit vlastní story s AI agentem
- Partner+: story může účinkovat agregaci nad audience data
- Admin: cross-creator story (operational insights)

### 3.4 Guardrails (re-use existující mechanismů)

Aisha už používá:
- **JWT claims** (`acr=2` pro MFA-required sensitive RPCs)
- **`auth_time`** check pro max session age na citlivých operacích
- **Permission codes** (e.g., `manage_orders`, `view_sensitive_data`)
- **RLS policies** na DB úrovni

Pro audience modul přidáme **3 nové permission codes**:
1. `view_own_audience_stats` — partner tier required
2. `compose_audience_message` — partner tier + opt-in granted
3. `manage_crm_connectors` — admin tier + manage_permissions

Žádný nový guardrail framework. Re-use existing.

---

## 4. Upstream-mergeable strategy

### 4.1 Princip

Cíl: **fork source-crm musí být schopen přijímat upstream aisha změny bez konfliktů** + **co nejvíc audience modulu má skončit upstream** (přínos celé aisha community).

### 4.2 Co je generic (upstream PR-kandidát) vs source-specific (zůstává ve forku)

| Komponenta | Upstream | Fork-only | Reason |
|---|---|---|---|
| `crm.engagement_aggregate` tabulka | ✅ | | Generic engagement concept |
| `crm.role_assignment` tabulka | ✅ | | Generalizace existujícího `study_consultants` patternu |
| `crm.connector_registry` + `connector_credentials` + `connector_sync_state` | ✅ | | Universal connector framework |
| `svc-crm-connector` Fastify service | ✅ | | Generic |
| `packages/crm-connector-api` (IConnector interface) | ✅ | | Generic |
| `context_profiles.data_scope_rule` extension | ✅ | | Universal |
| `notification_campaigns.channel[]` extension | ✅ | | Universal |
| `notification_campaign_recipient` tabulka | ✅ | | Universal tracking concept |
| `AdminCrmConnectorRegistry.tsx` page | ✅ | | Generic UI |
| `AdminCrmAudienceAnalytics.tsx` page | ✅ | | Generic |
| `domains/source/` directory + crm-seed.sql | | ✅ | Tenant-specific |
| Source-api connector implementation (`connectors/adapters/source-api/`) | | ✅ | Tenant-specific |
| Source-specific terminology / labels (Gakyil, GAR, ...) | | ✅ | Tenant-specific (i18n + seed) |
| Keycloak Identity Brokering config pro source-api OIDC | | ✅ | Tenant-specific |
| mahasource.net pages | | ✅ | Source public web |

### 4.3 Fork repo struktura (pro maintainability)

```
aisha-crm-fork/                            (clone evymo-ai-orchestrator)
├── packages/
│   └── crm-connector-api/                 NEW upstream
├── services/
│   └── svc-crm-connector/                 NEW upstream
│       └── src/connectors/adapters/
│           ├── source-api/                FORK-ONLY (in tenant-specific subdir)
│           └── [other future adapters]    NEW upstream as added
├── aisha/db/migrations/
│   └── 20260601_crm_core.sql              NEW upstream
├── src/pages/admin/
│   ├── AdminCrmAudienceAnalytics.tsx      NEW upstream
│   ├── AdminCrmConnectorRegistry.tsx      NEW upstream
│   └── AdminCrmRoleAssignments.tsx        NEW upstream
├── src/pages/
│   └── MemberPortal.tsx                   EXTEND upstream (add "My Audience" tab)
├── domains/
│   ├── default/                           (existing upstream)
│   └── source/                            FORK-ONLY tenant config
├── public/source-public/                  FORK-ONLY (mahasource.net assets)
└── keycloak/
    ├── aisha-realm.json                   EXTEND upstream (add brokering schema)
    └── source-broker-config.json          FORK-ONLY
```

### 4.4 Sync workflow (přijímání upstream změn)

```bash
# Setup (one-time):
git remote add upstream https://repo.id3a.cz/aisha/evymo-ai-orchestrator.git

# Recurring (weekly):
git fetch upstream
git checkout main
git merge upstream/main      # generic audience stuff already merged; tenant-specific untouched
# Resolve conflicts if any (typically only in domains/source/ or source-api adapter, which fork-only)
git push origin main

# Contribute upstream:
git checkout -b feat/crm-engagement-aggregate
# (commit only the generic parts; source-specific stays in fork)
git push origin feat/crm-engagement-aggregate
gh pr create --upstream evymo-ai-orchestrator/main --title "Add crm.engagement_aggregate table + connector framework"
```

### 4.5 Anti-patterns (NE dělat)

❌ **NE upravovat existující aisha tabulky destruktivně** (DROP COLUMN, type change) — vždy ALTER ADD COLUMN s defaultem, backward-compat.
❌ **NE měnit aisha permission codes** — přidávat jen nové (`view_own_audience_stats` ano, přejmenovat existující `manage_orders` NE).
❌ **NE inlinovat source terminologii do core kódu** — všechno přes seed + i18n keys.
❌ **NE forkovat soubory, které jsou stabilní upstream** — přidat NOVÉ soubory vedle, ne nahradit.

---

## 5. Konkrétní deliverables (modely + testy)

Tento dokument je design rationale. Modely (SQL + TypeScript) jsou v `../skeleton/sql/` a `../skeleton/types/`. Testy v `../skeleton/tests/`.

### 5.1 SQL modely

- `00_crm_schema.sql` — schema + 5 nových tabulek
- `10_aggregation_views.sql` — materialized views + refresh functions
- `20_scope_functions.sql` — RLS helpers + permission gates
- `30_seed_source_domain.sql` — source-specific data (GAR/LING/DC, Gakyil, teacher categories)

### 5.2 TypeScript types

- `IConnector.ts` — connector interface
- `crm-entities.ts` — domain types
- `member-tier.ts` — tier enums + tier-derivation logic
- `aggregation.ts` — metric types + scope rule types

### 5.3 Testy (vitest)

- `tier-mapping.test.ts` — source role → aisha tier mapping correctness
- `aggregation.test.ts` — aggregation logic (creator audience, engagement growth)
- `scope.test.ts` — RLS scope enforcement (user X cannot see Y stats)
- `connector.test.ts` — IConnector contract conformance
- `ai-tier-access.test.ts` — AI tier-gated access (registered cannot use creator AI)

---

## 6. Open questions & decisions

| # | Question | Default | Trade-off |
|---|---|---|---|
| 1 | `crm.role_assignment` vs extending `study_consultants` | Nová tabulka generic `role_assignment` | New = clean separation; Extend = less drift |
| 2 | Materialized views vs regular views s aggregation | Materialized (refresh nightly) | Speed vs freshness |
| 3 | Connector creds storage | `pgcrypto` envelope (pgp_sym_encrypt) | Simple; alt: HashiCorp Vault sidecar |
| 4 | Scope rule language | JSON DSL ({"filter": "creator_user_id = auth.uid()"}) | Simple; alt: full CEL/Rego |
| 5 | AI tier policy | `context_profiles.tier_required` + permission code | Re-use existing; alt: dedicated `ai_access_policy` table |
| 6 | Member portal "My Audience" tab | Extend existing MemberPortal.tsx | Single source; alt: dedicated page |
