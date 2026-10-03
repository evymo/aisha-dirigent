# Spec 06 — Infra rozvaha: SearXNG (web-search backend) + proč ne ChromaDB/ntfy

> **Priorita:** Střední (váže se na spec 04) · **Effort:** M · **Riziko:** Střední
> **Odysseus zdroj:** `config/searxng/`, `services/search/`, SearXNG jako web-search backend pro deep research
> **Kontext:** Odysseus staví na třech self-host/privacy infra komponentách — ChromaDB, SearXNG, ntfy. Tato rozvaha říká, kterou z nich pro AISHU adoptovat a kterou ne.

---

## 1. Rozhodnutí v kostce

| Komponenta | Role v Odysseovi | AISHA dnes | Verdikt |
|------------|------------------|------------|---------|
| **ChromaDB** | Vektor store pro RAG, tool-index, memory | pgvector + Elasticsearch/Ragnarok (hybrid BM25+KNN), embed-dispatcher, capability-resolver | **Neadoptovat.** Redundance a krok zpět. Ber jen *pattern* (embed popisů toolů → spec 01), postav na pgvectoru. |
| **SearXNG** | Web-search backend pro deep research | Žádný živý web-search provider (jen interní KB/Ragnarok) | **Zvážit reálně.** Plní skutečnou mezeru pro spec 04. Detail níže. |
| **ntfy** | Push notifikace (připomínky, dokončení tasku) | svc-push, RabbitMQ, Matrix, `web_push_subscriptions` | **Nízká priorita.** Produkčně pokryto líp. Max. dev/ops alert kanál. |

Společná nit: Odysseus tyto tři volí kvůli self-host/privacy ethosu. AISHA má dvě (Chroma, ntfy) pokryté silněji; **SearXNG je jediný, co plní reálnou díru.** I Odysseus ROADMAP přiznává křehkost napojení („degraded-state reporting pro ChromaDB, SearXNG, email, ntfy") → potvrzuje „ber pattern, ne nutně službu".

---

## 2. SearXNG — proč a jak

### 2.1 Proč (mezera v AISHA)
Spec 04 (deep research) potřebuje **živý web-search zdroj** pro Think→Search→Extract→Synthesize. AISHA dnes umí jen interní KB (Ragnarok/pgvector) — nemá privacy-preserving web search. Možnosti:
- Komerční API (Brave/Bing/Google CSE/Serper) — per-query náklady, data odchází třetí straně, horší pro CZ/GDPR a enterprise governance.
- **SearXNG** — self-hosted meta-search agregátor přes desítky enginů. Bez per-query nákladů, data zůstávají in-house, žádný vendor lock-in. Sedí na enterprise/CZ kontext a na consent/governance model (CLAUDE.md source-onboarding).

### 2.2 Jak (cílový design)
- Nasadit SearXNG jako **volitelnou službu** (Docker Compose service, např. `searxng` v `docker-compose.coolify-*` rodině; konfig à la Odysseus `config/searxng/settings.yml` — JSON output, zapnuté jen důvěryhodné enginy, rate-limit).
- **Tenký search adaptér** v AISHA (např. `services/svc-mcp-knowledge` nebo nový `svc-web-search`): `webSearch(query, opts)` → SearXNG `/search?format=json` → normalizované výsledky.
- **Povinné bezpečnostní napojení:**
  - Veškerý odchozí dotaz a fetch výsledných stránek **přes SSRF guard** (`packages/security/ssrf.ts`, spec 05A) — SearXNG i cílové stránky jsou untrusted.
  - Veškerý vrácený obsah (snippets, fetchnuté stránky) **přes untrusted wrapper** (spec 02) — „data, ne instrukce".
  - Date-grounding preamble (spec 04) na generování dotazů.
- **Dynamičnost:** počet výsledků / hloubka / které enginy = funkce research kola a budgetu (spec 04), ne konstanta. Volitelně provider-abstrakce `WebSearchProvider` (SearXNG | API fallback), ať jde přepnout per tenant/profil.
- **Caching:** krátký TTL cache dotazů (jako embed/RAG resolver) kvůli nákladům a rate-limitům upstreamů.

### 2.3 Integrační body
- `services/svc-mcp-knowledge` nebo nový `svc-web-search` (adaptér)
- `packages/security/ssrf.ts` (spec 05A) — povinné
- `packages/security` untrusted wrapper (spec 02) — povinné
- spec 04 deep-research orchestrátor (konzument)
- `docker-compose.coolify-*` + `config/searxng/` (deploy)
- Langfuse (trace dotazů, náklady/latence)

### 2.4 Scope
**In-scope:** SearXNG služba + konfig; `webSearch()` adaptér s normalizací; napojení na SSRF + untrusted wrapper; provider-abstrakce s API fallbackem; query cache.
**Out-of-scope:** vlastní crawler/index (SearXNG agreguje existující enginy); náhrada Ragnaroku (web je doplněk interní KB, ne náhrada); deep-research orchestrace samotná (spec 04).

### 2.5 Rizika
- **Kvalita/stabilita výsledků** — veřejné enginy mění HTML, rate-limitují. Mitigace: víc enginů, API fallback provider, cache, degraded-state reporting.
- **Ops zátěž** — další služba k provozu/monitoringu. Mitigace: volitelná (feature flag), zdravotní probe v `cold-start:verify`.
- **Bezpečnost** — web = untrusted vstup do LLM. Mitigace: SSRF (5A) + untrusted wrapper (02) povinně, žádná výjimka.
- **Právní/compliance** — scraping ToS některých enginů. Mitigace: jen povolené enginy, respektovat robots/rate-limity, konzultace s governance.

### 2.6 Akceptační kritéria
- Deep-research dotaz (spec 04) vrátí živé web výsledky přes SearXNG; každý fetch projde SSRF guardem (test).
- Vrácený obsah je obalen untrusted wrapperem (test).
- Při výpadku SearXNG se služba degraduje (API fallback nebo jasný degraded stav), nepadá celý research.
- Feature flag off → research běží jen nad interní KB jako dnes.

---

## 3. ChromaDB — proč ne (a co si vzít)
- **Ne jako služba:** AISHA má pgvector (transakční, jeden stack) + Ragnarok (hybrid BM25+KNN, lepší recall než čisté embeddings) + embed-dispatcher (backend-agnostic) + capability-resolver (health/cost-aware výběr modelu). Chroma nic z toho nepřidává a rozbíjí jeden ops/auth model.
- **Co si vzít:** Odysseus `tool_index.py` *pattern* — embeduj popisy toolů a retrievuj top-K (spec 01). Implementuj nad **pgvectorem**, ne nad Chromou. Tedy: myšlenka ano, engine ne.

## 4. ntfy — proč (zatím) ne
- AISHA má `svc-push` + RabbitMQ + Matrix + `web_push_subscriptions` — produkční notifikační infra s auth a auditem. ntfy je proti tomu minimalistický.
- **Kde by dávalo smysl:** lehký self-hosted **dev/ops alert kanál** (CI, cold-start, degraded-state z 5A) bez FCM/APNs setupu, nebo self-host fallback. Ne jako součást produktové notifikační cesty.
- **Doporučení:** odložit; pokud vůbec, tak jako interní ops kanál, ne core.

---

## 5. Pořadí vůči ostatním specům
SearXNG má smysl řešit **spolu se spec 04** (je to jeho search backend) a **až po spec 05A (SSRF) + spec 02 (untrusted wrapper)**, které jsou jeho bezpečnostní předpoklady. Samostatně bez spec 04 nemá konzumenta.
