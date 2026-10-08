# LOCAL_BRINGUP.md — Rozchození celého stacku lokálně (s <instance> governance)

> **Cíl:** rozjet celý AISHA stack na svém Macu tak, aby session byla **Dirigent-governed naší <instance> story** (ruleset `aisha-*` + `<instance>-*`). Ověřeno proti repu 2026-07-16 (po upstream mergi; statické checky prošly).
> **Master stav:** [../planning/ONR_PROJECT_STATE.md](../planning/ONR_PROJECT_STATE.md) · **Governance detail:** [<instance>_STORY.md](<instance>_STORY.md) · **Obecný dev stack:** [../DEV_STACK.md](../DEV_STACK.md)

---

## 0. TL;DR

> **Docker BĚŽÍ** (Docker Desktop v29.5.3, Compose v5.1.4). Pozor jen: neinteraktivní/non-login shelly nemusí mít `docker` na PATH — pak plná cesta `/Applications/Docker.app/Contents/Resources/bin/docker` nebo login shell (`zsh -lc '…'`).
>
> **IZOLACE (zásada):** náš lokální stack = **compose projekt `aisha-local`** — per-IMPLEMENTACE (SoT `scripts/lib/local-stack-name.mjs`, override `AISHA_LOCAL_STACK`). Testujeme **jednu jedinou instanci dané implementace** — nikdy druhou; jiné implementace (např. evymo = `aisha-local`) mají své projekty a **nesaháme na ně** (images sdílíme, kontejnery/volumes/sítě ne). Všechny docker operace scopovat na `aisha-local`; **žádné globální** `docker stop/rm/prune`. `local-warmup … --down` dělá `down -v` scoped jen na náš projekt. Pozn.: host **porty** (54322, 3001…) zůstávají sdílené → naráz smí BĚŽET jen jedna implementace lokálně; zastavené stacky koexistují bez kolize.

```bash
nvm use                       # Node 22 (.nvmrc)
npm install                   # nebo bun install

# 1) celý stack + seed profil FULL (klíč: NE dev, NE instance — jinak se <instance> ruleset nenaváže)
AISHA_SEED_PROFILE=full bash scripts/local-warmup.sh --preset optimum --seed-profile full --wait

# 2) ověř, že se <instance> ruleset navázal (NE „SKIPPED"):
export AISHA_LOCAL_DB_URL=postgresql://postgres:dev_postgres_password@127.0.0.1:54322/postgres
npm run db:status:local

# 3) (volitelně) plná <instance> self-management KB lokálně + embeddingy + gen:ide — viz §4–§6
```

**Proč `full` a ne `dev`:** `dev:stack` defaultuje na `--seed-profile dev`, který **neobsahuje ani `aisha-*` (demo vrstva) ani `<instance>-*` (instance vrstva)** → nula governance pravidel. `instance` profil sám obsahuje `<instance>-*`, ale **ne** `aisha-*` → <instance> ruleset binding se hlásí `SKIPPED` (guard `aisha-* >= 15`) a gen:ide spadne na `is_default` fallback. **`full` = core + translations + implementations/aisha + instance + demo** = jediný profil, který v jednom průchodu naseeduje oba layery a ruleset se naváže. (Ověřeno: `compile-seed --dry-run --profile full` = 66 souborů vč. `private-instance/` i `demo/`.)

---

## 1. Prerekvizity

| Co | Detail | Stav |
|----|--------|------|
| **Node 22** | `.nvmrc` = 22 | ✅ (stroj má v22.23.1) |
| **Docker** | Docker Desktop **v29.5.3**, Compose **v5.1.4**, daemon běží. Non-login shell nemá `docker` na PATH → plná cesta `/Applications/Docker.app/Contents/Resources/bin/docker`. | ✅ **BĚŽÍ** |
| **RAM/disk** | `optimum` preset ~25 kontejnerů (8 GB), `full-light` ~43, `full` 16+ GB. Pozor: stroj už hostí desítky kontejnerů jiných implementací — hlídej volnou RAM. | dle presetu |
| **Env** | Lokál **negeneruje ručně** — `local-warmup.sh` vytvoří `.env.local.dev` (160+ proměnných vč. dev JWT/ANON_KEY/hesla) z `config/local-presets.mjs`. Root `.env` jen pro externí API klíče (OPENAI/ANTHROPIC/… — volitelné). | auto |

> **macOS pozn.:** `timeout` (GNU) na macu není — pokud ho skript potřebuje, `brew install coreutils` (dá `gtimeout`).

### 1a. Izolace — jedna instance implementace, cizí projekty nerušit

