# Story Sync Runtime — dvojče story mezi guru (origin) a replikou

> **Status:** IMPLEMENTACE (feat/story-sync-runtime)
> **SoT (kód):** `aisha/db/sql/functions/export_story_bundle.sql`,
> `import_story_bundle.sql`, `import_story_bundle_from_manifest.sql`,
> `bootstrap_story_replica.sql`, `adopt_story_as_stack_default.sql`,
> `promote_story_bundle.sql`, `approve_story_promotion.sql`, `reject_story_promotion.sql`,
> `validate_sync_authorization.sql`, `generate_instance_auth_token.sql`,
> `register_story_instance.sql`, `seed_default_sync_policies.sql`,
> `fn_recalculate_ruleset_fingerprint.sql`
> **Transport:** `scripts/db/story-sync-pull.mjs` (`npm run story:sync:pull`)
> **Navazuje na:** [architecture/STORY_SELF_EVALUATION_LOOP.md](architecture/STORY_SELF_EVALUATION_LOOP.md) (§ seam),
> [architecture/stack-topology.md](architecture/stack-topology.md)

---

## 1. Architektura dvojčete

Story žije jako **dvojče** ve dvou instancích:

- **Origin (guru stack)** — kanonický zdroj pravdy. Zde story vzniká, zde se
  kurátorují expert rules, knowledge items a build config. Jediná instance
  s `story_instances.is_origin = true`. Pouze origin smí exportovat bundle
  (vynucuje `validate_sync_authorization`).
- **Replika (lokální instance)** — provozní kopie na cílovém stacku. Přijímá
  bundly (`import`), nikdy do ní nelze importovat, pokud je origin. Lokální
  změny knowledge items se dostávají zpět jen přes **promote** flow (viz §6).
  Replika typicky adoptuje story jako **stack-default** (singleton story, která
  vlastní iterace veřejného default webu — viz `ensure_stack_default_story.sql`).

Přenosovým artefaktem je **story bundle** (`story_bundles.portable_manifest`,
jsonb) s SHA-256 integrity hashem (`bundle_manifest_hash`). Každý přenos je
zapsán do `story_sync_operations` + `audit_journal`.

## 2. KRITICKÉ POŘADÍ — story vzniká na origin PRVNÍ

Identita story = její **UUID na origin**. Replika si NIKDY negeneruje vlastní
story UUID pro synchronizovanou story — **adoptuje** UUID z originu:

1. Story vznikne na **guru (origin)** — běžný lifecycle (`partner_stories`).
2. Na origin se registruje origin instance (`register_story_instance`,
   `p_is_origin => true`) a seedne se politika (`seed_default_sync_policies`).
3. Replika zavolá `bootstrap_story_replica` — vytvoří lokální
   `partner_stories` řádek **se stejným UUID** (origin `story_metadata.id`
   z manifestu, `origin = 'replica_sync'`) + zaregistruje lokální replica
   instanci (`is_origin = false`).
4. Import bundlu (`import_story_bundle_from_manifest`).
5. Volitelně `adopt_story_as_stack_default` — replika prohlásí adoptovanou
   story za stack-default (místo lokálně bootstrapované „Stack default web“).

Obrácené pořadí (story nejdřív na replice) rozbije identitu dvojčete —
UUID by se lišila a sync by neměl kam mířit.

## 3. Co se přenáší / nepřenáší

Řídí `story_sync_policies` (`data_class` × `flow_direction`; defaulty seeduje
`seed_default_sync_policies.sql`). `validate_sync_authorization` vrací
`blocked_domains`; import zablokované sekce manifestu přeskočí
(mapování domén → sekce: `rulesets` → `expert_rules` + `ruleset`,
`knowledge_items` → `knowledge_items`, `build_config` → `build_config`,
`story_metadata` → `story_metadata`).

| Doména | data_class | flow_direction | Přenáší se? |
|---|---|---|---|
| `story_metadata` (title, status, tech_stack, domain, project_preview, repo_*) | canonical_portable | downstream_only | ✅ origin → replika |
| `rulesets` (expert rules + fingerprint) | canonical_portable | downstream_only | ✅ origin → replika |
| `knowledge_items` | canonical_portable | promote_on_approval | ✅ obousměrně (upstream jen přes promote) |
| `build_config` / `portable_config` | canonical_portable | downstream_only | ✅ origin → replika |
| `sync_policies` | canonical_portable | downstream_only | ✅ origin → replika |
| `embeddings`, `knowledge_chunks` | derived_reproducible | no_sync | ❌ rebuild lokálně (trigger, viz §8) |
| `audit_journal` | sovereign_local | local_only | ❌ nikdy neopouští instanci |
| `ai_trace_events` (live AI sessions/traces) | sovereign_local | local_only | ❌ |
| `endpoint_bindings` (URL + auth refs, MCP tokeny) | sovereign_local | local_only | ❌ |
| `sessions` (AISHA session state) | sovereign_local | local_only | ❌ |
| `story_entries` (timeline) | sovereign_local | local_only | ❌ suverénní běh každé instance |
| environments / instance konfigurace | *(implicitně lokální)* | *(bez policy řádku)* | ❌ nejsou v manifestu; `seed_default_sync_policies` pro ně explicitní řádek neseeduje |
| `goal_state` | *(implicitně lokální)* | *(bez policy řádku)* | ❌ není v manifestu; explicitní policy řádek se neseeduje |

Domény označené *(implicitně lokální)* nemají v `seed_default_sync_policies.sql`
žádný explicitní řádek — lokální zůstávají tím, že je export do manifestu vůbec
nepackuje (policy tabulka je řídí jen tam, kde manifest sekci má).

