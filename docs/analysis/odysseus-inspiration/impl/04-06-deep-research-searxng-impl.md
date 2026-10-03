# Impl 04 + 06 — Deep research smyčka + SearXNG web-search (implementačně připraveno)

> Navazuje na specy `04-deep-research-loop.md` a `06-infra-searxng-web-research.md`. **Pořadí:** 5. (poslední) — staví na impl 01/02/03/05A. Řešeno společně: SearXNG je search backend research smyčky.

## 1. Reálný stav (ověřeno)
- `services/svc-ai-chat/src/lib/criticLoop.ts` — iterativní retrieval (expand_tags / switch_profile), cap ~5 iterací, re-invokuje `compose_context()`. **Není** decompose→extract→gap→synthesize→stop.
- `svc-mcp-knowledge` `compose_context` / `ragnarok.ts` — single-shot interní retrieval. **Žádný web-search provider.**
- `aisha_resolve_clow_backend('reasoning'|'rag.*')` — výběr LLM backendu (health/cost-aware).

## 2. Architektura (nadstavba, ne náhrada)
```
runDeepResearch (svc-ai-chat, reflection vrstva)
  ├─ decompose(question)                 → podotázky  [resolve_clow_backend('reasoning')]
  ├─ loop (adaptivní hloubka, budget):
  │    ├─ search(gap)  → { interní: compose_context/ragnarok,  web: searxng (impl 06) }
  │    ├─ extract(topK) → fakta           [RAGAS faithfulness gate, reuse rag-eval-judges]
  │    ├─ gapAnalysis()  → co chybí?      → další kolo / stop
  │    └─ synthesize()   → evolving report (auditovaně uložen)
  └─ stop: LLM „dost?" ∨ budget cutoff ∨ hard cap kol
```
`criticLoop` se stává **sub-krokem** kroku `search` (quality re-retrieval), ne paralelní mechanismus.

## 3. SearXNG (impl 06)
**Služba** (Compose, volitelná): `searxng` v `docker-compose.coolify-*`; konfig `config/searxng/settings.yml` (JSON output, jen důvěryhodné enginy, rate-limit, `server.secret_key` z env).

**Adaptér** `services/svc-web-search/` (nebo `svc-mcp-knowledge/src/lib/webSearch.ts`):
```ts
export interface WebSearchProvider {
  search(query: string, opts?: { count?: number; lang?: string }): Promise<WebResult[]>;
}
export interface WebResult { title: string; url: string; snippet: string; engine: string; }

export function createSearxngProvider(cfg: { baseUrl: string; guard: SsrfGuard }): WebSearchProvider {
  return {
    async search(query, opts) {
      const u = `${cfg.baseUrl}/search?format=json&q=${encodeURIComponent(query)}&language=${opts?.lang ?? 'cs'}`;
      const res = await cfg.guard.safeFetch(u);            // ← pinned SSRF guard (impl 05A), povinné
      const json = await res.json();
      return (json.results ?? []).slice(0, opts?.count ?? 8)
        .map((r: any) => ({ title: r.title, url: r.url, snippet: r.content ?? '', engine: r.engine }));
    },
  };
}
```
Provider-abstrakce → API fallback (Brave/Serper) přepínatelný per tenant/profil. Krátký TTL cache dotazů.

## 4. Povinná bezpečnostní napojení
- **SSRF**: SearXNG dotaz i fetch cílových stránek přes `createPinnedSsrfGuard` (impl 05A).
- **Untrusted wrapper**: každý web snippet/stránka přes `wrapUntrusted('WEB', …)` (impl 02) než vstoupí do LLM.
- **Date-grounding**: preamble s reálným datem do generování dotazů (jinak „… 2025" v roce 2026).
- **Budget**: research má token/cost/time budget (Langfuse); stop i na limitu, ne jen „LLM říká dost".
- **Runaway guard**: hard cap kol + detekce opakovaných identických dotazů.

## 5. Dynamičnost (cíl uživatele)
- Hloubka adaptivní dle gap-analýzy + budgetu (jednoduchý dotaz 1 kolo, komplexní N).
- Zdroje pluggable (interní KB / web / konkrétní MCP tooly) — synergie s impl 01 (tool selection).
- Default off / opt-in pro „research" intent (drahé/pomalé).

## 6. Testy
- komplexní multi-fakt otázka → ≥2 kola s gap follow-up; jednoduchá → 1 kolo.
- každé tvrzení v reportu má citaci zdroje.
- budget cutoff zastaví research i bez LLM-stop.
- web obsah obalen untrusted wrapperem; fetch přes pinned guard (rebinding test).
- SearXNG výpadek → API fallback nebo degraded stav, ne pád.

## 7. Task checklist
- [ ] SearXNG služba + `config/searxng/` + zdravotní probe v `cold-start:verify`.
- [ ] `WebSearchProvider` + `createSearxngProvider` + API fallback + cache.
- [ ] `runDeepResearch` orchestrátor (decompose/search/extract/gap/synthesize/stop) v reflection vrstvě.
- [ ] criticLoop jako sub-krok; RAGAS faithfulness gate na extrahovaná fakta.
- [ ] Budget/hloubka/runaway guardy + Langfuse trace.
- [ ] Povinné: pinned SSRF (05A) + untrusted wrapper (02) + date-grounding.
- [ ] Feature flag `deep_research` (default off).

## 8. Vazby (proč poslední)
- **01**: tooly/zdroje dynamicky vybírané i pro research.
- **02**: web = untrusted → wrapper povinný.
- **03**: research kola se vejdou do context budgetu; kompakce mezi koly.
- **05A**: pinned SSRF je prerekvizit web fetchů.
- Bez konzumenta (research) nemá SearXNG smysl → 06 jde s 04.
