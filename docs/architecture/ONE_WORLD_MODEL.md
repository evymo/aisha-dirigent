# Jeden svět — axiomatický model AISHA stacku (One World Model)

> **Status:** ratifikováno operátorem 2026-09-05 (rozhodnutí D0, viz `docs/adr/ADR-003-jeden-svet.md`).
> **Vrstva:** jádro, instance-agnostic, `upstreamable`. Žádné slovo v tomto dokumentu nesmí
> být jménem věci konkrétní instance; kde se instance zmiňují, je to jen jako důkaz, že dělají totéž.
> **Navazuje na** lens dokumenty téže disciplíny: `docs/audience/UNIVERSAL_MEMBER_MODEL.md`,
> `RECURRING_INTERACTION_CADENCE.md`, `DOSING_AS_DISTRIBUTION_CADENCE.md`, `TWIN_PULSE_MODEL.md`,
> `STORY_SELF_EVALUATION_LOOP.md`, `SCHEMA_RELATIONSHIP_LENS.md` a skill `aisha-surfaces`.
> **Naměřeno 2026-09-05** ze `aisha/db/sql/`, `packages/surface-blocks/`, `services/svc-source-broker/`,
> `apps/workbench-shell/`; cesty u tvrzení.

**Abstract (EN).** AISHA is a kernel of about a dozen primitives that carry no domain nouns —
entity, relation, context, record, proposal, rule-as-data, run, beat, confirmation, view,
dialog, source. An instance's world is a graph that grows only through three vectors
(ingested content, confirmed human work, events) and only by ratified proposals. Instances
supply names, kinds, templates and sources as overlay data — the "soul" — and never touch the
kernel. Every instance (documents, community, customer care, production, AISHA evaluating
itself) instantiates the same loop; they only name it differently.

---

## 0. Věta

**AISHA je jádro primitiv bez jmen věcí. Svět instance je graf, který roste jen potvrzenými
návrhy a potvrzenou prací. Instance dodává slovník a pravidla jako data.**

Z toho plyne všechno ostatní: proč je dvojče entita a story kontext, proč masky jsou uzavřené
a sekce otevřené, proč stroj nikdy nepotvrzuje, proč se nic nemaže a proč každé číslo nese zdroj.

---

## 1. Primitiva jádra

