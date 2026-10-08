# Další public preview — co integrovat a připravit (předávka 2026-10-08)

> **Pro koho:** kolega, který dotahuje další veřejný preview (public alpha preview 7, verze
> `0.9.0-alpha.4`). **Postup vydání** je v [PUBLIC_PREVIEW.md](PUBLIC_PREVIEW.md); tenhle
> dokument říká, CO do něj ještě musí doputovat, v jakém pořadí a co musí rozhodnout vlastník.

## 1. Stav větví

| Větev / PR | Obsah | Stav |
|---|---|---|
| `main` @ `0750512` | preview 6 + PR #1 (build bez vlastního npm) + PR #2 (SQL opravy, zelená `test:db`) | základ |
| PR #3 `codex/kickoff-preparation-2026-10-08` | WIP kickoff checkpoint, 1 103 souborů: SQL/story/IDE konvergence, MCP znalosti a návrhy schopností, runner, správa poskytovatelů, GPU lane | **nehotové** — vlastní předávka [KICKOFF_PREPARATION.md](https://github.com/evymo/aisha-orchestrator/blob/codex/kickoff-preparation-2026-10-08/docs/release/KICKOFF_PREPARATION.md), 21 neprošlých souborů bran |
| `claude/jolly-bardeen-ov84ul` (tato větev) | (a) připojovací endpointy z konfigurace s výchozím `localhost`, (b) veřejný kód bez privátní forge — CI spustitelné lokálně / GitHub Actions, (c) opravy lokálního stacku nalezené jeho skutečným spuštěním | viz §5 |

## 2. Doporučené pořadí integrace

1. **Dokončit PR #3** podle jeho předávky (DB typy přes `npm run db:types:refresh:throwaway`,
   plné běhy `test:run`, `test:services`, obě dráhy bran, opravit 21 bran — ne povolit).
2. **Začlenit tuto větev** (merge, ne rebase). Známé konflikty proti PR #3:
   - `.mcp.json` — PR #3 má `"url": "${AISHA_MCP_URL}"` + blok `oauth` (`aisha-mcp-client`,
     `callbackPort`), tato větev `${AISHA_MCP_URL:-http://localhost:3001/functions/v1/mcp-knowledge-server}`.
     **Spojit obojí**: výchozí lokální URL (bez ní Claude Code `.mcp.json` odmítne, když proměnná
     chybí) + OAuth blok z PR #3. Claude plugin backend (`extensions/aisha-dirigent-claude/server/backend.mjs`)
     už `${VAR:-default}` rozvíjí.
   - `.env.aisha.example` — PR #3 vysvětluje přihlášení přes OAuth a `AISHA_TOKEN` pro stroje;
     tato větev dává `AISHA_MCP_URL` s výchozím localhost a GitHub místo privátní forge. Ponechat
     text z PR #3, hodnotu `AISHA_MCP_URL` z této větve.
   - Odstranění privátní forge sahá do ~270 souborů; po merge PR #3 přeměřit
     zbylé odkazy na privátní forge (`git grep -in` na její jméno) — PR #3 mění v jejím adresáři workflow
     `supply-chain.yml` a `obrazy-jdou-stahnout.yml`; jejich změny přenést do `.github/workflows/`.
3. **Pak teprve vydání** (§4).

## 3. Rozhodnutí vlastníka (blokují preview)

