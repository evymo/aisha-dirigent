# CI/CD Pipeline

## Architektura

```
┌─────────────────────────────────────────────────────────────────┐
│        GitHub Actions — .github/workflows/ci.yml                │
│        Runner: GitHub-hosted ubuntu-latest (Docker uvnitř)      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  🔍 detect  ──┬──► 🧪 check (TypeScript, Lint, i18n)            │
│  (changes)   │                                                   │
│              ├──► 🧪 test (Unit, Gates, Scripts, Services, DB)  │
│              │                                                   │
│              ├──► 🏗️ build (Vite production build)              │
│              │                                                   │
│              ├──► ⚖️ PR: verdikt (jediná povinná kontrola)       │
│              │                                                   │
│              └──► 🚀 deploy (Coolify API, OPT-IN)               │
│                       └─► Coolify builds + deploys              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

Pipeline nepotřebuje žádnou soukromou infrastrukturu: oficiální akce
(`actions/checkout@v4`, `actions/setup-node@v4`, …), výchozí npm registr
(`@aisha/*` jsou workspaces stavěné ze zdroje), obrazy z Docker Hubu přímo nebo
přes volitelnou pull-through cache (`vars.REGISTRY_PROXY`).

## Smart Routing

Úloha `detect` volá směrovač `scripts/ci/zmenene-cesty.sh` (týž, který používá
pre-push hook) a `scripts/aisha-changed-apps.mjs` (které appky se změna týká).
Joby, kterých se změna netýká, se přeskočí:

| Změna | check | test | build | deploy (opt-in) |
|-------|-------|------|-------|--------|
| Jen docs | skip | skip | skip | skip |
| SQL / DB | governance + cold-start DB | ✅ | dle dotčených appek | dotčené appky |
| Kód webu | ✅ | ✅ | ✅ | edge / core |
| Služba | — | Services: Tests | — | její stack |
| `.github/workflows/` | ✅ (ci_change) | ✅ | ✅ | — |

## Opt-in nasazení

Deploy/provision úlohy (`deploy-*`, `provision-*`) běží jen na push do `main`
v repu, které deklaruje instanci — **proměnná repozitáře `APP_NAME_PREFIX`**.
Veřejný klon ani fork bez ní nenasazuje nic (úlohy se ukážou jako přeskočené).
Totéž platí pro ruční `deploy.yml`, `staging-deploy.yml` a `onboard-server.yml`
(bez instance jen vypíší, co nastavit).

Nastavení: **Settings → Secrets and variables → Actions**

| Jméno | Druh | Popis | Povinné |
|-------|------|-------|---------|
| `APP_NAME_PREFIX` | variable | Identita instance = prefix jmen Coolify aplikací; zároveň přepínač nasazení | pro nasazení |
| `COOLIFY_URL` | secret | Adresa Coolify API | pro nasazení |
| `COOLIFY_API_TOKEN` | secret | Token Coolify API | pro nasazení |
| `GIT_TOKEN` | secret | Čtení privátních rep instance (overlay cachebust, brány nad overlayem, mobilní build) | ❌ |
| `DEPLOY_HEALTH_URL_*`, `DEPLOY_VERIFY_URL_*` | secret | Sondy „odpovídá to?" a „změnil se obsah?" po nasazení | ❌ |
| `REGISTRY_PROXY` | variable | Pull-through cache Docker Hubu (`<host>/`) | ❌ |
| `VERDACCIO_URL` (+ `VERDACCIO_*` secrets) | variable | Privátní npm registr pro publikaci `@aisha/*` a n8n nodů | ❌ |

Úplný seznam (co CI čte a odkud se to bere) vede `scripts/lib/ci-kontrakt.mjs`;
`node scripts/lib/ci-kontrakt.mjs --repo <vlastník>/<repo>` (s `GITHUB_TOKEN`)
změří, co repo opravdu má.

## Deploy strategie

```
push to main → CI (testy zelené) → deploy-and-verify.sh → Coolify API (POST /deploy)
             → čeká na terminální stav → ověří revizi a obsah artefaktu
```

`scripts/ci/deploy-and-verify.sh` nasazuje jednu appku a nahlas říká, co
dokázal a co ne; `scripts/ci/nasad-podle-vln.sh` nasazuje dotčené stacky ve
vlnách (pořadí z `scripts/aisha-redeploy.mjs`).

### DB Migrace

Migraci jádra provádí služba `migrate` uvnitř stacku (`docker-compose.coolify.yml`);
dokončený deployment je důkazem migrace. Druhý, volitelný kanál je krok
„DB migrate" v ruční `deploy.yml` (s `AISHA_DB_URL`).

## Pipeline Stages

### 1. 🔍 Detect Changes
- `scripts/ci/zmenene-cesty.sh` (příznaky `app`, `db_change`, `services_change`, …)
- `scripts/aisha-changed-apps.mjs` (`deploy_apps`)
- `already_verified`: merge, jehož strom už CI změřila (zelený `PR: verdikt` na hlavě PR), testy nepřehrává

### 2. 🧪 Check
- TypeScript: `npx tsc --noEmit -p tsconfig.app.json`
- ESLint: `npm run lint`
- i18n: `npm run i18n:check`

### 3. 🧪 Test
- Unit testy: `npm run test:run` (8 shardů)
- Gate testy: `npm run test:gates`
- Skripty: `npm run test:scripts`
- Služby, povrchy, DB runtime (throwaway Postgres v Dockeru), AV a blockchain integrace

### 4. 🏗️ Build
- Production build: `npm run build`

### 5. ⚖️ PR: verdikt
- Jediná kontrola, na které visí slití do `main`; `skipped` je v pořádku, `failure`/`cancelled` ne

### 6. 🚀 Deploy (opt-in)
- Viz výše; jen push do `main` s `APP_NAME_PREFIX`

## Soubory

| Soubor | Účel |
|--------|------|
| `.github/workflows/ci.yml` | CI/CD pipeline (push/PR) |
| `.github/workflows/supply-chain.yml` | npm audit, OSV, SBOM, Trivy (ručně; noční běh opt-in `HEAVY_LANE_NIGHTLY`) |
| `.github/workflows/deploy.yml` | Ruční nasazení stacku (opt-in) |
| `.github/workflows/staging-deploy.yml` | Staging (opt-in) |
| `.github/workflows/aisha-packages-publish.yml` | Publikace `@aisha/*` (opt-in `VERDACCIO_URL`) |
| `.github/workflows/aisha-deps-update.yml` | Aktualizace závislostí (cron opt-in `DEPS_UPDATE_SCHEDULED`) |
| `scripts/ci/` | Sdílené kroky CI (směrovač, deploy-and-verify, stráže) |

## Lokálně, bez forge

Každá dráha je npm skript nebo skript repa — tabulka příkazů je v
[CONTRIBUTING.md › Running the CI lanes locally](../../CONTRIBUTING.md#running-the-ci-lanes-locally).
Workflow soubory ověří `actionlint`; celý workflow jde přehrát přes `act`.

## Manuální operace

### Trigger deploy

```bash
# Deploy se spouští automaticky při push na main (s APP_NAME_PREFIX).
# Ručně:
gh workflow run deploy.yml -f stack=core
# nebo bez CI vůbec:
node scripts/aisha-redeploy.mjs --only=<app>
```

### Rollback

```bash
# Coolify UI: vybrat předchozí deployment a kliknout "Redeploy"
# Nebo revert commit a push → CI spustí nový deploy
```

## Troubleshooting

### CI joby selhávají

1. Log běhu: GitHub → Actions → běh → job (nebo `gh run view <id> --log-failed`)
2. Pád `Web: Tests` zapíše diagnostiku do PR (komentář) nebo do issue na `main`
3. Lokální reprodukce: příkaz z tabulky v CONTRIBUTING.md

### Deploy úlohy se přeskakují

Repo nedeklaruje instanci — nastav proměnnou `APP_NAME_PREFIX` (a secrety
`COOLIFY_URL`, `COOLIFY_API_TOKEN`).

### "Argument list too long"

`proc_open(): posix_spawn() failed: Argument list too long` — Coolify base64-encoduje
celý compose do SSH argumentu; ~47KB base64 (35KB compose, 18 služeb) přesáhlo OS
ARG_MAX limit. Hlídá to brána velikosti compose v `coolify-compose-compliance.gate.test.ts`.

Coolify builduje z `docker-compose.coolify.yml` (velký) místo menšího compose.
**Řešení:** V Coolify UI změnit Docker Compose file na menší compose stacku.