| # | Primitivum (EN) | Definice bez oborového slova | Nosič ve stacku (existuje) | Stav / dluh |
|---|---|---|---|---|
| 1 | **Entita** (entity) — *dvojče* | uzel s druhem, štítkem, parametry a referencemi na cizí identity; existence záznamu ustavuje vztah k reálnému subjektu | `twin_entities(entity_type, label, status, metadata)`, `twin_external_refs(source, source_key, ref_kind, state proposed\|confirmed, confidence, valid_from/to)`, `twin_parameter_definitions`; `twin_upsert_entity_audited`, `twin_identity_propose_binding`, `twin_identity_confirm_binding`, `twin_graph_descendants` | ✅ · ⚠ volitelný subsystém (predikáty ho hledají `to_regclass`) → **K1** |
| 2 | **Vazba** (relation) | hrana mezi entitami s druhem, platností a metadaty; zastoupení, členství, odpovědnost, nadřazenost | `twin_relations(relation_kind, valid_from, valid_to, metadata)`; `twin_relation_open/close_admin` | ✅ |
| 3 | **Kontext** (context) — *story* | rámec kolem entit: účastníci s rolemi, značky, cíl, narace, hodnocení; hranice práv | `partner_stories`, `story_participants(role)`, `story_labels`, `evaluate_story_process_goal`, `evaluate_story_self`, `story_timeline`, `is_story_participant()`; **všechno visí na `story_id`** (běhy, dokumenty, události, nudge, osa pohledu) | ✅ |
| 4 | **Záznam** (record) | typový výrok o subjektu v čase s provenance; komunikace, poznámka, dokument, událost, měření, doručení | `story_entries(entry_type, subject_type, subject_id, occurred_at)`, `twin_events(event_type, twin, related_twin, place_twin, story_id, source, source_ref)`, `li_source_registry` (dokument s poli), `openclaw_notifications` (doručení), `integration_events` (signál); typy = `entry_type_definitions` | ✅ |
| 5 | **Návrh** (proposal) | strojově odvozený výrok s důvěryhodností a původem, dokud ho člověk nepotvrdí | `twin_external_refs.state='proposed'`, `li_entity_suggestions`, `li_obligations.candidate_status`, `li_findings`, `improvement_proposals` (`fn_create_improvement_proposal`), `dirigent_nudges` | ✅ |
| 6 | **Pravidlo jako data** (rule) | co má v kontextu platit: proces, kadence, dotazník, pravidlo signálu, konfigurace pohledu | `production_workflow_templates` + `_template_versions`, `distribution_protocols` (frekvence × intenzita), `questionnaires`, `signal_tag_rules`, `notification_campaigns`, `surface_blocks.source_params`, `translations` | ✅ · ⚠ název `production_*` → **K6** |
| 7 | **Běh** (run) | pravidlo spuštěné nad jedním subjektem v kontextu; uzly přiřazené lidem nebo rolím; stavový stroj | `production_batches(workflow_template_id, story_id, study_id)`, `production_workflow_steps(step_code, status, assigned_role, assigned_user_id, input_data.authorized_twin_id)`; `ensure_workflow_run_for_subject` (idempotentní, překládá reference dvojčat), `workflow_step_visible_to` (přiřazení · role · potvrzená vazba účtu · dispečink) | ✅ generické |
| 8 | **Takt** (beat) | co je dluženo, do kdy a kým; účetní zápis, ne zpráva | `story_pulse_beats(subject_type, subject_id, beat_type, due_at, assigned_to_user_id, source_type, source_id)`; `create/close_pulse_beat_audited` | ✅ nosič · ⚠ kloub milník → takt → **K2** |
| 9 | **Potvrzení** (confirmation) | lidský akt, který z návrhu nebo taktu udělá fakt a spustí přepočet | `submit_evidence_review_audited(entity_kind)` (jediná zápisová cesta plochy), `complete_workflow_step` (narace + nudge + odměna + re-evaluace cíle), `close_pulse_beat_audited`, `twin_identity_confirm_binding`; stopa = `audit_journal` | ✅ |
| 10 | **Pohled** (view) | projekce grafu pro účastníka: sekce = otevřená data, maska = uzavřený renderer, osa pohledu = data, číslo nikdy bez zdroje | `surface_sections/layouts/blocks/data_rpcs`, `get_surface_layout`, `get_block_data`, `list_surface_sections`, `surface_audience_allows`, `get_scope_options`; obecné čtečky veličin `twin_param_values` → `twin_param_agg` → `get_twin_metric_{kpi,chart,table}_block` (co se počítá, říká blok a katalog, ne jméno funkce); masky `packages/surface-blocks/src/types.ts` `BLOCK_TYPES`; čočky `audience_admin_*_v` | ✅ · ⚠ restricted blok bez klientských parametrů → **K3** |
| 11 | **Dialog** (dialog policy) | jak s kým mluvit; mění formu, pořadí a počet voleb, nikdy fakta | Naturel F0 (`get/update_my_storyloop_ui_preferences`), kanály doručení, AITG výstupní guard | ✅ |
| 12 | **Zdroj** (source) | kontext materializovaný na instanci s bindingem a schválením; adaptér jen navrhuje; bez zdroje stack běží | `audience_resolve_source_binding`, `audience_admin_approve_source`, `svc-source-broker` (`li-driver.ts`, `twin-producer.ts`, `null-data-source.ts`), Enterprise Source Onboarding gate | ✅ |

**Odvozené pojmy (žádné nové primitivum):** *účet* = potvrzená reference `ref_kind='account'`
na entitě; *skupina* = entita + kontext + kontejner členství (`studies` + `study_registrations`);
*tier* = odvozený atribut z agregátů (`audience_actor_tier_v`, nikdy uložený); *agregát* =
pohled nad záznamy (`user_engagement_metrics`); *kampaň* = běh z pravidla s cílem jako množinou
entit; *úkol / follow-up* = jednouzlový běh; *dokument* = záznam s poli a stavem review.

---

## 2. Zákony (invarianty) a kde je stack vymáhá

