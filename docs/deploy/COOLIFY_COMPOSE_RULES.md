# Coolify Docker Compose — Pravidla a Troubleshooting

> **Produkční znalostní báze** pro správu Docker Compose stacků na Coolify.
> Platí pro Coolify v4.x + Traefik v3.x (Docker provider).
> Vytvořeno na základě reálných deploymentů 2026-03.

---

## Klíčová pravidla

### 1. Healthchecky — POVINNÉ pro každou službu

Coolify Sentinel monitoruje Docker healthcheck stav **VŠECH** kontejnerů ve stacku.
Pokud **jakýkoli** kontejner je `unhealthy` nebo `exited`, celý stack je `running:unhealthy`.

**Traefik ignoruje kontejnery s Docker healthcheck ve stavu `unhealthy`** → vrací **503 "no available server"**.

#### Pravidla

1. **Každá služba MUSÍ mít `healthcheck:`** — jinak ji Coolify nemůže ověřit
2. **Init kontejnery** (`restart: "no"`) po ukončení vypadají jako `exited` → Coolify to vidí jako crash
   - Řešení: `healthcheck: disable: true`
3. **Healthcheck příkazy musí být jednoduché** — Coolify občas přidává extra quoting

#### Šablona healthchecku podle typu služby

```yaml
# HTTP služba (REST API, Web UI, Next.js...)
healthcheck:
  test: ["CMD-SHELL", "curl -fsS http://localhost:PORT/ || exit 1"]
  interval: 15s
  timeout: 5s
  start_period: 30s
  retries: 10

# PostgreSQL
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U postgres -h 127.0.0.1"]
  interval: 10s
  timeout: 5s
  start_period: 15s
  retries: 5

# Redis (exec form — viz pravidlo #3)
healthcheck:
  test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-default}", "ping"]
  interval: 10s
  timeout: 5s
  retries: 5

# Elasticsearch
healthcheck:
  test: ["CMD-SHELL", "curl -fsS http://localhost:9200/_cluster/health || exit 1"]
  interval: 15s
  timeout: 10s
  start_period: 60s
  retries: 15

# Process alive check (pokud služba nemá HTTP endpoint)
healthcheck:
  test: ["CMD-SHELL", "pgrep process_name || exit 1"]
  interval: 15s
  timeout: 5s
  start_period: 10s
  retries: 5

# Init kontejner (restart: "no")
healthcheck:
  disable: true
```

#### Důležité parametry

| Parametr | Doporučení | Proč |
|----------|-----------|------|
| `start_period` | 30–120s pro těžké služby | ClickHouse, Langfuse, Elasticsearch potřebují čas na inicializaci |
| `retries` | 10–15 pro DB-dependent služby | Čekání na závislosti (DB, Redis, MinIO) |
| `interval` | 10–15s | Častější = rychlejší detekce, ale větší zátěž |

---

### 2. Traefik network disambiguation — `traefik.docker.network`

Pokud je služba připojená k **více než jedné Docker síti**, Traefik může vybrat špatnou síť → **503**.

```yaml
# ❌ ŠPATNĚ — Traefik může vybrat internal síť (tam se nedostane)
service:
  networks:
    - internal
    - coolify
  labels:
    - "coolify.managed=true"

# ✅ SPRÁVNĚ — Traefik ví, že má použít coolify síť
service:
  networks:
    - internal    # interní komunikace mezi službami
    - coolify     # viditelnost pro Traefik
  labels:
    - "coolify.managed=true"
    - "traefik.docker.network=coolify"
```

**Pravidlo:** Každá služba s `networks: [internal, coolify]` (nebo jakákoliv kombinace 2+ sítí) MUSÍ mít label `traefik.docker.network=coolify`.

Služby na jedné síti tento label nepotřebují — Traefik má pouze jednu možnost.

> **Interní komunikace zůstává funkční.** Label říká pouze Traefiku, kterou síť použít pro příchozí HTTP traffic. Služby stále komunikují přes obě sítě normálně.

---

### 3. Coolify `$$` escaping — historie a SOUČASNÝ ověřený stav

**Historický incident:** starší Coolify při generování compose občas přidával
extra quoting kolem shell příkazů a `$$VAR` (Docker Compose shell escaping) se
rozbil (např. `'redis-server --requirepass "$$REDIS_PASSWORD"'` → literal).