1. **CI na veřejném GitHubu — zapnout Actions?** Pokyn vlastníka (2026-10-08): privátní forge
   **nesmí být součástí veřejného kódu** a testy musí zůstat použitelné obecně. Tato větev proto
   přesunula workflow do `.github/workflows/` (nativní GitHub Actions, hostované runnery, instanční
   dráhy opt-in přes proměnné repa) a `config/public-snapshot.exclude` je **už nevyřazuje** —
   snapshot nese CI a všechny dráhy jdou spustit i lokálně (`CONTRIBUTING.md`, „Running the CI lanes
   locally"; husky hooky = totéž co CI). Zbývá rozhodnout:
   - zapnout Actions ve veřejném repu? Blokuje to **soukromý submodul `packages/extranet-sdk`**
     (`evymo/aisha-extranet-sdk`): `scripts/ci/npm-ci.sh` ho inicializuje a s `GITHUB_TOKEN`
     veřejného repa se nenaklonuje → CI padne na instalaci. Buď SDK zveřejnit (větev
     `bez-brandu-instanci` je bez značek instancí), nebo checkout s tokenem;
   - proměnné repa (`APP_NAME_PREFIX`, `VERDACCIO_URL`, `KIOSK_REGISTRY_REPO`,
     `DEPS_UPDATE_SCHEDULED`, `HEAVY_LANE_NIGHTLY`) ve veřejném repu nechat prázdné.
2. **Cílové repo.** Tohle repo má od PR #1–#3 pull-request refy (`git ls-remote origin 'refs/pull/*'`).
   Podle [PUBLIC_PREVIEW.md](PUBLIC_PREVIEW.md#a-repository-that-ever-had-pull-requests-keeps-their-history)
   ho **nelze přepnout na public** a `release:public-snapshot --push` ho odmítne (exit 3).
   Preview 7 patří do repa bez PR refů (smazat a znovu založit / nové repo) — akce vlastníka.
3. **Pull-through cache obrazů.** Domov `REGISTRY_PROXY` v `config/image-versions.env` je teď
   lokální cache `localhost:5001/` (registry stack z repa) místo cache upstream instance
   (rozhodnutí 2026-09-14 mířilo na ni). Produkce musí `REGISTRY_PROXY=cache.<doména>/` deklarovat
   v `.env-prod-backup` — jinak cold-start stahuje přes localhost a selže nahlas.
4. **Obsah instance v UI.** Kontaktní e-maily upstream instance v `src/components/layout/Footer.tsx`,
   `src/components/sections/CTASection.tsx`, `src/pages/GettingStarted.tsx` — obsah, ne endpoint;
   přesunout do brandingu/overlaye? Bundle ID mobilní aplikace a texty store listingu taktéž
   (`mobile-app/version.json`, `mobile-app/store/`).

## 4. Checklist preview 7

- [ ] PR #3 dokončený a sloučený; tato větev sloučená; `main` zelená na plné sadě
      (`npm run test:stack:full` = typecheck, lint, brány, `validate:static`, i18n, unit, služby, build)
      + `npm run test:db`.
- [ ] Rozhodnutí §3.1–§3.2.
- [ ] Verze `0.9.0-alpha.4` (`package.json`, lockfile, README hlavička), README čísla „Measured on
      the snapshot commit" přeměřit, záznam do „Preview log".
- [ ] `gitleaks dir . --config .gitleaks.toml` — projít každý nález.
- [ ] `npm run release:public-snapshot -- --source <commit> --label "public alpha preview 7" --dry-run`.
- [ ] Submoduly (`insight`, `potok`, `local-ingest`, `extranet-sdk`): veřejné snapshoty a pointery.
- [ ] Push do repa bez PR refů, ověření z čistého klonu podle PUBLIC_PREVIEW.md (vč. `npm ci`,
      `npm run build:packages`, `scripts/local-warmup.sh`).

## 5. Lokální stack — co se ověřilo a opravilo (tato větev)

Spuštěno `scripts/local-warmup.sh --apps core,keycloak,ai-chat,orchestration,messaging,observability,integration,openclaw --seed-profile template`.
Výsledek na běžícím stacku:

- gateway `/health` 200; PostgREST přes gateway (`/rest/v1/rpc/get_translations`) 200 s daty seedu;
- `/.well-known/app-config.json` vrací `aisha_url`, `mcp_url`, `keycloak_url`, `web_url` na localhost;
- Keycloak OIDC discovery `http://127.0.0.1:8180/realms/aisha` 200;
- MCP přes `http://localhost:3001/functions/v1/mcp-knowledge-server`: bez tokenu 401; s tokenem
  povoleného klienta `aisha-dirigent-device` `initialize` 200, `tools/list` 16 nástrojů, `tools/call` OK;
- web SPA `:8083` 200; migrace + seed (`template` → platforma) exit 0.

**Znovu ověřeno po sloučení odstranění privátní forge** (gateway, migrate, n8n init/uzly přestavěné,
compose přegenerovaný): totéž zelené + migrace na EXISTUJÍCÍ DB zkonvergovala CHECK zdroje událostí
na `git_webhook`; n8n bootstrap `success` — vlastník, API klíč, 9 pověření, 94 workflowů (72 aktivních,
0 selhání); publikace pluginů 4/4. Až teprve tady se ukázalo, že n8n init lokálně **nikdy nedoběhl**
(první běh ho počítal jako „běží" — čekal na hostitele, který neexistoval).

Opravené vady lokálního stacku (každá shodila část stacku): build secrets v generátoru; mesh routa
v entrypointech (lokálně není NetBird); `AISHA_SEED_PROFILE` nedocházel do migrate + seed se psal
do read-only `aisha/db` + profil `template` neznámý; `svc-plugin-system` bez `KEYCLOAK_URL/REALM`
v compose (**i produkce**); n8n DB host `aisha-db`; neplatný klíč Langfuse v3; Keycloak bez host
portu; `KC_CONTAINER`/porty/realm s literálem `aisha-*` místo identity; gateway bez `PUBLIC_URL`;
generátor zahazoval síťové aliasy deklarované ve zdroji (n8n init neviděl `<prefix>-n8n`); e-mail
vlastníka n8n bez tečky v doméně (n8n ho odmítne — a bootstrap to hlásil jako „vlastník už existuje");
`API_UPSTREAM_MESH` lokálně na jméno, které v síti není; `RABBITMQ_HOST` zastaralý literál; `env.mjs`
vyžadoval `COOLIFY_URL` při importu → doručení workflowů padalo; publikace pluginů padala na
přechodném PGRST002 po migraci.

**Změna s dopadem na produkci (ověřit na nasazení):** alias `<prefix>-n8n--main` — cíl mesh trasy
5678 — nesl `n8n-worker`, ne hlavní `n8n`; přesunut na hlavní službu (`docker-compose.coolify-n8n.yml`).

**Třetí kolo (po restartu hostitele):** DB po nečistém vypnutí zůstala `unhealthy` (re-applier hesel
čekal jen 60 s) → čeká, dokud postmaster žije. `stack-health.sh --local` měřil starý stack (porty
5173/8080, jména `aisha-*`) → čte `.env.local.dev`. Synapse: `matrix-config-init` nedostával
`KEYCLOAK_REALM` (issuer `…/realms/` — **i produkce**) a Synapse dělal discovery → `discover: false`
s explicitními endpointy z compose; varování generátoru o discovery spotřebitelích nic nenacházelo.
n8n/OpenClaw volaly API na `https://api.<LOCAL_TLD>` → generátor ho lokálně přepíše na mesh jméno API.
Výsledek: Synapse, svc-matrix, Element Call healthy; n8n → API 200; ověření 56 kontrol. Element Web
v tomhle sandboxu padá na chybějící IPv6 (`listen [::]:80`) — omezení prostředí.

Známé, neopravené (kandidáti na samostatné úkoly):

- **Langfuse a OpenClaw** lokálně nedokončí přihlášení (server-side OIDC discovery) —
  [LOCAL_WARMUP_OIDC_SUPPORT.md](../LOCAL_WARMUP_OIDC_SUPPORT.md); generátor to teď hlásí.
- **Synapse:** startuje a nabízí SSO; celé přihlášení v prohlížeči ale potřebuje dosažitelný
  `public_baseurl` (`https://…`) — lokálně bez Traefiku ne.
- **OpenClaw → `POST /mcp`** dojde na gateway, ale ta vrací 404 — ověřit, kam má `/mcp` v produkci vést.
- **Produkce:** blok gateway v compose nepředává `KEYCLOAK_DOMAIN_PUBLIC` ani `APP_CONFIG_*` →
  `keycloak_url` v app-config bude prázdný; ověřit na nasazené instanci.
- **maestro** `/health/ready` = 503 při plném CPU (necitlivý `cpu_checker` shodí celkový stav).
- **Admin stack** (Appsmith 5,6 GB, NocoDB) v tomto běhu nespuštěn kvůli místu na disku.

Navazující úkoly z odstranění privátní forge:

- **Podepisování kontejnerů** (`.github/workflows/container-signing.yml`, cosign atestace SBOM) v tomhle
  stromu nikdy nebylo — `config/public-snapshot.exclude` ho uvádí, aby brány `sbom-coverage`,
  `owasp-orchestrator-adoption` a `static-defense-in-depth` hlásily NEZMĚŘENO s důvodem místo pádu.
  Přenést jako opt-in dráhu GitHub Actions (cosign keyless přes OIDC) a řádek z exclude smazat.
- Archiv `trash/legacy-archive/edge-functions-reference/` (nespouštěný referenční kód, z něhož čtou
  kontraktní testy) je převedený na GitHub REST API (`admin_github_git`, dev-patch, drift workflow) —
  neověřený proti živému GitHubu; živá služba `svc-mcp-knowledge` admin nástroje zatím neregistruje.

Omezení prostředí, ve kterém se ověřovalo (nejsou to vady repa): odchozí TLS přes proxy s vlastní
CA (základní obrazy dočasně s CA), limit Docker Hubu (mirror), `nofile` 20 000 (ClickHouse chce
262 144 — lokální override), ~40 GB disku.