| # | Zákon | Vymáhá |
|---|---|---|
| Z1 | **Zákon jmen:** jádro zná druhy věcí (entity, vazba, záznam, běh…), nikdy jména věcí (klient, faktura, člen, Gakyil). Jméno v jádru je dluh, ne struktura. | `layer-boundary.gate`, `public-oss-boundary.gate`, `aisha-branding.gate`; i18n klíče všude (`title_key`, `label_key`, `name_key`); `TWIN_PULSE_MODEL.md` „no concept below is allowed to carry a domain word" |
| Z2 | **Fakt jen potvrzením.** Stroj (ingest, model, cizí systém) navrhuje; fakt vzniká lidským aktem nebo auditovaným pravidlem. | `state proposed/confirmed`, `candidate_status`, review dráha `review_queue`, `handover_confirm` („chytristika sem nepatří", `types.ts`) |
| Z3 | **Žádné číslo bez zdroje.** Každý blok nese `provenance{source_slug, freshness_at, trace_id}`; `null` = neměřeno, nikdy nula. | `get_block_data` obálka, `block-data-keys-fit-contract.gate`, schémata bloků |
| Z4 | **Fakta se nemění, jen podání** (E8). Personalizace nikdy nemění čísla, zdroje, termíny. | Naturel resolver, `console-odolnost` test |
| Z5 | **Otevřené druhy, uzavřené masky.** Sekce, druhy entit, vazeb, záznamů, šablony = řádky. Renderer = release všech klientů. | skill `aisha-surfaces`, `BLOCK_TYPES` + `schemas.ts` + CHECK v lockstepu, parity gate rendererů |
| Z6 | **Autorizace váže subjekt, ne adresáta.** Gate „je to adresováno mně" by pustil zápis na cizí entitu. | `create_pulse_beat_audited` (#797), `workflow_step_visible_to` (jediné místo znající identitu) |
| Z7 | **Vedlejší účinek nesmí zničit akt.** Narace, cíl, odměna, nudge běží v chráněném bloku. | `complete_workflow_step` (goal re-eval non-fatal), audience RPC (spine write warn-not-abort) |
| Z8 | **Fail-closed.** Allowlist `is_active` default false; neznámá citlivost = nerenderovatelné; neznámý klíč publika = odepřeno; anon bez rozsahu. | `surface_data_rpcs`, `assertRenderable`, `surface_audience_allows`, `definer-rpc-security.gate`, `rls-predikat-a-indexy.gate` |
| Z9 | **Nic se nemaže.** Platnost od–do, `superseded_by`, uzavření vazby; výjimka = GDPR výmaz s auditem. | `twin_relations.valid_to`, `li_source_registry.superseded_by`, `audience_admin_gdpr_erasure_log_v` |
| Z10 | **Idempotence zápisů ze zdrojů.** Balík = kurzor; běh = `run_code`; reference = `ON CONFLICT`. | `li-driver` (manifest = cursor unit), `ensure_workflow_run_for_subject`, `audience_tag_resource` |
| Z11 | **Enforcement v platformě, projekce v klientovi.** SDK/skin jen kreslí; práva, allowlist, RLS rozhodují v DB. | `EXTRANET-FOUNDATION-PLAN` roviny A–D, `definer-nesmi-obchazet-invoker.gate` |

---

## 3. Jak svět roste

Tři vektory a jinak nic:

```
  VSTUPY                    PRÁCE ČLOVĚKA                 UDÁLOSTI
  ingest balík, sync         potvrzení, krok, akt          čas, kadence, signál, model
  zdroje, registrace         ve vlastním kontextu          (n8n, dirigent, pravidla)
        │                          │                             │
        ▼                          ▼                             ▼
   NÁVRHY (Z2)  ──── ratifikace ────►  FAKTA v KONTEXTU  ◄──── pravidlo spustí BĚH
   identity, vazby,                    záznamy, vazby,           ze šablony → TAKT
   závazky, nálezy,                    entity, běhy                    │
   běhy deklarované balíkem                 │                          ▼
                                            │                    práce = KROK
                                            ▼                          │
                                    PŘEPOČET (doménový):  ◄── POTVRZENÍ ┘
                                    cíl story, tier, zdraví,
                                    značky ze signálů, odměna
                                            │
                                            ▼
                                     POHLEDY (Z3, Z5): porada · věž · moje kroky · postup · registr · ask
                                            │
                                            └────────── nový akt člověka ──────────► (smyčka)
```

- **Řazení podle důvěryhodnosti, ne podle mechanismu.** Strukturovaný zdroj (DB replika,
  API, CSV export) dává návrhy s vysokou důvěrou; volný text (pošta, chat) s nízkou. Oba jdou
  touž review dráhou; liší se jen poměr návrh/fakt. Instance proto začíná strukturovanými
  zdroji a volný text přidává, až review dráha stíhá.
- **Stroj je účastník, který navrhuje.** AI konzultace ve story, návrhy zlepšení, nudge
  dirigenta, extrakce z ingestu: všechno primitivum 5. Každý dispatch modelu je zažurnalovaný
  (`aisha_resolve_clow_backend`, `fn_admit_clow`), výstup hlídá AITG. Autonomie per akce
  (`autonomous / assisted / off`) je pravidlo instance, ne výjimka ze Z2.
- **Přepočet je doménový.** Co znamená „daří se" (cíl story splněn, tier, zdraví stroje,
  spokojenost klienta) říká šablona nebo pravidlo instance. Jádro dodá jen spouštěč a nosič
  (`evaluate_story_process_goal`, `member_compliance_scores`, `signal_tag_rules`).