**Současný stav (ověřeno 2026-06-10 přes Coolify API):** uložený TRANSFORMOVANÝ
compose appky `aisha-core` zachovává `$${NB_SETUP_KEY:-}` v command bloku
netbird-agenta **bajtově identicky** a skript v produkci funguje. Incident se
na aktuální verzi nereprodukuje. `$$` v `command:` blocích je tedy POVOLENÝ —
a pro secrets dokonce POVINNÝ (viz §3b/3c).

**Pravidlo pro NE-secret hodnoty:** preferuj exec form (JSON array) +
parse-time `${VAR:-default}` substituci — je deterministická a čitelná:

```yaml
command: ["redis-server", "--maxmemory", "${REDIS_MAXMEMORY:-512mb}"]
```

#### 3b. Secrets v `healthcheck: test:` — NIKDY interpolovat

- `${VAR}` (parse-time) → heslo se VYPÉČE do `Healthcheck.Test` — viditelné
  v `docker inspect`, `docker compose config` i Coolify UI (incident 2026-06-10:
  `curl -u elastic:${ELASTIC_PASSWORD}`).

```yaml
# ❌ špatně v healthchecku
test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]

# ✅ ŘEŠENÍ — auth-less liveness (odpověď protokolu = živý server)
test: ["CMD", "redis-cli", "ping"]                # exit 0 i při NOAUTH, 1 při nedostupnosti (ověřeno)
test: ["CMD-SHELL", "curl -s -o /dev/null -w '%{http_code}' http://localhost:9200/ | grep -qE '^(200|401)$'"]
```

`$$VAR` test PRÁZDNOSTI env proměnné (`if [ -z "$$NB_SETUP_KEY" ]`) nic
neleakuje a v praxi funguje (PENDING_BOOTSTRAP pattern) — povoleno.

#### 3c. Secrets v `command:` skriptech — VŽDY runtime-deferred `$$VAR`

Parse-time `${SECRET}` v command bloku vypéče hodnotu do `Config.Cmd` (docker
inspect + Coolify UI). Správný vzor: secret deklaruj v `environment:` služby
(tam patří — `Config.Env` je akceptovaná baseline) a skript ho čte runtime
přes `$$`:

```yaml
# ❌ špatně — heslo v Config.Cmd
command:
  - sh
  - -c
  - psql … -c "CREATE USER app WITH PASSWORD '${APP_DB_PASSWORD}';"

# ✅ správně — env delivery + runtime čtení (db-init kanonický vzor)
environment:
  APP_DB_PASSWORD: ${APP_DB_PASSWORD:?required}
command:
  - sh
  - -c
  - psql … -c "CREATE USER app WITH PASSWORD '$${APP_DB_PASSWORD}';"
```

Remediováno 2026-06-10 napříč db-inity (langfuse/llm-gateway/matrix/openclaw)
a pki-init rendererem. Vynucuje gate `coolify-compose-compliance` (kategorie
Compose Secret Hygiene) — bez výjimek pro init kontejnery.

---

### 4. Next.js / Node.js bind na 0.0.0.0

Next.js 16+ defaultně binduje na hostname kontejneru (např. `http://40fec1240fc7:3000`), ne na `0.0.0.0`. Traefik se pak nedostane na službu.

```yaml
# ✅ SPRÁVNĚ — Next.js binduje na všechna rozhraní
environment:
  HOSTNAME: "0.0.0.0"
```

**Platí pro:** Supabase Studio, Langfuse, jakákoli Next.js aplikace.

---

### 5. Bind-mount souborů — NEBEZPEČNÉ na Coolify

Coolify klonuje repo do interní cesty (`/data/coolify/...`). Pokud zdrojový soubor neexistuje, Docker vytvoří **adresář** místo souboru → crash kontejneru.

```yaml
# ❌ NEBEZPEČNÉ — soubor nemusí existovat na Docker hostu
volumes:
  - ./config/realm.json:/opt/app/import/realm.json:ro

# ✅ BEZPEČNÉ — soubor je součástí image
# Dockerfile:
COPY config/realm.json /opt/app/import/realm.json
```

**Řešení:** Bake do image přes Dockerfile COPY, nebo předej přes env var.

---

### 6. Init kontejnery

Docker Compose `restart: "no"` kontejnery (migrační skripty, seed skripty) po úspěšném dokončení přejdou do stavu `exited`. Coolify to interpretuje jako crash.

