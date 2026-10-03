# RAG: vícejazyčný obsah a životní cyklus embedding modelu — zadání úvahy

> **Verze:** 0.2 (draft k rozpravě, grounded re-analýzou nad reálným kódem) | **Datum:** 25. června 2026
> **Status:** Design brief / RFC — rámuje rozhodnutí, NEimplementuje
> **Vrstva:** AISHA stack (generické) — abstrahováno nad konkrétní instancí
> **Fingerprint:** Embedding model je konstanta indexu, ne per-call volba; vícejazyčnost je vlastnost content nodu, ne dodatek
> **Podklad:** externí multilingual-RAG best-practices + ověření proti reálnému kódu a schématu stacku

---

## 0. Účel a rozsah

Tento dokument je **úvaha z pohledu aisha stacku**, ne návod pro jednu instanci.
Vše je abstrahováno na úroveň stacku (generický *tenant*, *content node*, *locale*),
aby závěry platily pro libovolné nasazení a mohly téct upstream.

Řeší jednu otázku a její důsledky:

> Když je obsah vícejazyčný a chceme nad ním RAG („AISHA odpovídá z našich dat
> podle toho, kdo a v jakém jazyce se ptá"), **jak stack vybírá, ukládá a
> spravuje embedding model** — a co z toho plyne pro schéma, retrieval,
> bezpečnost a hodnocení modelů?

Vznik: při přípravě vícejazyčného RAG vyšlo najevo, že naivní rámování („AISHA si
dynamicky vybere nejlepší embedding model podle svých benchmarků, jako u chat
modelů") **je koncepčně chybné pro embeddingy**. Dokument tu chybu pojmenovává a
navrhuje správné rámování.

---

## 1. Kontext: co stack už má (a co z toho plyne)

| Primitiv | Stav | Důsledek pro tuto úvahu |
|---|---|---|
| **Content node** (polymorfní `subject_type` + `subject_id`) | je | RAG ingestion + diskuze + překlady jdou po jedné ose |
| `knowledge_items` (`source_type`, `source_id`, `body_markdown`, `visibility`) | je | zpětný odkaz na content node existuje; **chybí `locale`** |
| `knowledge_chunks` → `knowledge_embeddings` (`vector(1536)` v1 + `halfvec(2560)` v2) | je | **dual-column = migrační vzor mezi modely** (klíčové níže) |
| `mcp_search_knowledge_v2/v3` (hybrid + čistý vektor, HNSW) | je | retrieval; **bez `p_locale`** |
| Capability-resolver (`aisha_resolve_clow_backend`) + registry + benchmarky | je | per-call výběr modelu — **správné pro chat, sporné pro embedding** |
| Eval framework (golden set, LLM-judge, RAGAS metriky) | je | **měří generaci, ne embedding retrieval** |
| Translation primitivy (`data-i18n-key` → `translations` per locale + fallback) | je | editorial content je vícejazyčný „string-extraction" cestou |

---

## 2. Hranice, která drží celý model: editorial vs. story

- **Editorial content node** (článek, stránka, KB topic — kurátorovaný org)
  → **vícejazyčný by design**. Existuje ve všech podporovaných locale jako
  první-třídní mutace; správné termíny per jazyk jsou hodnota (strojový překlad
  je poškozuje — *„damages exact tokens that matter"*).
- **User-generated story** (diskuzní příspěvek, komentář) → **single-language by
  design** (`original_locale`). Cross-jazyková komunikace členů se řeší
  **on-demand překladem** (per-locale translation tabulky), ne pre-translací.

Tato hranice určuje, co se embedduje vícejazyčně (editorial) a co zůstává v
jazyce autora (story).

---

## 3. Jádro úvahy: embedding model NENÍ chat model

Toto je nejdůležitější závěr a koriguje původní naivní rámování.

### 3.1 Invariant stejného modelu

Dotaz i **všechny** dokumenty musí být embeddované **týmž modelem**. Smíchání
modelů nebo dimenzí znamená, že vektory žijí v jiném prostoru a podobnost je
**bezvýznamná** — a co je horší, **selhání je tiché**: kvalita retrievalu klesne
bez chybové hlášky.

### 3.2 Per-call výběr je správně pro chat, špatně pro embedding

| | Chat / judge / rerank | **Embedding** |
|---|---|---|
| Granularita volby modelu | **per-volání** (nezávislé) | **per-index / per-korpus** (konstanta) |
| Přepnutí modelu | zdarma, hned | **re-embed celého korpusu** (migrace) |
| Resolver per-call (60s TTL) | ✅ dává smysl | ❌ rozbil by konzistenci |

Capability-resolver, který vybírá model **na každé volání**, je pro embedding
**anti-pattern**. Embedding model je vlastnost celého vektorového indexu.

### 3.3 Stack už má správný vzor: dual-column = migrace

`knowledge_embeddings` má paralelní sloupce `embedding` (v1, 1536) a
`embedding_v2` (v2/Qwen3, 2560) + `v2_status` + `model_pref` routing v searchi.
**To je přesně best-practice „dual index serving" migrace mezi embedding modely**
— ne dynamický per-call výběr. Stack tedy implicitně kóduje pravidlo:
*změna embedding modelu = vědomá migrace, ne runtime volba.* Tuto pravdu jen
nemáme explicitně pojmenovanou.

### 3.4 Správné rámování „AISHA si vybere podle vlastních benchmarků"

AISHA vybírá **STANDARDNÍ embedding model pro korpus** (jednou, ne per dotaz),
a to **retrieval benchmarkem** (Recall@K / nDCG / MRR na labeled setu), ne
LLM-judgem. Resolver pak pro embedding jen **routuje na backend toho aktuálního
standardního modelu** (lokál v devu / vLLM v prod). Přepnutí na lepší model
později = migrace přes dual-column.

### 3.5 Kde to v kódu žije (k ověření proti aktuálnímu kódu)

- **Pinning hook UŽ existuje:** `context_profiles.embedding_model_pref` (`v1`/`v2`)
  — ale je to **preference, ne enforcement** a generace ji **nekonzultuje**.
  Tady patří korpus-level pinning (rozšířit na `embedding_model` +
  `embedding_model_version` + **coverage gate**).
- **Generace nikdy nevolá resolver:** `knowledge-embeddings.ts:319`
  `generateEmbeddings(...)` bez backendu → vždy v1 (`text-embedding-3-small`).
- **v2 backfill ROUTE chybí** — existuje jen SQL `fn_get_embeddings_needing_v2`.
- **`knowledge_embeddings.model` je untyped `text` bez FK** na `ai_model_registry`
  → embeddingy nejsou vázané na registrovaný model.
- **`mcp_search_knowledge_v3` nevynucuje shodu** modelu dotazu a korpusu (caller
  předává `p_query_embedding_v1/v2`; nic nehlídá, že dotaz byl embeddovaný týmž
  modelem) → riziko tichého porovnání napříč prostory.
- **Coverage past:** když `embedding_model_pref='v2'` ale `embedding_v2` je NULL
  u části chunků → tichá degradace. Nutný **gate**: flip na v2 jen při 100 %
  pokrytí (`fn_get_embeddings_needing_v2` prázdné).

---

## 4. Dim-aware úložiště: standardizovat, ne zobecňovat

`pgvector` sloupce jsou **fixní-dimenze**. „Úložiště pro libovolný model jakékoli
dimenze" je anti-pattern (nejde indexovat, geometrie se rozpadá).

**Možnosti přepnutí modelu (best practice):**
1. **Full re-index + swap** — postavit nový index paralelně, ověřit, přepnout.
2. **Dual index serving** — starý + nový sloupec současně (← *to máme: v1/v2*).
3. **Lazy re-embedding** — nové dokumenty novým modelem, postupně.
4. **Drift-Adapter** — naučená transformace nový→starý prostor (95–99 % recovery,
   méně úložiště; novější, dozrává).

**Doporučení:** standardizovat na **jeden model + dim** per korpus; přepnutí
řešit dual-column migrací (vzor už existuje). Ne budovat arbitrární-dim úložiště.

---

## 5. Hodnocení embedding modelů ≠ hodnocení generace

`ai_model_benchmarks` (relevance / groundedness / safety / coherence,
LLM-judge) měří **textovou generaci** (RAGAS). **Na embedding modely se to
nehodí** — ty se měří **retrieval metrikami**:

- **Recall@K** (přistál správný dokument v top-K?), **MRR** (jak vysoko?),
  **nDCG@K** (gradovaná relevance),
- **p95 latence** při cílové dimenzi/indexu, **cost / 1M tokenů** při očekávaném
  objemu.

To vyžaduje **nový retrieval-eval harness**: malý **labeled set** (dotaz →
relevantní chunk), ideálně **stratifikovaný per jazyk** (CZ/EN/…), proti kterému
se kandidátní modely změří. Teprve to je „podle vlastních dat".

---

## 6. Vícejazyčný retrieval: jeden index + metadata, ne silo

- **Jeden sdílený multilingvální vektorový prostor** + `locale` jako **metadata
  tag** (ne separátní index per jazyk — to je „expensive overreaction").
- **`locale` jako sentinel** `NOT NULL DEFAULT 'global'` na items+chunks+
  embeddings → dnešní (jednojazyčné) chování beze změny, osa zabudovaná, žádný
  retrofit (přidat locale později tiše rozbije volající).
- **Retrieval jazykově-aware, ne silo:** `p_locale` jako **preference-boost** ve
  skóre (správné termíny), **nikdy hard-filter** (jinak pod-přeložené locale =
  prázdné odpovědi). Cross-lingual fallback nese sdílený prostor.
- **Hybridní ILIKE text-score je cross-lingválně nula** → ponechat jako
  *same-language* precision signál; cross-lingual nese vektor.

---

## 7. Bezpečnost: ACL v retrievalu, ne v promptu

- Členské úrovně jsou modelované (`membership_tier`, `audience_user_meets_tier_requirement`).
- RAG korpus se filtruje **na úrovni retrievalu** (RLS / validovaný `minimum_tier`
  ve `WHERE`), **ne** instrukcí v promptu (ta se obejde dotazem).
- `visibility` + `quarantine_status` jsou vlastnosti **tuple `(source_type,
  source_id)`**, ne jednotlivého locale itemu (jinak nekonzistentní viditelnost
  napříč jazyky).

---

## 8. Devět úskalí locale-aware RAG (mitigace shrnuta)

| # | Úskalí | Mitigace |
|---|---|---|
| 1 | Anglický contextual-prefix otráví neanglické embeddingy | locale-aware prefix (prompt v jazyce chunku) |
| 2 | Cross-lingual ILIKE silent score collapse | vector-first cross-lingválně; ILIKE jen same-language |
| 3 | Ranking pollution (N skoro-duplicit) | `source_concept_id` grouping / dedup, locale-preference |
| 4 | Volající se tiše rozbijí přidáním locale | sentinel `'global'`, update všech 5+ funkcí najednou |
| 5 | v1/v2 × locale dimenzionální exploze | locale jako řádek (per (chunk,locale)), ne sloupec |
| 6 | `clear_knowledge_item_chunks` smaže všechny locale | per-locale clear |
| 7 | Unique constraint konflikt | `(source_type, source_id, locale)` migrace |
| 8 | Cascade orphans při unpublish | ON DELETE CASCADE / per-tuple lifecycle |
| 9 | Staleness mezi zdrojovou a přeloženou locale | `source_hash` (vzor už v `knowledge_post_translations`) |

---

## 9. Rozhodnutí k rozpravě (to „zadání")

| # | Rozhodnutí | Doporučení | Rozhodne |
|---|---|---|---|
| **D1** | Na který embedding model standardizovat | změřit kandidáty (bge-m3 1024 multilingual / Qwen3 2560 / text-embedding-3 cloud) | **retrieval benchmark** na labeled CZ/EN setu |
| **D2** | Vícejazyčný retrieval | jeden index + `locale` metadata + preference-rerank | best practice + §6 |
| **D3** | Uložení locale | sentinel `'global'`, per (source, locale) item, locale na chunk/embedding | §6, §8 |
| **D4** | Bezpečnost RAG | tier-ACL v retrievalu (RLS + `minimum_tier`) | §7 |
| **D5** | Lifecycle modelu | dual-column migrace; resolver routuje, nevybírá | §3, §4 |

---

## 10. Korigovaný plán cihel

> Pořadí respektuje invariant „model je konstanta indexu": nejdřív VYBRAT
> standardní model (měřením), pak na něm stavět.

0. ✅ **Backend-agnostic embeddings** — **už ve stacku** (`embed-dispatcher.ts`,
   `backendKind` openai/vllm/ollama/lmstudio). Foundation existuje; staví se na ní.
1. **Retrieval-eval harness** — labeled CZ/EN set + Recall@K/nDCG/MRR + latence +
   cost → **změřit kandidáty** (D1). Výstup: standardní model + dim.
2. **Pinnout standardní model** jako index-level konstantu: rozšířit
   `context_profiles.embedding_model_pref` → `embedding_model` +
   `embedding_model_version` (enforcement, ne preference); registry dostane
   `is_embedding` + `embedding_dimensions`; `knowledge_embeddings.model` dostane
   FK na registry. Resolver pro `rag.embedding` **routuje na backend tohoto
   modelu** (lokál/prod), nevybírá jiný. **Guard:** `mcp_search_*` odmítne dotaz,
   jehož model ≠ korpus; **coverage gate** brání flipu na model s neúplným
   pokrytím. Doplnit chybějící **v2 backfill route** (volá resolver pro v2 model).
3. **Locale foundation** — sentinel `'global'` na items+chunks+embeddings; všech
   5+ retrieval/ingest funkcí locale-safe; `source_hash` staleness; tuple-level
   visibility (§8).
4. **Locale-aware ingestion** — content node → per (source, locale) knowledge_item;
   locale-aware contextual prefix; per-locale clear.
5. **Locale-aware retrieval** — `p_locale` preference-boost + cross-lingual
   fallback; dedup grouping.
6. **Tier-ACL** — `minimum_tier` + RLS přes `audience_user_meets_tier_requirement`.
7. **Persona/jazyk chat** — odpověď v jazyce tazatele z jeho-jazyk-preferovaného
   korpusu + provenance deep-link.

Každá cihla: gate + funkční + **integrační** test (async embedding producent →
integrační test čeká na reálné zpracování; cross-lingual retrieval test).

---

## 11. Invarianty (trvalá pravidla pro stack)

1. **Same-model invariant** — dotaz a dokumenty týmž embedding modelem. Vždy.
2. **Model = konstanta indexu**, ne per-call volba. Přepnutí = migrace.
3. **Embedding se hodnotí retrieval metrikami** (Recall@K/nDCG/MRR), ne LLM-judgem.
4. **Locale je metadata v jednom indexu**, ne separátní index per jazyk.
5. **Jazyková preference v reranku, ne hard-filter** (zachovat cross-lingual fallback).
6. **Bezpečnost v retrievalu, ne v promptu.**
7. **Editorial = multilingual, story = single-language** + on-demand překlad.
8. **Bez hardcodu modelu** — vše přes registry/resolver (i pinned standardní model).
9. **Model-match guard + coverage gate** — retrieval odmítne dotaz, jehož model ≠
   model korpusu; flip na nový model jen při 100 % pokrytí. Tiché porovnání napříč
   prostory je nepřípustné.

---

## 12. Otevřené otázky / rizika

- **Drift-Adapter** jako levnější alternativa k full re-embed při příští migraci?
- **MRL truncation** (Qwen3/text-embedding-3 podporují Matryoshka) — sjednotit
  dim napříč kandidáty pro férové srovnání i snazší migrace?
- **Labeled set** — kdo a jak ho vytvoří (golden dotazy → relevantní chunky) per
  jazyk, aby benchmark byl reprezentativní pro doménu daného nasazení?
- **Náklady** — N locale × embeddings + LLM contextual-prefix; rozpočet a kvóty.

---

*Tento dokument je k rozpravě. Implementace začíná až po D1 (změření a volbě
standardního embedding modelu) — protože vše ostatní je na tom modelu závislé.*