- **Nezávislost na zdroji.** `NullDataSource` je výchozí; svět roste registrací, ručním aktem
  a ingestem ze souboru i bez jediného externího systému.

---

## 4. Roviny stacku v tomto modelu

| Rovina | Co v modelu dělá | Kde |
|---|---|---|
| Identita a brána | přihlášení = potvrzená reference `account`; brána ověří KC RS256 a mintuje PostgREST HS256; `auth.uid()` = subjekt | `services/gateway`, `aisha_auth.identities` |
| Databáze | jediné místo pravdy a enforcementu: RLS na 100 % tabulek, `SECURITY DEFINER` + REVOKE/GRANT, `is_admin_or_staff()`, `is_story_participant()` | `aisha/db/sql/` (SoT), `heals.sql` (upgrade), baseline (cold start) |
| Broker a ingest | zdroje navrhují; balík deklaruje běhy; producent navrhuje identity | `services/svc-source-broker/src/clients/{li-driver,twin-producer}.ts` |
| Dirigent a n8n | vektor událostí: kadence, playbooky, nudge, návrhy zlepšení, self-evaluace story | `dirigent_dispatch_event`, `WF_*`, `evaluate_story_self` |
| AI | účastník, který navrhuje a vysvětluje: story loop, ask, konzultace; nikdy nepotvrzuje | `svc-ai-chat`, `get_answer_block`, storyloop hooky |
| Ledger | neměnná stopa potvrzení a odměn: in-DB hash-chain + volitelný řetězec | `award_tokens`, `fn_blockchain_audit_chain_link`, `fn_blockchain_audit_guard` |
| Plochy | pohledy: workbench (web), mobilní extranet, native; sekce z DB, masky v klientech | `apps/workbench-shell`, `mobile-app/src/extranet`, `provision-surfaces.sh` |
| Dialog | Naturel per osoba; kanály doručení | `mobile-app/src/naturel`, openclaw, kampaně |
| Dílna | ad-hoc dotazy mimo masky; co se osvědčí, stane se řádkem bloku | Appsmith (`ADR-002`) |
| Instance overlay | jména, druhy, šablony, zdroje, sekce, brand | `<instance>-instance-data/NN_*.sql`, `surfaces/<instance>/`, `domains/templates/*` |

---

## 5. Tentýž model, N instancí