- Náš stack = compose projekt **`aisha-local`** — per-implementace, **NE per-worktree** (jinak by každý checkout = nová instance). SoT: `scripts/lib/local-stack-name.mjs` (default `aisha-local`, override env `AISHA_LOCAL_STACK`; shell skripty duplikují default — parity hlídá gate `local-container-namespacing`). Z názvu se odvozuje: project name, síť, prefix kontejnerů i volumes (`aisha-local__*`).
- **Ověřeno end-to-end** (2026-07-16, po mergi): vygenerovaný compose (preset optimum) = projekt `aisha-local`, 32/32 kontejnerů s prefixem `aisha-local__`, 0 výskytů `aisha-local` → **žádná kolize** s evymo lokálním stackem.
- Scoped stav našeho stacku:
  ```bash
  DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
  "$DOCKER" ps -a --filter label=com.docker.compose.project=aisha-local --format '{{.Names}}\t{{.Status}}'
  ```
- **Nikdy** globální `docker stop/rm/prune`; jen scoped operace (přes `-f docker-compose.local.generated.json`, který nese `name: aisha-local`).
- Host **porty** jsou sdílené napříč implementacemi → před spuštěním našeho stacku musí být cizí lokální stack ZASTAVENÝ (evymo aktuálně zastavený je), jinak port clash. Zastavené stacky vedle sebe nevadí.

---

## 2. Dvě cesty

| | **Option A — host DB-only** | **Option B — celý docker stack** |
|--|-----------------------------|----------------------------------|
| Co běží | jen Postgres (57422) + host skripty | ~25 kontejnerů (web, gateway, PostgREST, n8n, mcp-knowledge, appsmith, langfuse…) na 54322/3001 |
| K čemu | rychlá governance + gen:ide, bez UI | **„celé lokálně"** — UI, služby, embed kickstart |
| Embed kickstart | ❌ (svc-mcp-knowledge není up) | ✅ |

Pro cíl „rozchodit celé" jdi **Option B** (§3). Option A je zkrácená varianta, když chceš jen governance/gen:ide.

---

## 3. Option B — celý stack (doporučeno)

```bash
# migrate container se seeduje sám; pin profil na full, jinak dostaneš dev (bez governance)
AISHA_SEED_PROFILE=full bash scripts/local-warmup.sh --preset optimum --seed-profile full --wait
#  interaktivně: npm run dev:stack  (POZOR: defaultuje dev — přepiš AISHA_SEED_PROFILE=full)
#  status:       npm run dev:stack:status      teardown: npm run dev:stack:down
```
Porty (lokál): DB `127.0.0.1:54322` (heslo `dev_postgres_password`), gateway `127.0.0.1:3001`, web/n8n/appsmith dle presetu. PostgREST je **interní** (host přes gateway `:3001`); pro přímý host přístup opt-in `LOCAL_EXPOSE_POSTGREST=1` + `LOCAL_POSTGREST_PORT` (dual-stack, upstream `0037355a`).

**Ověř governance binding:**
```bash
export AISHA_LOCAL_DB_URL=postgresql://postgres:dev_postgres_password@127.0.0.1:54322/postgres
npm run db:status:local
# v psql: SELECT story_id, ruleset_fingerprint, array_length(rule_ids,1)
#         FROM story_rulesets WHERE id='0db00000-0000-4000-8000-0000000000b1';
```
Chceš vidět `<instance> story ruleset bound with N rules`, **ne** `<instance> ruleset binding SKIPPED`.

> Preset gotchas: přihlášení člověka do UI Langfuse (a dashboardu LLM Gateway) na local-warmup **nedokončí login** (server-side OIDC discovery bez Traefiku); AISHA s nimi mluví přes API klíče a to funguje — viz [LOCAL_WARMUP_OIDC_SUPPORT.md](../LOCAL_WARMUP_OIDC_SUPPORT.md). OpenClaw OIDC nemá (jen bearer klíč). Pro UI použij e2e/full Traefik stack.
>
> Napojení nástrojů (Claude Code MCP, Dirigent, skripty) na běžící stack nebo jinou instanci: `npm run aisha:connect -- login`, pak v repu `init` a `validate` — viz [AISHA_CONNECT.md](../integrations/AISHA_CONNECT.md).
>
> Appsmith (Spring Boot + Mongo) startuje pomalu — pomalý Appsmith ≠ failnutý bring-up. n8n healthcheck čti na `127.0.0.1:5678/healthz` (ne `localhost` kvůli IPv6).

---

## 4. Plná <instance> self-management KB lokálně (volitelné)

`aisha/db/seed/instance/` v hlavním repu obsahuje **jen `01_<instance>_story.sql`** (story + `<instance>-*` pravidla + binding). Zbývající overlay (`02_onr_branding` stub, `03_onr_domain` stub, **`04_onr_selfmanagement_kb.sql`** = 8 story-scoped KB items + 3 pravidla + rebind) žije v **privátním repu `~/projects/<instance>-instance-data`** (aplikuje se v prod přes `AISHA_INSTANCE_DATA_GIT_URL`). Lokálně ho můžeš aplikovat přímo:

