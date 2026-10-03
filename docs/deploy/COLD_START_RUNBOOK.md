# AISHA Cold-Start Runbook

> Operational runbook pro fresh deployment AISHA platformy na Coolify cluster.
> Coverage: produkční cold-start, lokální dev warmup, troubleshooting známých
> failure modů, recovery scénáře.

## Obsah

- [Architektura ve zkratce](#architektura-ve-zkratce)
- [Pre-flight checklist](#pre-flight-checklist)
- [Produkční cold-start (Coolify)](#produkční-cold-start-coolify)
- [Lokální dev warmup](#lokální-dev-warmup)
- [Troubleshooting](#troubleshooting)
- [Recovery scénáře](#recovery-scénáře)
- [Tunable parameters](#tunable-parameters)

---

## Architektura ve zkratce

13 stacků na 3 serverech:

| Server | Role | Apps |
|---|---|---|
| **Frontend** | public edge (Traefik, TLS) | registry, edge, netbird |
| **Backend** | backend (DB, identity, integrace) | core, keycloak, pki, orchestration, messaging, observability, admin, integration |
| **Experimental** | execution + ledger | ledger, exec |

**Single source of truth pro deployment**: [coolify/manifests/aisha.manifest](../../coolify/manifests/aisha.manifest)

**Wave deploy pořadí** (z `aisha-redeploy.mjs`):
1. registry
2. core, pki, edge (parallel)
3. keycloak (gates: core)
4. netbird, observability, orchestration, admin (gates: core+keycloak)
5. integration, ledger, exec (soft gates)
6. messaging — `KNOWN_BROKEN` dokud nespustíš [Docker pool fix](#known-broken-aisha-messaging)

---

## Pre-flight checklist

**Před každým cold-startem** spusť:

```bash
bash scripts/cold-start-doctor.sh
```

Doctor validuje 7 fází:
- A. Environment vars (FORGEJO_TOKEN, COOLIFY_API_KEY, server UUIDs)
- B. Files (manifest, scripts, infra/postgres)
- C. Env contract (.env.coolify completeness)
- D. Compose interpolation (preflight-compose.sh)
- E. Manifest ↔ compose consistency (13/13 refs)
- F. Coolify API connectivity
- G. Forgejo connectivity

**Exit kódy**: `0` ready / `1` fatal / `2` warn-only.

Doctor je integrovaný jako step 0 v `aisha-cold-start.sh` — můžeš ho samostatně přeskočit přes `--skip-doctor`, ale **nedoporučuje se**.

---

## Produkční cold-start (Coolify)

### Předpoklady

```bash
# Required env vars (v .env-prod-backup nebo exportované):
COOLIFY_API_TOKEN=<token>          # alias: COOLIFY_API_KEY
FORGEJO_API_TOKEN=<token>          # alias: FORGEJO_TOKEN
COOLIFY_SERVER_UUID_FRONTEND=<uuid>   # default: rwskgw088gkcc0k4gg40sw4c
COOLIFY_SERVER_UUID_BACKEND=<uuid>
COOLIFY_SERVER_UUID_EXPERIMENTAL=<uuid>
```

Plus `config/domains.env` musí existovat (zone-specific domain mapping).

### Spuštění

```bash
# Standard cold-start (s preflight)
bash scripts/aisha-cold-start.sh

# Wipe + cold-start (DESTRUKTIVNÍ — smaže existující apps)
bash scripts/aisha-cold-start.sh --wipe

# Apps už existují, jen redeploy
bash scripts/aisha-cold-start.sh --skip-create

# Dry-run plan
bash scripts/aisha-cold-start.sh --dry-run
```

### 7 kroků (orchestrační flow)

| Step | Co dělá | Failure mode |
|---|---|---|
| 0 | Doctor preflight (read-only validation) | Hard fail at `--skip-doctor`-able exit 1 |
| 1 | Safety check (no AISHA apps exist) | Hard fail unless `--wipe` |
| 2 | Generate fresh secrets → `.env.coolify` | Hard fail if `.env-prod-backup` missing |
| 2b | Compose interpolation preflight | Hard fail on missing `${X:?}` |
| 3 | Create 13 apps in Coolify (`coolify-story-init.sh`) | Hard fail if not all 13 created |
| 4 | Set env vars per stack (`coolify-deploy-init.sh`) | Hard fail (nově) |
| 4b | Ensure `coolify` Docker network | Warn-only fallback (3-tier: local docker → SSH → manual) |
| 5 | Wave-orchestrated redeploy (`aisha-redeploy.mjs`) | Hard fail with rollback recipe |
| 6 | Bootstrap (KC realm, n8n workflows) | Hard fail (skipped if step 5 failed) |
| 7 | Summary | — |

Každý wave deploy ve step 5 vytvoří **snapshot** v `.coolify-deploy-snapshots/<run-id>-wave<N>.json`. Pokud wave selže, snapshot poskytuje deployment_uuid pro manuální rollback přes Coolify UI.

### Ověření po cold-startu

Po každém cold-startu nebo redeploy spusť nejdřív kanonické routy ze single source of truth [config/domains.env](../../config/domains.env):

```bash
npm run stack:health:prod
node scripts/cold-start-verify.mjs --skip-public-aliases
bash scripts/smoke-routing.sh --skip-public-aliases
```

Pro plný pohled včetně public aliasů přes Frontend centrální proxy spusť:

```bash
npm run cold-start:verify
bash scripts/smoke-routing.sh
```

Public aliasy `mcp.aisha.guru` a `db.aisha.guru` končí DNS/wildcard certem na Talosu, zatímco upstream služby běží na Backend. Frontend edge stack proto obsahuje `mcp-mesh-proxy` a `db-mesh-proxy`, které přes `backend.mesh.aisha.internal` předávají provoz na kanonické Backend routy. Tyto aliasy neřeš přes Backend-only Traefik labels; Frontend Traefik musí routovat na skutečný lokální proxy kontejner v `aisha-edge`. Proxy služby mají i explicitní Traefik router labels s vyšší prioritou, protože samotné Coolify `docker_compose_domains` může service names ukládat normalizovaně (`-` → `_`) a na cross-server aliasu pak snadno skončíš na `503` bez živého backend serveru.

Coolify `docker_compose_domains` drift kontroluj read-only:

```bash
npm run coolify:domains:check
```

Opravu aplikuj jen explicitně. Skript objevuje aplikace podle názvu, nepoužívá hardcodované UUID po wipe:

```bash
node scripts/coolify-domain-doctor.mjs --apply --only=orchestration
node scripts/coolify-domain-doctor.mjs --apply --only=orchestration --restart
```

`--restart` používej jen když chceš zároveň vyvolat Coolify deploy. Bez něj skript pouze PATCHne `docker_compose_domains`.

### Optional Matrix bridges

Mautrix/Postmoogle bridge kontejnery jsou volitelné integrace. Bez provider-specific secrets nesmí shazovat základní messaging stack. Compose je proto drží za profiles:

```bash
# default po cold-startu: žádné optional bridge kontejnery
COMPOSE_PROFILES=

# telegram se zapne automaticky, pokud existují TELEGRAM_API_ID + TELEGRAM_API_HASH,
# nebo ručně přes explicitní profil list:
MATRIX_BRIDGE_PROFILES=bridge-telegram,bridge-whatsapp
```

`coolify-deploy-init.sh --stack messaging` synchronizuje `MATRIX_BRIDGE_PROFILES` do Coolify `COMPOSE_PROFILES`. Pokud nejsou vyplněné provider vars, Synapse, Element Web a Element Call zůstávají zdravé a bridge kontejnery se vůbec nespouští. Teprve po doplnění credentials spusť:

```bash
bash scripts/coolify-deploy-init.sh --stack messaging
node scripts/aisha-redeploy.mjs --only=messaging --wave-timeout=900
```

### OAuth proxy a ACME probes

OAuth2 Proxy log typu `No valid authentication in request. Initiating login.` je normální pro nepřihlášený prohlížeč. Pokud se v něm objeví `/.well-known/acme-challenge/...`, jde o Let's Encrypt validaci, která se dostala až k app routeru. Pro `pgadmin-auth` je nastavené `OAUTH2_PROXY_SKIP_AUTH_ROUTES=^/\.well-known/.*`, aby tyto probe requesty nespouštěly login flow a nemátly health audit. Není to samo o sobě příčina `restarting`; tu hledej v container healthchecku nebo sidecarech.

OAuth2 Proxy služby, které obsluhují současně kanonické `*.backend.id3a.cz` routy a public `*.aisha.guru` aliasy, musí mít cookie domain coverage pro obě zóny (např. `.backend.id3a.cz,.aisha.guru`). `SKIP_AUTH_ROUTES` drž konkrétní: povolené jsou health/ping, `/.well-known/.*` a explicitní veřejné endpointy jako n8n webhooks; nepoužívej široké `^/api/.*` nebo `^/api/v1/.*` bypassy.

### Agregátní `restarting`, ale služby zvenku fungují

Coolify app status je agregát všech kontejnerů ve stacku. Pokud hlavní HTTP endpointy fungují, ale app pořád hlásí `restarting`/`unhealthy`, ověř konkrétní Docker kontejnery na hostu:

```bash
ssh <backend-lan-ip> 'docker ps -a --format "{{.Names}}\t{{.Status}}" | sort'
ssh <experimental-lan-ip> 'docker ps -a --format "{{.Names}}\t{{.Status}}" | sort'
```

Známé pasti:

- NetBird sidecary nesmí bind-mountovat `./infra/netbird/agent-entrypoint.sh` jako file. Coolify při chybějícím source souboru vytvoří adresář a `/bin/sh /usr/local/bin/aisha-agent-entrypoint.sh` skončí okamžitě s exit 0. Wrapper je proto inline přímo v compose.
- NetBird runtime images nemají spolehlivý shell/wget/nc kontrakt pro Docker healthcheck. `Dockerfile.netbird-runtime` proto přidává statický BusyBox a management/signal/relay používají exec-form TCP liveness přes `/bin/busybox nc -z 127.0.0.1 <port>`.
- PostgREST image nemá shell/wget/curl a nativní `/bin/postgrest --ready` vyžaduje `server-host=localhost`, což by rozbilo interní API reachability. `Dockerfile.postgrest` proto pouze přidává statický BusyBox a healthcheck volá admin endpoint `http://127.0.0.1:3001/ready`.
- `n8n` healthcheck musí volat `http://127.0.0.1:5678/healthz`; `localhost` může v kontejneru preferovat IPv6 `::1`, kde n8n nenaslouchá.
- `matrix-rtc-auth` image je distroless bez `sh`/`wget`/`curl`; `Dockerfile.matrix-rtc-auth` proto přidává statický BusyBox a healthcheck používá exec-form TCP liveness přes `/bin/busybox nc -z 127.0.0.1 8080`. Element Call se navíc ověřuje externím smoke testem.

---

## Lokální dev warmup

### Presets

```bash
bash scripts/local-warmup.sh           # interactive prompt
bash scripts/local-warmup.sh --preset minimum     # core only (~14 containers)
bash scripts/local-warmup.sh --preset optimum     # + keycloak/n8n/RAG (~25)
bash scripts/local-warmup.sh --preset full-light  # vše krom infra-only (~43)
bash scripts/local-warmup.sh --preset full        # vše krom netbird (~51, 16+ GB RAM)
bash scripts/local-warmup.sh --apps core,keycloak # custom selection
```

| Preset | Apps | Použití |
|---|---|---|
| **minimum** | core | DB + edge + web app |
| **optimum** | + keycloak, orchestration, integration | Backend smarts |
| **optimum-llm** | optimum + ollama | + lokální LLM |
| **full-light** | optimum + messaging, observability, admin | Plný backend, bez infra-only |
| **full** | + pki, exec, ledger, registry | Produkční mirror (vyžaduje Kata pro exec) |

### Generator pipeline

```
manifest (aisha.manifest)
   ↓
local-compose-gen.mjs --preset X
   ↓ docker compose config --format json (per app)
   ↓ transformations:
   ↓   - networks: external coolify → internal aisha-local
   ↓   - volumes: aisha_v2_X → aisha-local__X (no prod collision)
   ↓   - labels: drop coolify.* + traefik routers
   ↓   - init containers: healthcheck disable
   ↓   - host port mapping (z config/local-presets.mjs)
   ↓   - domain rewriting (https://X → http://localhost:port)
   ↓   - cross-stack dep auto-resolve
   ↓
docker-compose.local.generated.json (gitignored)
   ↓
docker compose -f docker-compose.local.generated.json up -d
```

### Tear-down

```bash
bash scripts/local-warmup.sh --down    # containers + volumes + network
bash scripts/local-warmup.sh --status  # docker compose ps
```

---

## Troubleshooting

### KNOWN BROKEN: aisha-messaging

**Symptom**: `Error: network <random-id> declared as external, but could not be found` při deploy wave 6 (messaging).

**Root cause**: Docker default `default-address-pools` (172.17.0.0/16, 256 /24 slots) vyčerpaný per-app bridge networks. Coolify vytváří jednu /24 per app UUID; po cca 250 deployech pool dochází.

**Fix**:

```bash
COOLIFY_HOST_SSH=user@frontend.id3a.cz bash scripts/fix-docker-network-pools.sh
```

Skript:
1. SSH na hostitele (vyžaduje passwordless sudo)
2. Backup `/etc/docker/daemon.json`
3. Přidá `default-address-pools` (10.30.0.0/16 + 10.40.0.0/16) → 256 → 768 slots
4. `docker network prune -f` (cleanup dangling)
5. `systemctl restart docker` (~5s downtime všech kontejnerů na hostiteli)

Po fixu odeber `aisha-messaging` z `KNOWN_BROKEN` v [scripts/aisha-redeploy.mjs](../../scripts/aisha-redeploy.mjs) a re-spusť:

```bash
node scripts/aisha-redeploy.mjs --only=messaging
```

### PKI deploy padá: "network <random-id> declared as external"

**Symptom**: PKI deploy padá na network not found error, ale `coolify` network na hostiteli existuje.

**Root cause hypotéza**: PKI app v Coolify state má cached starší compose verzi (před commit `3ec2616b` co sjednotil network names). Coolify dosadil per-project UUID místo `name: coolify`.

**Diagnose + fix**:

```bash
# Diagnose (read-only)
bash scripts/diagnose-pki-coolify.sh

# Fix (--fix mode)
bash scripts/diagnose-pki-coolify.sh --fix

# Plus host-level network check (volitelné, vyžaduje SSH)
COOLIFY_HOST_SSH=user@coolify-host bash scripts/diagnose-pki-coolify.sh
```

Manual recovery options (pokud `--fix` nepomohl):

**Option A — Delete + recreate v Coolify UI**:
1. Coolify UI → aisha-pki app → Settings → Delete
2. `bash scripts/coolify-story-init.sh --manifest coolify/manifests/aisha.manifest`
3. `bash scripts/coolify-deploy-init.sh`
4. `node scripts/aisha-redeploy.mjs --only=pki`

**Option B — Wipe**:
```bash
bash scripts/aisha-cold-start.sh --wipe   # destruktivní, ale spolehlivé
```

### Wave deploy timeout

**Symptom**: `Wave N timed out after WAVE_TIMEOUT_S seconds`

**Root cause**: Slow image pull, slow DB migration, container startup vyžaduje víc času.

**Fix**:
```bash
# Increase wave timeout (default 300s = 5 min)
AISHA_WAVE_TIMEOUT_S=900 bash scripts/aisha-cold-start.sh
# nebo per-redeploy:
node scripts/aisha-redeploy.mjs --wave-timeout=900
```

Dlouhodobá oprava: edit [config/cold-start-timeouts.env](../../config/cold-start-timeouts.env).

### Synapse: "database synapse does not exist"

**Symptom**: Synapse container v restart loop s `psycopg2.OperationalError: FATAL: database "synapse" does not exist`.

**Root cause**: PG17 init scripts (`infra/postgres/set-passwords.sh`, `entrypoint-wrapper.sh`) ne-vytvořily Synapse DB. Synapse vyžaduje vlastní DB s `LC_COLLATE=C` (ne sdílí "postgres" DB).

**Fix**: Tento problém je v repu opraven (commit 4d6fb0f2 + restore v této session). Pokud se objeví znovu:

```bash
# Verify aisha-db has synapse DB
docker exec aisha-db psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='synapse'"

# If missing: create manually
docker exec aisha-db psql -U postgres -c "CREATE DATABASE synapse OWNER synapse_user ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"

# Then restart Synapse
node scripts/aisha-redeploy.mjs --only=messaging
```

### Synapse: `DuplicateTable: relation "..." already exists`

**Symptom**: Matrix route `https://matrix.backend.id3a.cz/_matrix/client/versions` vrací 503 a debug log přes Element obsahuje `psycopg2.errors.DuplicateTable: relation "rooms" already exists` nebo podobnou ranou Synapse tabulku typu `background_updates`.

**Root cause**: Předchozí Synapse boot vytvořil část schématu (`rooms`, `background_updates`, ...) ještě před vytvořením použitelného Synapse migration markeru v `schema_version`. Další start to pak chybně považuje za prázdnou databázi a narazí na duplicitní tabulku. V Matrix stacku navíc nesmí bridge služby sdílet stejnou databázi/schema se Synapse; některé bridge migrace používají tabulku `rooms`, což umí Synapse inicializaci rozbít ještě před startem homeserveru.

**Fix v repu**: `synapse-db-init` v [docker-compose.coolify-matrix.yml](../../docker-compose.coolify-matrix.yml) detekuje stav `tables > 0 && (schema_version missing || schema_version empty)`. Zároveň čte poslední `/data/synapse-startup.log` ze `synapse-data` volume a při podpisu `DuplicateTable` databázi `synapse` před startem znovu vytvoří. Synapse wrapper má navíc bezprostřední DB preflight přes `psycopg2`, který při stejné partial-init signatuře znovu vytvoří `public` schema ještě před `/start.py`.

Homeserver tabulky běží v samostatném Postgres schema `synapse_hs` (`search_path=synapse_hs`), takže rollout není citlivý na staré bridge kontejnery, které by ještě krátce sáhly do `public`. Bridge služby (`mautrix-*`, `postmoogle`) mají vlastní databáze `synapse_bridge_*` a v Compose čekají na `synapse: service_healthy`. Nikdy je nepřipojuj zpět do databáze `synapse` ani do schema `synapse_hs`.

**Recovery**:

```bash
node scripts/cold-start-verify.mjs --skip-public-aliases
node scripts/aisha-redeploy.mjs --only=messaging
```

Po redeploy musí `cold-start-verify` hlásit `Matrix Synapse` jako 200.

### Netbird management: "NB_STORE_ENGINE_POSTGRES_DSN is not set"

**Symptom**: Netbird mgmt container fatals on startup.

**Root cause**: Netbird upstream přejmenoval env vars `NETBIRD_STORE_*` → `NB_STORE_*` mezi minor verzemi.

**Fix**: Tento problém je v repu opraven (commit v této session + image pinning na Netbird 0.30.6). Pokud se objeví po image bump:

```bash
# Pin Netbird zpět na 0.30.6 v config/image-versions.env
IMAGE_NETBIRD_MANAGEMENT=netbirdio/management:0.30.6

# Re-sync env vars to Coolify
bash scripts/coolify-sync-envs.sh

# Re-deploy
node scripts/aisha-redeploy.mjs --only=netbird
```

Před bumpem na 0.31+ ověř upstream changelog na env-var changes.

### FORGEJO_TOKEN empty → git clone 401

**Symptom**: Apps se vytvoří, ale `docker_compose_raw` zůstane null → wave deploy padá.

**Fix**: Doctor ho už chytá, ale pro jistotu:

```bash
grep "^FORGEJO_API_TOKEN=" .env-prod-backup   # musí mít hodnotu
# Pokud chybí, regeneruj v Forgejo UI → Settings → Applications → New Token
```

---

## Recovery scénáře

### Scénář 1: Cold-start uprostřed selhal, chci pokračovat

Apps už jsou vytvořené, ale některé wavy nedoběhly.

```bash
# Zjisti aktuální stav
node scripts/aisha-redeploy.mjs --status

# Pokračuj od konkrétní wave
node scripts/aisha-redeploy.mjs --from=wave3

# Nebo cold-start --skip-create
bash scripts/aisha-cold-start.sh --skip-create
```

### Scénář 2: Po deploy jeden specific app v unhealthy stavu

```bash
# Inspect ho
node scripts/aisha-redeploy.mjs --status

# Re-deploy jen jeho
node scripts/aisha-redeploy.mjs --only=<short-name>
# např. --only=keycloak,n8n
```

### Scénář 3: Chci rollback poslední wave

Coolify v4 nemá auto-rollback API. Postup:

1. Najdi snapshot: `ls -lat .coolify-deploy-snapshots/`
2. Pro každou problémovou app v snapshotu:
   - Coolify UI → app → Deployments
   - Najdi `last_deployment_uuid` z snapshotu
   - Klikni "Re-Deploy" na ten deployment

Detail snapshotu:
```bash
cat .coolify-deploy-snapshots/<run-id>-wave<N>.json | jq .
```

### Scénář 4: PKI Coolify state se rozpadl

Viz [PKI deploy padá](#pki-deploy-padá-network-random-id-declared-as-external) výš.

### Scénář 5: Kompletní disaster recovery

Restore z .env-prod-backup:

```bash
# 1. Wipe
bash scripts/aisha-cold-start.sh --wipe   # → confirm prompt

# 2. Cold-start
bash scripts/aisha-cold-start.sh
```

---

## Tunable parameters

Centralizováno v [config/cold-start-timeouts.env](../../config/cold-start-timeouts.env):

| Var | Default | Co řídí |
|---|---|---|
| `AISHA_WAVE_TIMEOUT_S` | 420 | Per-wave deploy + health wait timeout |
| `AISHA_HEALTH_POLL_S` | 10 | Polling interval pro health checks |
| `AISHA_STABLE_POLLS` | 3 | Konsekutivní polls pro accept "stable starting/unhealthy" |
| `AISHA_COOLIFY_API_TIMEOUT_S` | 30 | Curl timeout pro Coolify API |
| `AISHA_DOCTOR_API_TIMEOUT_S` | 10 | Curl timeout v doctor checks |
| `AISHA_KEYCLOAK_READY_TIMEOUT_S` | 600 | Wait pro KC readiness po deploy |
| `AISHA_N8N_READY_TIMEOUT_S` | 300 | Wait pro n8n readiness po deploy |
| `AISHA_LOCAL_HEALTH_TIMEOUT_S` | 180 | Lokální warmup health wait |

Per-environment override:
```bash
# Slow staging — 2x všechno
AISHA_WAVE_TIMEOUT_S=900 AISHA_STABLE_POLLS=6 bash scripts/aisha-cold-start.sh
```

---

## Image versions

Pinned v [config/image-versions.env](../../config/image-versions.env). Compose souborů referencují přes `${IMAGE_X:-fallback}` pattern.

Před image bumpem:
1. Audit upstream changelog
2. Test: `bash scripts/local-warmup.sh --preset full-light`
3. Update `image-versions.env` + (optional) compose fallbacks
4. Commit s odůvodněním (CVE / feature / breaking change)

Gate test [no-latest-images.gate.test.ts](../../src/tests/gates/no-latest-images.gate.test.ts) blokne PR, který znovu zavede raw `:latest`.

---

## Gate tests

Spouští se přes `npm run test:gates`. Cold-start související:

| Gate | Co testuje |
|---|---|
| `no-latest-images` | Žádný raw `:latest` v compose souborech |
| `local-warmup-idempotence` | Generator je deterministický (byte-identical output) |
| `cold-start-doctor` | Doctor skript běží, manifest ↔ compose match |
| `coolify-compose-compliance` | Init containers mají healthcheck disable, OAuth2 config |
| `coolify-env-contract` | Env vars referencované v compose mají defaults nebo `${X:?}` |
| `cold-start-hardening` | Žádné regrese v hardening checks |

---

## Quick reference

```bash
# Pre-flight
bash scripts/cold-start-doctor.sh

# Cold-start
bash scripts/aisha-cold-start.sh                       # full
bash scripts/aisha-cold-start.sh --wipe                # destructive
bash scripts/aisha-cold-start.sh --skip-create         # apps exist
bash scripts/aisha-cold-start.sh --dry-run             # plan only

# Wave-only re-deploy
node scripts/aisha-redeploy.mjs --status               # current state
node scripts/aisha-redeploy.mjs --plan                 # plan only
node scripts/aisha-redeploy.mjs --from=wave3           # from wave
node scripts/aisha-redeploy.mjs --only=keycloak,n8n    # specific apps

# Local dev
bash scripts/local-warmup.sh                            # interactive
bash scripts/local-warmup.sh --preset minimum
bash scripts/local-warmup.sh --status
bash scripts/local-warmup.sh --down

# Recovery
bash scripts/diagnose-pki-coolify.sh                   # PKI state
bash scripts/diagnose-pki-coolify.sh --fix
COOLIFY_HOST_SSH=... bash scripts/fix-docker-network-pools.sh

# Drift detection (live Coolify state vs git manifest)
node scripts/coolify-drift-check.mjs                   # report drift
node scripts/coolify-drift-check.mjs --fix-compose     # patch compose paths
node scripts/coolify-drift-check.mjs --json | jq .     # machine-readable

# Drift watch (scheduled, alerting)
AISHA_DRIFT_WEBHOOK_URL=... bash scripts/drift-watch.sh                # one-shot
AISHA_DRIFT_WEBHOOK_URL=... bash scripts/drift-watch.sh --interval=3600  # loop, 1h

# Canary deploy (single app + extended verify)
node scripts/aisha-redeploy.mjs --canary=keycloak     # 1 app, 2× STABLE_POLLS

# Multi-environment (production / staging)
AISHA_ENV=staging    bash scripts/aisha-cold-start-env.sh
AISHA_ENV=production bash scripts/aisha-cold-start-env.sh --wipe   # vyžaduje "PRODUCTION" confirm

# Structured logging (JSON output → log aggregation)
AISHA_LOG_JSON=1 bash scripts/aisha-cold-start.sh

# Metrics (Prometheus textfile → node_exporter)
ls .metrics/                                           # po runu
# Plug into node_exporter:
#   node_exporter --collector.textfile.directory=.metrics

# Tests
npm run test:gates                                     # all gates
```

---

## Source references

- [scripts/aisha-cold-start.sh](../../scripts/aisha-cold-start.sh) — main orchestrator
- [scripts/aisha-redeploy.mjs](../../scripts/aisha-redeploy.mjs) — wave deploy
- [scripts/cold-start-doctor.sh](../../scripts/cold-start-doctor.sh) — preflight
- [scripts/local-warmup.sh](../../scripts/local-warmup.sh) — local dev
- [scripts/local-compose-gen.mjs](../../scripts/local-compose-gen.mjs) — compose generator
- [scripts/diagnose-pki-coolify.sh](../../scripts/diagnose-pki-coolify.sh) — PKI recovery
- [scripts/fix-docker-network-pools.sh](../../scripts/fix-docker-network-pools.sh) — Docker pool fix
- [scripts/coolify-drift-check.mjs](../../scripts/coolify-drift-check.mjs) — drift detection (live ↔ manifest)
- [scripts/drift-watch.sh](../../scripts/drift-watch.sh) — scheduled drift watch + webhook alerting
- [scripts/aisha-cold-start-env.sh](../../scripts/aisha-cold-start-env.sh) — env-aware cold-start (production/staging)
- [scripts/lib/log.mjs](../../scripts/lib/log.mjs) + [log.sh](../../scripts/lib/log.sh) — structured logger (pretty/JSON)
- [scripts/lib/metrics.mjs](../../scripts/lib/metrics.mjs) + [metrics.sh](../../scripts/lib/metrics.sh) — Prometheus textfile metrics
- [config/coolify-environments.env](../../config/coolify-environments.env) — per-env Coolify endpointy
- [coolify/manifests/aisha.manifest](../../coolify/manifests/aisha.manifest) — 13 apps source of truth
- [config/image-versions.env](../../config/image-versions.env) — image pinning
- [config/cold-start-timeouts.env](../../config/cold-start-timeouts.env) — tunables
- [config/local-presets.mjs](../../config/local-presets.mjs) — local warmup presets

---

## Vault backup & disaster recovery (credential survival)

The stack-internal secrets live in the local vault (`.env-prod-backup` + `.env.coolify`, both gitignored). `generate-secrets` **preserves** them across a `--wipe` — but only if the vault is present. A `--wipe` also DELETEs apps *with* their Coolify env + volumes, destroying the server-side copy. Losing both = unrecoverable encryption keys / validator identity.

**Automatic (every `--wipe`, no setup):** before the destroy, cold-start runs `backup_vault_before_wipe`:
1. **Reverse-sync** — [`scripts/coolify-pull-envs.mjs`](../../scripts/coolify-pull-envs.mjs) recovers every managed secret from the live (about-to-be-wiped) Coolify store into `.env-prod-backup`.
2. **Local snapshot** — a mode-600 tarball under `.vault-backups/` (gitignored).
3. It **REFUSES to wipe** if the snapshot fails (platform left intact). Escape hatch: `AISHA_WIPE_SKIP_VAULT_BACKUP=1` (you hold your own backup).

**Off-machine DR (recover on a FRESH machine — one-time setup):**
```bash
age-keygen -o ~/.aisha-vault-age.key            # keep the PRIVATE key in your password manager
export AISHA_VAULT_BACKUP_AGE_RECIPIENT=age1...  # the public recipient (put in .env-prod-backup)
```
With a recipient set, each `--wipe` also pushes an **age-encrypted** snapshot (ciphertext only) to the private instance-data repo (`AISHA_INSTANCE_DATA_GIT_URL`, `vault/vault-latest.age`).

**Restore (Scénář 5 — fresh machine / lost vault):**
```bash
AISHA_VAULT_BACKUP_AGE_KEY_FILE=~/.aisha-vault-age.key \
  bash scripts/vault-restore.sh --instance-data      # or --from <file.age>
# then run cold-start — the ORIGINAL credentials are preserved.
```
See [`scripts/vault-restore.sh`](../../scripts/vault-restore.sh) (DR sibling of [`coolify-restore-backup.sh`](../../scripts/coolify-restore-backup.sh) for DB restore).