| Primitivum | Doklady (RIQ) | Komunita (<fork>) | Customer care / obchod | Výroba | AISHA sama (self-eval) |
|---|---|---|---|---|---|
| Entita | protistrana, jednotka, měřidlo | praktikující, centrum, učitel | klient, kontaktní osoba, zakázka | šarže, stroj, materiál | story, repo, služba |
| Vazba | dlužník ↔ doklad, jednotka ↔ areál | člen ↔ centrum, role ↔ Gakyil | zastupuje, pracuje pro | šarže ↔ linka | služba ↔ story, slot ↔ story |
| Kontext | příběh dlužníka / zakázky | story praktikujícího / centra | story klienta / případu | story šarže | story projektu |
| Záznam | faktura, dodací list, odečet | dotek, účast, post, komunikace | mail, hovor, schůzka, objednávka | krok výroby, měření | trace event, drift, incident |
| Návrh | extrahovaná pole, závazek z klauzule, identita protistrany | identita ze zdroje, závazek z pošty | identita z CRM exportu, závazek z mailu | odchylka | improvement proposal |
| Pravidlo | šablona expedice, lhůty | onboarding člena, re-engagement, obnova, post-event | onboarding klienta, care cyklus, eskalace | šablona výrobního procesu | deploy flow, playbook |
| Běh | expedice dodávky | běh onboardingu člena | běh onboardingu klienta | výrobní běh | deploy / evaluace story |
| Takt | splatnost, odečet do | follow-up do, praxe dnes | kontakt do, SLA | servisní interval | opakovat měření do |
| Potvrzení | předání s podpisem, review klauzule | potvrzení účasti, dokončení kroku | uzavření případu, potvrzení schůzky | potvrzení milníku | approval gate |
| Pohled | registr dokladů, věž expedic | registr dvojčat, porada, trychtýř | registr klientů, věž případů | věž šarží | ops dashboard, workbench |
| Dialog | dispečer / řidič | praktikující / koordinátor | klient / account owner | operátor linky | vývojář / operátor |
| Zdroj | ERP, lokální ingest smluv | komunitní API, Raynet export, pošta | CRM export, pošta, e-shop | MES, senzory | Sentry, Coolify, git |

Slova ve sloupcích jsou **překlady** (`translations`, katalogy, šablony overlaye). Řádky jsou
jádro. Instance, která by potřebovala nový řádek, ukazuje na chybějící primitivum jádra
(upstream), ne na vlastní tabulku.

---

## 6. Čočky, které už existují (a proč jsou důkazem)

Každý z těchto dokumentů vzal matoucí povrchové jméno a ukázal, že je to jen projekce
jednoho existujícího modelu, bez nové tabulky:

- **Audience** (`UNIVERSAL_MEMBER_MODEL.md`): GAR/LING/DC, Gakyil, učitel = tier progrese +
  vazby + parametry; „evaluation je perspektiva, ne entita".
- **Kadence** (`RECURRING_INTERACTION_CADENCE.md`, `DOSING_AS_DISTRIBUTION_CADENCE.md`):
  dávka = jedna instance frekvence × intenzita; praxe, check-in, care beat jsou totéž.
- **Twin puls** (`TWIN_PULSE_MODEL.md`): sedm domén = jedna smyčka režim → takt → potvrzení
  → přepočet; jediný nový nosič byl takt.
- **Self-evaluace** (`STORY_SELF_EVALUATION_LOOP.md`): AISHA hodnotí vlastní provoz touž
  story smyčkou; návrh zlepšení = primitivum 5, approval = primitivum 9.
- **Schéma** (`SCHEMA_RELATIONSHIP_LENS.md`): vazby jsou projekce katalogu, ne kreslený model.
- **Plochy** (skill `aisha-surfaces`): sekce otevřené, masky uzavřené; sedm bloků porady
  bez jediného doménového slova v rendereru.

Tento dokument je jen společný jmenovatel těch šesti.

---

## 7. Dluhy vůči modelu (naměřeno 2026-09-05)

| Dluh | Porušený zákon | Náprava |
|---|---|---|
| Vrstva identity dvojčat je volitelný subsystém (`to_regclass` guardy) | primitivum nemůže být volitelné | **K1:** do jádra a cold-start baseline; instance smí mít nula druhů, ne nula vrstvy |
| Dvě „dvojčata": story per aktér vs. entita identity | Z1 (dva nosiče téhož) | **D0:** entita = identita, story = kontext; story per aktér = hlavní kontext entity |
| Audience modul klíčovaný na účet (`profiles.user_id`) | Z1 (účet ≠ identita) | **J1:** reference `account` na entitě; čočky přes `twin_id`; lidé bez účtu jsou entity |
| Milník běhu neotevírá takt; follow-up = takt + kompatibilní `ai_tasks` mimo běh | Z7/Z10 (dvě cesty, dvě pravdy) | **J2 / K2:** aktivní uzel otevře takt, potvrzení kroku ho zavře; follow-up = jednouzlový běh |
| Restricted blok neslévá klientské parametry (správně) → detail, hledání, scope nad PII nemají cestu | Z8 vs. použitelnost | **K3:** deklarovaný `client_params` kontrakt v konfiguraci bloku |
| Jediná zápisová cesta plochy je review; správa (značky, vazby, role) nemá masku | Z5 | **K4:** `surface_actions` allowlist + maska `action_form` + jedno auditované RPC |
| Tabulky běhů nesou `production_*` a pole výroby | Z1 | **K6:** přejmenování s aliasy (upstream), pole výroby jako parametry šablony |
| Kontejner členství (`studies`) nese lékařská pole | Z1 | ponechat jako kontejner, pole nepoužívat; přejmenování až s K6 |
| Dvě ze tří asynchronních drah se neprotínají (flow map: `pg_notify` ↔ event-worker jen jeden kanál) | Z10 (více zapisovatelů) | doc-truth + sjednocení kanálů (samostatná práce) |
| Chybí profil ingestu pro komunikaci; závazky jen z dokumentů | — | **K7:** `doc_type='communication'`, účastníci jako návrhy, závazky z textu s nízkou důvěrou |
| Cíl komunikace se vybírá per pohled, ne z grafu | — | **K8:** `audience_resolve_twins(filter)` — množina entit podle druhu, vazby, tieru, značky, skupiny |