```bash
for f in ~/projects/<instance>-instance-data/0[234]_*.sql; do
  psql "$AISHA_LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done   # idempotentní; 04_ převáže ruleset se všemi aisha-* + <instance>-*
```

---

## 5. Embed kickstart (Option B) — aby KB fungovala v RAG

KB items a pravidla se vkládají jako text; vektory generuje `svc-mcp-knowledge` (service-role routes přes gateway `:3001`). Bez tohoto kroku keyword hledání funguje, sémantické ne.

```bash
TOKEN="$(grep -E '^POSTGREST_SERVICE_TOKEN=' .env.local.dev | cut -d= -f2-)"
for r in rules knowledge; do
  curl -sS -X POST "http://127.0.0.1:3001/functions/v1/mcp-knowledge-server/embeddings/$r" \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"force":true}'
done
```

---

## 6. gen:ide — story-scoped CLAUDE.md

`gen:ide` je **online-only** (POST `get_instruction_payload` na PostgREST; není read-from-local-DB cesta). Story id čte z `.aisha/story.json` (`…0001` ✅). Backend z `.aisha/dirigent.json` (`activeProfile=id3a` → prod) — pro **lokální** governance přesměruj na lokální PostgREST:

```bash
# proti LOKÁLNÍMU stacku (Option B běží):
AISHA_POSTGREST_URL=http://127.0.0.1:3001 AISHA_POSTGREST_SERVICE_KEY="$TOKEN" \
  npm run gen:ide -- --all --save-payload
# nebo proti prod id3a backendu (netřeba lokální docker, jen service key z Coolify):
AISHA_POSTGREST_SERVICE_KEY=<coolify-service-key> npm run gen:ide -- --all --save-payload
```
Ověř: hlavička payloadu / CLAUDE.md má `scope: "story"` (ne fallback) a CLAUDE.md obsahuje `<instance>-*` pravidla.

MCP `aisha-knowledge` (runtime KB nástroje) vyžaduje jednorázový Keycloak OAuth přes `/mcp` v interaktivní session — gen:ide/seed na něm nezávisí.

---

## 7. Co lze ověřit BEZ Dockeru (statické de-risk checky)

| Příkaz | Co ověří | Stav 2026-07-02 |
|--------|----------|-----------------|
| `node scripts/lib/derive-domains.mjs --check` | topology (service catalog + profily) | ✅ `topology valid, 19 services` |
| `node scripts/db/compile-seed.mjs --dry-run --profile full --implementation aisha` | seed pipeline složí oba layery | ✅ 66 souborů (private-instance + demo) |
| `npm run type-check` | celý TS projekt typuje | ✅ čisté |
| `npm run test:gates` | offline gate suita | ✅ 361/362 souborů (5621 testů) |
| `node scripts/aisha-env-doctor.mjs --dry-run` | env kontrakt (statická parse compose) | ✅ běží |
| `bash scripts/cold-start-doctor.sh --phase A,B,E --no-network` | preflight statické fáze | ✅ (Phase D degraduje na warn bez dockeru) |

**Nelze bez Dockeru:** `local-compose-gen.mjs` (volá `docker compose config`), tedy i `dev:stack`/`local-warmup`; `db:migrate:local`/`db:seed:local` (potřebují DB kontejner); embed kickstart; `gen:ide` fetch (potřebuje běžící backend). `gen:ide --offline` potřebuje dřív jednou `--save-payload` online.

---

## 8. První-failure body (dle cold-start doctoru)

- **Port clash s jinou implementací** → cizí lokální stack (např. evymo `aisha-local`) musí být ZASTAVENÝ, než náš `aisha-local` spustíš (§1a). Na cizí stack NESAHAT — zastavení je krok uživatele.
- **`docker` není na PATH** (non-login shell) → plná cesta `/Applications/Docker.app/Contents/Resources/bin/docker`. Daemon musí běžet.
- **Málo RAM** pro zvolený preset → kontejnery OOM. Sniž preset (`optimum`) nebo zvyš runtime RAM.
- **Seed profil `dev`/`instance` místo `full`** → prázdná/degradovaná governance (viz §0).
- **Docker network exhaustion** při opakovaných bring-upech → `scripts/fix-docker-network-pools.sh`.
- **Kříž DB portů** (57422 e2e vs 54322 warmup) → nastav `AISHA_LOCAL_DB_URL` explicitně na 54322.
- **`partner_profiles` FK** (autor `<instance>-*` pravidel) na prázdné DB → NOTICE-skip; `full` seed ho založí (`demo/00_prod_users.sql`), re-run zhojí (idempotentní).