```yaml
# ✅ Init kontejner s disabled healthcheck
migrate:
  image: migrate-image
  restart: "no"
  healthcheck:
    disable: true

# ✅ Služba závisí na init kontejneru
app:
  depends_on:
    migrate:
      condition: service_completed_successfully
```

---

### 7. „Deploy dokončen" NEZNAMENÁ, že služba běží

Coolify hlásí nasazení jako `finished`, jakmile kontejner **odstartoval**. Jestli
zůstal nahoře, už nesleduje. Poslední řádky logu úspěšného nasazení jsou:

```
Container keycloak-…  Starting
Container keycloak-…  Started
New container started.
```

Kontejner, který se o vteřinu později rozpadne, tenhle výpis nezmění — a
s `restart: unless-stopped` se rozjede **smyčka**, takže `docker ps` chvíli
ukazuje `Up 3 seconds (health: starting)` a chvíli nic.

**Naměřeno 2026-08-02:** jeden neznámý klíč v `keycloak/aisha-realm.json` shodil
import realmu. Keycloak nastartoval, připojil se k DB, rozjel Infinispan — a pak
umřel. Coolify hlásil `finished`, Traefik na veřejné doméně odpovídal
přesměrováním na vnitřní adresu, a to vypadalo jako vada routingu. **Symptom
nedostupnosti se snadno splete s chybou konfigurace.** Přihlášení bylo mimo
provoz několik hodin.

**Přejímka nasazení — v tomto pořadí:**

```bash
# 1. BĚŽÍ to? (ne „nasadilo se", ale „je to nahoře a nezvedá se to pořád dokola")
ssh <node> 'docker ps -a --format "{{.Names}}\t{{.Status}}" | grep <sluzba>'

# 2. Co říká ono samo? Log kontejneru je autorita, ne hlášení Coolify.
ssh <node> 'docker logs --tail 80 <kontejner>'

# 3. Teprve pak funkce: odpovídá cílová routa tím, čím má?
curl -s -o /dev/null -w '%{http_code}\n' https://<domena>/<zdravotni-cesta>
```

Roste-li u kontejneru `Up N seconds` při každém dotazu od nuly, je to smyčka —
ne pomalý start. Zdrojem pravdy je vždy `count(*)` v cílovém systému, ne zelená
hláška nasazovače (viz `src/tests/gates/ci-deploy-honesty.gate.test.ts`).

---

### 8. Overlay zapečený do image se KEŠUJE — cachebust musí přepočítat každý deploy

BuildKit kešuje vrstvu podle **textu příkazu**. Text `git clone <overlay>` se
mezi nasazeními nemění, takže klon proběhne **jednou a pak už nikdy**: obraz veze
obsah overlay repa ze dne prvního buildu, build projde zeleně a kontejner
nastartuje. Pozná se to až očima na nasazené stránce.

Proti tomu stojí build ARG `*_CACHEBUST` — SHA vzdálené větve, která se změní
právě tehdy, když se změnil obsah (proto SHA, ne časové razítko: čas by vynutil
přestavbu i tam, kde se nic nezměnilo).

```dockerfile
ARG KC_THEME_OVERLAY_CACHEBUST=
RUN echo "cachebust=$KC_THEME_OVERLAY_CACHEBUST" && git clone --depth 1 …
```

**Hodnotu musí vyrobit KAŽDÁ nasazovací cesta, ne jen cold start.** Do 2026-08-02
ji počítal pouze `aisha-cold-start.sh`, a i tam jen když byla prázdná — redeploy
ji nepřepočítal vůbec. Nasadit změněný overlay tedy nešlo a nic to neohlásilo.

| overlay | konzument | výrobce |
|---|---|---|
| `SURFACE_OVERLAY_CACHEBUST` | `deploy/surface-host/Dockerfile` | `scripts/provision-surfaces.sh` |
| `KC_THEME_OVERLAY_CACHEBUST` | `Dockerfile.keycloak` | `scripts/aisha-redeploy.mjs` → `OVERLAY_CACHEBUSTS` |
| `AISHA_WEB_DESIGN_CACHEBUST` | `services/svc-web-artifact/Dockerfile` | `scripts/aisha-redeploy.mjs` → `OVERLAY_CACHEBUSTS` |
| `SOURCE_ADAPTER_OVERLAY_CACHEBUST` | `Dockerfile.svc-source-broker` (stage `source-adapters`) | `scripts/aisha-redeploy.mjs` → `OVERLAY_CACHEBUSTS` (až za env-doktorem — URL je odvozená) |