---

## 8. Program pro další posun — všechny instance

### 8.1 Jádro (upstream, v tomto pořadí)

**Stav 2026-09-05 (večer):** K1, K2 a K3 jsou implementované ve forku (větev `chore/upstream-sync-2026-09-05`) s testy proti čisté DB: `one-world-identity-and-run-beat` 5/5, `twin-pulse-convergence` 4/4, `client-params-contract` 3/3, `audience-detail-blocks` 4/4; první instanciace = <fork> `registr` (instance-data `fafcb9b`). K4–K9 otevřené.


| K | Práce | Proč první / DoD |
|---|---|---|
| K1 | Identita do jádra: `twin_*` v baseline, provisioning i registrace zakládají entitu + referenci `account`; dorození existujících profilů | bez identity nejde nic dalšího · DoD: každá instance má po cold-startu vrstvu; každý účet má entitu |
| K2 | Kloub krok ↔ takt; follow-up = jednouzlový běh; fronta nad takty; `ai_tasks` kompatibilita zrušena | jediná zápisová cesta práce · DoD: běh z šablony otevře takt, potvrzení ho zavře, test proti DB |
| K3 | `client_params` kontrakt v `get_block_data` | detail, hledání, scope nad PII · DoD: gate „restricted blok neslije nedeklarovaný klíč" |
| K4 | `surface_actions` + `action_form` + `submit_surface_action` | správa na ploše · DoD: akce = řádek, RPC přes allowlist, audit |
| K5 | Osy pohledu jako data: `surface_scope_axes` + `get_surface_scope_axes`; `get_scope_options` zná šest DRUHŮ substrátu (registry, twin, twin_kind, relation, label, template); filtr má operátor (`eq`, `contains`) | věž a registr čitelné v každé instanci · DoD: osa = řádek overlaye, volby odvozené z dat, osa bez voleb se nenabízí |
| K6 | Přejmenování běhů (`process_*`) s aliasy; pole výroby → parametry šablony | Z1 · neblokuje, ale bez něj čte každá nová instance „výrobu" |
| K7 | Ingest profil `communication` + řazení podle důvěryhodnosti | obsah vyrábí práci · DoD: mail → záznam + návrhy účastníků + závazky k review |
| K8 | `audience_resolve_twins(filter)` + doručení jako záznam na ose příjemce | komunikace podle typu a zastoupení |
| K9 | Rozšíření zákona jmen do brány: nová tabulka jádra s doménovým slovem neprojde; `gen:catalog:check` v CI | aby se dluh neopakoval |

### 8.2 Overlay instance — co každá instance dodává (checklist)

| Co | Kde (vzor) |
|---|---|
| druhy entit + parametry (`twin_parameter_definitions`); `metadata` nese i KDE hodnota leží (`event_type`+`attr`, nebo `shape:code_value`), volitelný převod do jednotky parametru (`scale`, `scale_div`) a `ingest_field` | `NN_twins.sql` |
| druhy vazeb a jejich překlady | `translations` ns instance |
| kontexty: role účastníků per druh skupiny | `translations`, seed účastí |
| typy záznamů (`entry_type_definitions`) | `00_02_*_entry_types.sql` |
| šablony: procesy s verzemi, kadence, dotazníky, kampaně, pravidla signálů | `NN_templates.sql` |
| zdroje: binding, schválení, ingest profily, deklarace běhů v balíku | `NN_source_story.sql`, `04_*_federation.sql`, balík |
| plochy: sekce, bloky, allowlist, umístění, i18n, brand | `42_surface_layouts.sql`, `surfaces/<instance>/` |
| dialog: výchozí kanály, jazyky, Naturel kalibrace | `app.config.json`, kanály kampaní |
| KB a pravidla chování operátorů | `00_kb.sql` |

