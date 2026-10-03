# Konvergence integrace `svc-local-ingest` + `svc-potok`

> Analýza a dokumentace sjednocené rozpracované práce (follow-upy W2/W3/edge/mesh/SBOM)
> na jeden koherentní celek. Uloženo v gitu (commit na `feat/ingest-potok-stack`, PR #726).
> Zásada: **žádné výjimky/allowlisty** — každý gate se řeší fixem u kořene, ne exempcí.

## Co se sešlo a jaký to má smysl

### 1. W2 — potok generation-backend registry (submodul `packages/potok` @ 93e77678)
**Co:** `potok/backends/generation/` registr s availability-probe + 4 adaptéry — `aisha_gateway`
(governed Omni `/v1`), `local_openai`, `mlx` (Apple), `mock`. `POTOK_GEN_BACKEND` pinuje;
nepin → probe + výběr; 0 serviceable → **fail-loud** (nikdy tichý mock).
**Smysl:** potok verifikační brány/rozpočty/provenance běží NAD vybraným modelem — potok je
verifikační vrstva nad AISHA modely, ne vlastní inference. Merged potok#3, pin bumpnut.

### 2. W3 — local-ingest KB-writer polovina (producent → konzument)
**Co:** SoT tabulky `li_source_registry / li_findings / li_links / li_obligations /
li_entity_suggestions` (RLS, granty, provenance sloupce, `updated_at` triggery), SECURITY
DEFINER RPC `li_upsert_*` (jediní zapisovatelé, REVOKE/GRANT service-role, audited),
`li-driver.ts` v `svc-source-broker` (pull z export `manifest.json` kurzoru, ověří
sha256+verify-result, idempotentní upsert přes `rpcService` — NIKDY raw table write).
`upsert_story_knowledge_item_audited` rozšířen o `service_role` authz path (li-driver KB zápisy).
**Smysl:** uzavírá Seam-C — local-ingest 3-gate extrakce → export bundle → li-driver →
`li_*` KB tabulky. Bez toho by exporty local-ingestu neměly kam téct. Story-centric:
záznamy se sbírají ke story (universal-lens).

### 3. Edge/mesh (deploy surface)
**Co:** `@ingest` / `@potok` edge routery + `netbird-agent` + `mesh-ingress` sidecary ve 3
compose (local-ingest, potok, prebuilt); INGEST/POTOK domény+upstreamy do `cold-start`
HEREDOC (env-doctor contract). **Smysl:** obě admin UI dosažitelné za edge (proper doména,
mesh peer `<role>.mesh.<TLD>`), plně v cold-start logice (opt-in brány).

### 4. Python SBOM lane
**Co:** `sbom-python` job (syft nad python image svc-local-ingest/svc-potok) v noční
`supply-chain.yml` + container-signing matice. **Smysl:** SBOM coverage pro python image
(npm cyclonedx lane je nepokrývá — nemají package.json). Runner-load-safe (noční).

## Odstranění výjimek (fix u kořene, ne exempce)

| Gate flag | ŠPATNĚ (výjimka) | SPRÁVNĚ (kořen) |
|---|---|---|
| FK-gap: `li_*.rule_id` vypadá jako FK na expert_rules | allowlist entry | **rename `rule_id` → `rule_key`**: je to `text` id extrakčního pravidla z impl.json (`price_mismatch`…), NE `uuid` FK na expert_rules. `_id` sufix byl zavádějící; `rule_key` je sémanticky správně a heuristika `*_id` už neflagne. |
| destructive-ops: `rm -rf /etc/netbird/*` v mesh sidecarech | baseline 29→31 bump | **strukturální rozpoznání ve `destructive-ops-survey.mjs`**: netbird self-heal cleanup v compose command bloku je bezpečný by-construction (container-scoped, konkrétní cesta, `2>/dev/null \|\| true`) — rozpozná se jako PROTECTED (jako `isMktempBackedRm`), čímž z počtu vypadnou VŠECHNY instance (cosmos/integration/core/local-ingest/potok) a baseline jde DOLŮ. |
| supabase v komentáři | přeformulovat | li-driver.ts: **0 supabase** (žádná zmínka). |

## Známé pre-existující (mimo konvergenci)
- **38 SoT souborů** má legacy `supabase` komentáře (pointery na staré `supabase/sql/` cesty)
  — pre-existující, ne zavedené touto prací. Samostatný scrub (flagnuto).

## Ověření
coldstart-db-gate 3/3 · test:gates · build:packages · tsc — vše PASS lokálně. Cíl = zelená CI.

## Otevřené follow-upy (další PR)
oauth2 edge gate (dnes app bearer tokeny), `WF_LOCAL_INGEST_SYNC` n8n (review_manifest →
knowledge_moderation_queue), KB cross-export dedup (source_hash → p_id), netbird bootstrap
enroll pro 2 nové peery, legacy supabase-komentář scrub (38 souborů).