Ruční a CI cesty používají `scripts/deploy/refresh-overlay-cachebust.sh` —
tentýž výpočet, ale zapsaný rovnou na Coolify aplikaci a volaný těsně před
sestavením. `.github/workflows/deploy.yml` ho volá v `deploy_stack()`.

#### Pravidlo výš platilo jen na papíře — naměřeno 2026-08-31

`AISHA_WEB_DESIGN_CACHEBUST` stálo na `88844ca`, zatímco designové repo bylo
na `73cf68a`. Paleta značky se opravovala opakovaně v repu i v instančním
seedu, do obrazu se ale nikdy nedostala: v DB zůstávala stará barva a
`profile_version` přitom rostla — seed běžel při každém nasazení, jen se
STARÝM obsahem z obrazu. Rostoucí čítač aktivity vypadal jako důkaz, že
oprava dorazila.

Příčinou nebyl chybějící výrobce, ale **cesta, která ho míjela**:
`GET /api/v1/deploy` (ručně i z `.github/workflows/deploy.yml` a
`scripts/ci/deploy-and-verify.sh`) spustí sestavení bez toho, co
`aisha-redeploy.mjs` dělá PŘED ním.

**Proč to nehlídá brána.** `overlay-clone-cachebust` ověřuje, že hodnota není
PRÁZDNÁ — to chytí první instalaci. Zastaralá hodnota projde stejně dobře jako
správná. Kontrola *tvaru* jde udělat staticky v CI; kontrola *aktuálnosti*
vyžaduje `git ls-remote`, tedy dotaz ven, a musí proto běžet při nasazení.
Tím se ale stala vlastností jednoho nástroje místo vlastnosti systému. Náprava
je posadit ji na společné hrdlo — těsně před sestavení, kudy projde každá cesta.

**Diagnostické vodítko.** `SOURCE_COMMIT` v kontejneru odpovídá na otázku „je
nasazený můj commit?", NE na otázku „je v obrazu můj obsah?". Obsah klonovaný
z cizího repa má vlastní verzi, kterou hlavní commit nehlídá — proto ta verze
musí být v TEXTU příkazu, jinak si jí Docker nemá jak všimnout.

Hodnotu vydává `scripts/deploy/overlay-cachebust.sh` (jeden `git ls-remote`,
neklonuje). Přidáváš-li nový overlay, stačí `ARG *_CACHEBUST` v Dockerfilu —
brána `ci-deploy-honesty` si ho najde sama a bude trvat na výrobci.

⚠️ **Instanční overlay přepisuje soubory CELÉ, ne po klíčích.** V
`Dockerfile.keycloak` se kopíruje až PO tématu z repa, takže instanční
`messages_cs.properties` platformní nahradí. Co v instančním souboru není, na
stránce chybí — přidání klíče na platformě proto vyžaduje doplnit ho i do
overlaye.

---

## Kompletní šablona routované služby

```yaml
my-service:
  image: my-image:latest
  container_name: aisha-my-service
  restart: unless-stopped
  environment:
    HOSTNAME: "0.0.0.0"        # pro Next.js/Node.js
    # ... další env vars
  expose:
    - "3000"                    # port pro Coolify routing
  healthcheck:
    test: ["CMD-SHELL", "curl -fsS http://localhost:3000/health || exit 1"]
    interval: 15s
    timeout: 5s
    start_period: 30s
    retries: 10
  networks:
    - internal                  # interní komunikace
    - coolify                   # Traefik viditelnost
  labels:
    - "coolify.managed=true"
    - "traefik.docker.network=coolify"   # POVINNÉ při 2+ sítích

# Coolify docker_compose_domains nastavení:
# "my-service": "https://my-service.id3a.cz:3000"
```

---

## Debugging — Diagnostický postup

### Symptom: Stack `running:unhealthy`

```
1. Zjisti KTERÉ služby nemají healthcheck
   → Coolify API: GET /api/v1/applications/{uuid}/compose
   → Parsuj YAML, najdi služby bez healthcheck:

2. Přidej healthchecky ke VŠEM službám (viz šablony výše)

3. Init kontejnery (restart: "no") → healthcheck: disable: true

4. Redeploy → ověř status přes API
```