Dvě dodatečné pojistky mimo policy tabulku:

- **Sdílená pravidla:** import nikdy nepřepíše expert rule sdílené jinou story —
  pokud je slug-matchnuté lokální pravidlo referencované rulesetem jiné story,
  jeho UPDATE se přeskočí a vykáže v metadatech operace jako
  `skipped_shared_rules` (audit `SYNC_RULE_SHARED_SKIPPED`); lokální fingerprint
  se pak od manifestu liší → outcome `partial` (viz §8).
- **Replica instance:** unique index `idx_story_instances_replica_label_unique`
  (`(story_id, instance_label) WHERE is_origin = false`) garantuje nejvýše jednu
  replica instanci na story a label — souběžné `bootstrap_story_replica` volání
  tak nemohou vytvořit duplicitní repliku.

## 4. Prerekvizity na replice

- Běžící lokální stack (PostgREST na `AISHA_POSTGREST_URL`, default
  `http://127.0.0.1:3001`).
- **`entry_type_definitions` seed per instance** — timeline typy se
  nesynchronizují, každá instance je musí mít naseedované
  (`npm run db:seed` / `db:seed:instance`) DŘÍV, než story začne lokálně žít.
- Aplikované story-sync funkce (SoT `aisha/db/sql/functions/`, viz hlavička).

## 5. Tokeny — vydávání a scopes

Tokeny vydává **admin/staff na instanci, která data drží**, přes
`generate_instance_auth_token(p_expires_in_days, p_instance_id, p_scopes, p_token_name)`:

- Plaintext (`aisha_sync_<64 hex>`) se vrátí **jen jednou**; DB ukládá SHA-256 hash
  (`instance_auth_tokens`). Default expirace 90 dní.
- Scopes (jsonb pole): `sync:export` (export z originu), `sync:import`
  (import do repliky), `sync:promote` (návrh upstream změn).
- `validate_sync_authorization` vynucuje: instance aktivní, token platný
  a nerevokovaný, scope odpovídá operaci, export jen z originu, import nikdy
  do originu.
- Token autorizuje **RPC vrstvu** (parametr `p_instance_token`); HTTP vrstva
  PostgREST vždy potřebuje navíc JWT klíč (apikey + Bearer).

## 6. Promote flow (replika → origin)

Domény s `flow_direction = 'promote_on_approval'` (default: `knowledge_items`)
se upstream nedostávají přímým importem (ten je do originu zakázán), ale přes
dvoufázový proces:

1. **Propose** — `promote_story_bundle(p_manifest, p_manifest_hash,
   p_source_instance_id, p_instance_token)` běží na **originu**: ověří
   integritu manifestu, autorizuje repliku (token se scope `sync:promote`,
   nebo admin/staff bez tokenu), profiltruje sekce podle sync policies
   (jen `promote_on_approval` domény; v1 materializuje `knowledge_items`)
   a zapíše PENDING operaci.
2. **Approve / Reject** — admin/staff na **originu**:
   `approve_story_promotion(p_operation_id)` materializuje payload do
   kanonických dat (match `(story_id, slug)`, update jen při vyšší verzi,
   změna propadne do dalšího bundlu), nebo
   `reject_story_promotion(p_operation_id, p_reason)` operaci zamítne.
   Obojí auditované (`story_sync_operations` + `audit_journal`).

## 7. Použití transport skriptu

```bash
# První pull (bootstrap repliky + adopce stack-default):
AISHA_SYNC_ORIGIN_URL=https://guru.example.com \
AISHA_SYNC_ORIGIN_KEY=<origin service key / anon JWT> \
AISHA_POSTGREST_SERVICE_KEY=<local service key> \
npm run story:sync:pull -- \
  --story-id=<uuid> --bootstrap --adopt-default \
  --origin-token=<aisha_sync_… se scope sync:export> \
  --source-instance-id=<origin instance uuid> \
  --local-token=<aisha_sync_… se scope sync:import>

# Opakovaný pull (replika už existuje):
npm run story:sync:pull -- --story-id=<uuid> --target-instance-id=<replica instance uuid>

# Náhled bez zápisu (export na originu ZAPISUJE, dry-run proto nevolá nic):
npm run story:sync:pull -- --story-id=<uuid> --target-instance-id=<uuid> --dry-run
```

Kroky skriptu: `export_story_bundle` (origin) → fetch `portable_manifest`
(origin `story_bundles`) → volitelně `bootstrap_story_replica` (local) →
`import_story_bundle_from_manifest` (local) → volitelně
`adopt_story_as_stack_default` (local). Po úspěchu skript vypíše HINT na zápis
`.aisha/story.json` (`{"story_id": …}`) pro `npm run gen:ide`.

## 8. Fingerprint verifikace a odvozená data

- **Ruleset fingerprint** = `md5(string_agg(slug || ':' || version || ':' ||
  COALESCE(ai_instructions,''), '|' ORDER BY slug))` přes published pravidla
  (`fn_recalculate_ruleset_fingerprint.sql`).
- **Manifest `schema_version` `1.1.0`** přidává `ai_instructions` do
  `expert_rules` — import fingerprint přepočítá a ověří proti manifestu.
- **Zpětná kompatibilita `1.0.0`:** manifest bez `ai_instructions` →
  fingerprint verifikace se **přeskočí** a outcome operace dostane poznámku
  (import neselže).
- **Embeddingy se nepřenášejí** (`no_sync`) — po importu knowledge items je
  **rebuilduje lokální trigger** nad `knowledge_items`; není potřeba žádný
  ruční krok.