Test překladu: každé slovo v overlayi musí jít nahradit jiným, aniž by se změnil jediný řádek
jádra. Pokud ne, je to dluh jádra (§7), ne vlastnost instance.

### 8.3 Cesta známých instancí

- **Doklady (RIQ):** už document-first; přijme K2 (takty z milníků), K5 (rodiny šablon ve věži),
  K6 (přejmenování). Nic v overlayi se nemění.
- **Komunita (<fork>):** `EXTRANET-AUDIENCE-ZADANI-2026-09-05.md` rev. 2, fáze E0–E6; J1/J2 = K1/K2.
- **Nové instance (web šablony `domains/templates/*`, aisha.guru, další tenanti):** začít od
  checklistu 8.2; žádná nová tabulka. Web šablony jsou důkazem: osm domén, jedno jádro.
- **AISHA sama:** self-eval smyčka (`STORY_SELF_EVALUATION_LOOP.md`) = tytéž primitiva;
  sekvence PR tam definovaná se nemění, jen se pojmenuje modelem.

### 8.4 Definition of Done „instance je na modelu"

1. Po cold-startu existuje vrstva identity; každý účet má entitu s potvrzenou referencí.
2. Žádné doménové slovo v jádru instance (brána K9 zelená); všechna jména v overlayi.
3. Alespoň jeden běh z šablony overlaye je vidět ve věži, v „moje kroky" a v postupu;
   potvrzení kroku zapíše naraci, zavře takt a přepočte cíl.
4. Návrh → potvrzení funguje pro identity a závazky z alespoň jednoho zdroje; bez zdroje
   (`NullDataSource`) projde táž akceptace.
5. Každý blok každé sekce nese provenance; `null` = neměřeno; restricted bloky slévají jen
   deklarované parametry.
6. Overlay lze přeložit do jiného slovníku bez změny jádra (test překladu 8.2).

---

## 9. Reference

- Rozhodnutí: `docs/adr/ADR-003-jeden-svet.md`, `docs/adr/ADR-002-extranet-je-cilova-plocha.md`
- Jádro: `aisha/db/sql/tables/{twin_entities,twin_external_refs,twin_relations,twin_events,twin_parameter_definitions,partner_stories,story_participants,story_entries,story_pulse_beats,production_batches,production_workflow_steps,production_workflow_templates,li_source_registry,li_obligations,li_findings,li_entity_suggestions,surface_blocks,surface_layouts,surface_data_rpcs}.sql`
- Slovesa: `aisha/db/sql/functions/{ensure_workflow_run_for_subject,complete_workflow_step,workflow_step_visible_to,submit_evidence_review_audited,create_pulse_beat_audited,close_pulse_beat_audited,twin_identity_propose_binding,twin_identity_confirm_binding,get_block_data,get_surface_layout,list_surface_sections,get_scope_options,evaluate_story_process_goal,evaluate_story_self,aisha_resolve_clow_backend,fn_admit_clow}.sql`
- Klienti: `packages/surface-blocks/src/{types,schemas}.ts`, `apps/workbench-shell/src/{App,instance,api}.tsx|ts`, `mobile-app/src/extranet/`
- Zdroje: `services/svc-source-broker/src/clients/{li-driver,twin-producer}.ts`, `docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md`, `docs/audience/ops/LOCAL_INGEST_DROP_LANE.md`
- Brány: `src/tests/gates/{layer-boundary,public-oss-boundary,definer-rpc-security,definer-nesmi-obchazet-invoker,block-data-keys-fit-contract,rls-predikat-a-indexy,owasp-discovery,aisha-branding}.gate.test.ts`, `scripts/db/check-*.mjs`
- Instance důkaz: `EXTRANET-AUDIENCE-ZADANI-2026-09-05.md` (aplatform root), `EXTRANET-FOUNDATION-PLAN-2026-07-19.md`, `docs/architecture/APPLICATION_FLOW_MAP.md`