### Symptom: 503 "no available server"

```
1. Stack je running:unhealthy?
   → Traefik ignoruje unhealthy kontejnery → oprav healthchecky (viz výše)

2. Stack je running:healthy ale stále 503?
   → Služba je na 2+ sítích bez traefik.docker.network label
   → Přidej: labels: ["traefik.docker.network=coolify"]

3. Doména nemá port pro expose ≠ 80?
   → Coolify docker_compose_domains musí mít port v URL
   → Např: "https://service.id3a.cz:3000" ne "https://service.id3a.cz"

4. Aplikace nebinduje na 0.0.0.0?
   → Přidej HOSTNAME=0.0.0.0 do environment
```

### Symptom: Redis WRONGPASS / auth error

```
1. Redis command používá $$ shell escaping?
   → Coolify double-quotes → heslo se přenese jako literal "$$REDIS_PASSWORD"
   → Řešení: exec form (array) + ${VAR:-default} substituce
```

### Symptom: Kontejner crash-loop s "Is a directory"

```
1. Bind-mount na soubor který neexistuje na hostu
   → Docker vytvoří adresář místo souboru
   → Řešení: bake do image přes COPY v Dockerfile
```

### Symptom: Prisma/DB connection lost po restartu jiného stacku

```
1. Služby sdílí DB (např. Langfuse → Supabase DB)
2. Restart DB stacku = kill DB connections
3. Řešení: redeploy závislého stacku (Langfuse) po restartu DB stacku
```

---

## Coolify API — Užitečné příkazy

```bash
COOLIFY="https://frontend.id3a.cz"
TOKEN="Bearer $COOLIFY_API_TOKEN"

# Status stacku
curl -sS "$COOLIFY/api/v1/applications/$UUID" -H "Authorization: $TOKEN" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status'])"

# Deploy (force)
curl -sS "$COOLIFY/api/v1/deploy?uuid=$UUID&force=true" -H "Authorization: $TOKEN"

# Status deploye
curl -sS "$COOLIFY/api/v1/deployments/$DEPLOY_UUID" -H "Authorization: $TOKEN" \
  | grep -o '"status":"[^"]*"'

# Logy aplikace
curl -sS "$COOLIFY/api/v1/applications/$UUID/logs?since=600" -H "Authorization: $TOKEN"

# Stažení generovaného compose (pro debug)
curl -sS "$COOLIFY/api/v1/applications/$UUID/compose" -H "Authorization: $TOKEN" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['compose_file'])" > /tmp/gen.yml
```

---

## Stack UUID reference

| Stack | UUID | Compose file |
|-------|------|-------------|
| Core (aisha) | `js80o0ccc0888o0wwkc80ss8` | `docker-compose.coolify.yml` |
| aisha-llm | `escgs8s4kcsgggs8g4gsg8cs` | `docker-compose.coolify-integration.yml` |
| Langfuse | `i8gkg8c4k4gkgwc444s8cww0` | `docker-compose.coolify-langfuse.yml` |
| Admin | `vkg8gw4ggkc88wo84og4o8kc` | `docker-compose.coolify-admin.yml` |
| Web | — | `docker-compose.coolify-prebuilt.yml` |

---

## Checklist pro nový compose stack

- [ ] Každá služba má `healthcheck:`
- [ ] Init kontejnery mají `healthcheck: disable: true`
- [ ] Routované služby mají `expose:`, `networks: [internal, coolify]`, `labels: [coolify.managed=true, traefik.docker.network=coolify]`
- [ ] Žádné `$$VAR` v command/healthcheck — použij exec form
- [ ] Next.js/Node.js služby mají `HOSTNAME: "0.0.0.0"`
- [ ] Žádné bind-mount na soubory — bake do image
- [ ] `docker_compose_domains` má port v URL pro expose ≠ 80
- [ ] Dockerfile: single-stage, `context: .`, COPY z repo root
- [ ] Klonuje-li Dockerfile overlay repo, má `ARG *_CACHEBUST` **a výrobce na nasazovací cestě** (pravidlo 8)
- [ ] Po nasazení proběhla přejímka podle pravidla 7 — běží, log čistý, routa odpovídá (ne jen „deploy finished")
