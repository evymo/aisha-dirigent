# Multi-Server Coolify Deployment Guide

> Architektura a runbook pro nasazování aplikací (stories) napříč více servery v Coolify.
> Každá story by měla **by design** řešit placement na vhodné stroje.

> **🔗 Cross-server konektivita:** Tento dokument zachycuje historickou LAN topologii
> (<backend-lan-ip> / <experimental-lan-ip>). **Cílový stav je plná migrace na NetBird mesh** —
> service-to-service URL používají `*.mesh.aisha.internal` (`backend.mesh.aisha.internal`,
> `experimental.mesh.aisha.internal`). Viz [`NETBIRD_MESH.md`](NETBIRD_MESH.md) pro detail
> a důvody proč NetBird **NIKDY** neběží na hostu, pouze v Docker sidecarech
> (`network_mode: host` uvnitř příslušného Coolify stacku).
> Gate test `src/tests/gates/no-hardcoded-network.gate.test.ts` zakazuje zavlékání
> nových `hardcoded LAN IP` referencí mimo whitelist.

---

## Architektura serverů

```
┌──────────────────────────────────────────────────────────────┐
│                        FRONTEND (production)                     │
│  12 CPU · 24 GB RAM · 200 GB disk                            │
│  Role: HTTP frontend, Traefik, Supabase, Keycloak, Langfuse  │
│  Domény: web.aisha.guru, app.example.com, auth.aisha.guru, …  │
│  Stacks: core, web, keycloak, integration, langfuse, admin   │
└──────────────────────┬───────────────────────────────────────┘
                       │ Coolify manages all servers
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ BUILD (build)│ │ BACKEND (backend)│ │ EXPERIMENTAL (staging)│
│ 4C · 8GB     │ │ 6C · 12GB    │ │ 4C · 8GB      │
│ Docker build │ │ Headless svc │ │ AI / staging    │
│ only         │ │ DB, game srv │ │ ML models       │
│ No runtime   │ │ No Traefik   │ │ Isolated        │
└──────────────┘ └──────────────┘ └──────────────────┘
```

### Server role matrix

| Server | Role | Traefik | Veřejné domény | Typické workloads |
|--------|------|---------|----------------|-------------------|
| **Frontend** | production | ✅ Ano | `*.id3a.cz` | HTTP frontends, API gateways, SPA, admin UI, observability |
| **Build** | build | ❌ Ne | Žádné | Docker image builds (remote builder for all stacks) |
| **Backend** | backend | ❌ Ne | Žádné | Databases, game servers, headless backends, long-running processes |
| **Experimental** | staging/AI | ❌ Ne | `staging.id3a.cz` | AI sidecars, ML inference (Ollama), staging preview |

### Placement decision tree

```
Nová služba potřebuje:
│
├─ Veřejnou HTTP doménu? → FRONTEND
│   (Traefik reverse proxy, Let's Encrypt TLS)
│
├─ Headless backend, DB, game server?
│   ├─ RAM < 4 GB → BACKEND (12 GB available)
│   └─ RAM > 4 GB → zvažuj dedicated server
│
├─ AI inference, ML modely, GPU?  → EXPERIMENTAL
│   (izolované od produkce, Ollama pre-installed)
│
├─ Staging / preview? → EXPERIMENTAL
│
└─ Je to build job? → BUILD
    (use_build_server=true v Coolify)
```

---

## Source of Truth

| Soubor | Účel |
|--------|------|
| `coolify/servers.json` | Server registry — kapacity, role, stacks, UUIDs |
| `coolify/servers.schema.json` | JSON Schema pro validaci servers.json |
| `scripts/check-infra.mjs` | Health check všech stacků across servers |
| `scripts/coolify-deploy-init.sh` | Init script pro core evymo stacky (Frontend) |

---

## Jak přidat novou story (multi-server)

### 1. Naplánuj placement

Rozhodni, které služby story potřebuje a kam patří:

```
Příklad: "acme-app" story
├── Frontend (gateway + SPA)     → Frontend (potřebuje doménu)
├── Backend (MariaDB + L2J)      → Backend (headless, 2-4 GB RAM)
└── AI sidecar (Python + Ollama) → Experimental (ML inference)
```

### 2. Vytvoř compose soubory

Pro **každý server** jeden compose soubor. Naming convention:

```
docker-compose.coolify-{story}-{role}.yml
```

Příklad:
- `docker-compose.coolify-<tenant>.yml` — frontend (Frontend)
- `docker-compose.coolify-<tenant>-backend.yml` — backend (Backend)
- `docker-compose.coolify-<tenant>-ai.yml` — AI sidecar (Experimental)

### 3. Compose pravidla per server type

#### Frontend (s Traefik)

```yaml
networks:
  internal:
    driver: bridge
  coolify:
    external: true   # Traefik network

services:
  web:
    networks:
      - internal
      - coolify       # exposed to Traefik
    labels:
      - "coolify.managed=true"
      - "traefik.docker.network=coolify"  # POVINNÉ pro multi-network
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:PORT/ || exit 1"]
      interval: 15s
      timeout: 5s
      start_period: 30s
      retries: 10
```

#### Backend / Experimental (bez Traefik)

```yaml
networks:
  internal:
    driver: bridge
  # ŽÁDNÁ coolify external network — tyto servery nemají Traefik

services:
  db:
    networks:
      - internal
    ports:
      - "3306:3306"   # host port pro cross-server přístup
    healthcheck:
      test: ["CMD-SHELL", "healthcheck command"]
      interval: 10s
      timeout: 5s
      retries: 5
```

### 4. Cross-server komunikace

Služby na různých serverech komunikují přes **IP adresy**, ne Docker networks:

```yaml
# Frontend na Frontend → Backend na Backend
environment:
  - DATABASE_HOST=${BACKEND_IP}    # Coolify env var
  - AI_API_URL=http://${EXPERIMENTAL_IP}:8090
```

**Pravidla:**
- NIKDY hardcodovat IP adresy v compose — vždy `${SERVER_IP}` env var
- IP adresy nastavit jako Coolify environment variables
- Porty musí být exposed na host (bridge networking) na cílovém serveru
- Interní služby (DB) → neexponovat na 0.0.0.0, použít firewall

### 5. Env var template (.env.coolify-{story}.example)

Pro každý compose vytvořit example s komentáři:

```bash
# === Cross-server connectivity ===
BACKEND_IP=<backend-lan-ip>        # Set in Coolify env vars
EXPERIMENTAL_IP=<experimental-lan-ip>       # Set in Coolify env vars

# === Secrets (generate unique per story!) ===
DB_ROOT_PASSWORD=            # openssl rand -base64 24
DB_PASSWORD=                 # openssl rand -base64 24

# === Service config ===
JAVA_OPTS=-Xms512m -Xmx1g   # Tune per server RAM
```

### 6. Vytvoř Coolify aplikace přes API

```bash
# Pro KAŽDÝ server/compose:
curl -X POST "https://frontend.id3a.cz/api/v1/applications/public" \
  -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "project_uuid": "ps888gcc4gk4o8c8w444o4s0",
    "environment_name": "production",
    "server_uuid": "SERVER_UUID_HERE",
    "type": "docker-compose",
    "name": "story-role",
    "git_repository": "https://repo.id3a.cz/aisha/REPO.git",
    "git_branch": "main",
    "docker_compose_location": "/docker-compose.coolify-story-role.yml",
    "build_pack": "dockercompose",
    "is_static": false,
    "instant_deploy": false
  }'
```

**KRITICKÉ:** Použij `applications/public` (NE `applications/dockercompose`)!
- `applications/public` → git-linked application (správné)
- `applications/dockercompose` s `docker_compose_raw` → service bez gitu (špatně)

### 7. Nastav env vars v Coolify

```bash
# Bulk set env vars
for key_val in "DB_PASSWORD=xxx" "BACKEND_IP=<backend-lan-ip>"; do
  key="${key_val%%=*}"
  val="${key_val#*=}"
  curl -X POST "https://frontend.id3a.cz/api/v1/applications/${UUID}/envs" \
    -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"${key}\",\"value\":\"${val}\",\"is_preview\":false}"
done
```

### 8. Deploy

```bash
# Restart = full redeploy (build + recreate all containers)
curl -X POST "https://frontend.id3a.cz/api/v1/applications/${UUID}/restart" \
  -H "Authorization: Bearer ${COOLIFY_TOKEN}"
```

### 9. Aktualizuj registry

Přidej nový stack do `coolify/servers.json`:
```json
{
  "backend": {
    "stacks": ["existing-stack", "new-story-backend"]
  }
}
```

Přidej UUID do `scripts/check-infra.mjs`:
```javascript
backend: {
  stacks: {
    'new-story-backend': process.env.COOLIFY_UUID_NEW_BACKEND || 'uuid-here',
  },
},
```

---

## Kapacitní plánování

### Aktuální využití (estimate)

| Server | RAM total | AISHA core | Volné pro stories |
|--------|-----------|------------|-------------------|
| Frontend | 24 GB | ~14 GB (Supabase+KC+Langfuse+Ragnarok) | ~10 GB |
| Backend | 12 GB | ~1 GB (integration) | ~11 GB |
| Experimental | 8 GB | ~0.5 GB (staging) | ~7.5 GB |
| Build | 8 GB | — (build only) | N/A |

### Typické nároky služeb

| Workload | RAM | CPU | Server |
|----------|-----|-----|--------|
| SPA frontend (nginx) | 64–128 MB | 0.1 | Frontend |
| Node.js API gateway | 128–512 MB | 0.5–1 | Frontend |
| MariaDB / PostgreSQL | 256 MB–2 GB | 0.5–2 | Backend |
| Java game server (L2J) | 512 MB–2 GB | 1–2 | Backend |
| Python AI sidecar | 256–512 MB | 0.5–1 | Experimental |
| Ollama (LLM inference) | 2–6 GB | 2–4 | Experimental |

### JVM tuning pro Backend (12 GB RAM)

```bash
# Backend má 12 GB — L2J může bezpečně použít 2 GB heap
L2J_LOGIN_JAVA_OPTS=-Xms256m -Xmx512m
L2J_GAME_JAVA_OPTS=-Xms512m -Xmx2g

# Pokud MariaDB + L2J dohromady přesáhnou 8 GB → sniž Xmx
# Vždy nech alespoň 2 GB volné pro OS + Docker overhead
```

---

## Networking model

```
┌─ Internet ──────────────────────────────────────────────┐
│           HTTPS (443) → Traefik on Frontend                │
└────────────────────────┬────────────────────────────────┘
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
    ▼                    ▼                    ▼
  Frontend              Backend                 Experimental
  10.0.0.x           <backend-lan-ip>         <experimental-lan-ip>
  ┌────────┐         ┌────────┐          ┌────────┐
  │frontend│ ──TCP──→│ DB:3306│          │AI:8090 │
  │gateway │ ──TCP──→│game:7777          │ollama: │
  └────────┘         └────────┘          │ 11434  │
                                         └────────┘
  Frontend ──HTTP──────────────────────→ AI sidecar
```

**Firewall pravidla:**
- Frontend → Backend: povoleny porty dle compose (3306, 7777, 2106, 9014)
- Frontend → Experimental: povoleny porty dle compose (8090)
- Internet → Backend: BLOKOVÁNO (žádné veřejné porty)
- Internet → Experimental: BLOKOVÁNO (kromě staging.id3a.cz pokud potřeba)

---

## CI/CD pro multi-server stories

### Forgejo workflow template

```yaml
name: Deploy Story
on:
  push:
    branches: [main]
    paths:
      - 'docker-compose.coolify-story*.yml'
      - 'backend/**'
      - 'ai/**'
      - 'frontend/**'

jobs:
  deploy-frontend:
    runs-on: ubuntu-latest
    if: contains(github.event.head_commit.modified, 'frontend/')
    steps:
      - name: Deploy Frontend (Frontend)
        run: |
          curl -X POST "${{ secrets.COOLIFY_URL }}/api/v1/applications/${{ secrets.COOLIFY_UUID_FRONTEND }}/restart" \
            -H "Authorization: Bearer ${{ secrets.COOLIFY_API_TOKEN }}"

  deploy-backend:
    runs-on: ubuntu-latest
    if: contains(github.event.head_commit.modified, 'backend/')
    steps:
      - name: Deploy Backend (Backend)
        run: |
          curl -X POST "${{ secrets.COOLIFY_URL }}/api/v1/applications/${{ secrets.COOLIFY_UUID_BACKEND }}/restart" \
            -H "Authorization: Bearer ${{ secrets.COOLIFY_API_TOKEN }}"

  deploy-ai:
    runs-on: ubuntu-latest
    if: contains(github.event.head_commit.modified, 'ai/')
    steps:
      - name: Deploy AI (Experimental)
        run: |
          curl -X POST "${{ secrets.COOLIFY_URL }}/api/v1/applications/${{ secrets.COOLIFY_UUID_AI }}/restart" \
            -H "Authorization: Bearer ${{ secrets.COOLIFY_API_TOKEN }}"
```

### Forgejo Secrets (per repo)

| Secret | Popis |
|--------|-------|
| `COOLIFY_URL` | `https://frontend.id3a.cz` |
| `COOLIFY_API_TOKEN` | Coolify API Bearer token |
| `COOLIFY_UUID_FRONTEND` | UUID Coolify app pro frontend |
| `COOLIFY_UUID_BACKEND` | UUID Coolify app pro backend |
| `COOLIFY_UUID_AI` | UUID Coolify app pro AI (pokud existuje) |

---

## Troubleshooting

### Stack status "running:unhealthy"

Toto je Coolify sentinel kosmetický stav. Zkontroluj:
1. **Init kontejnery** s `restart: "no"` — po exit 0 jsou "exited" → Coolify = unhealthy
   - Fix: `healthcheck: disable: true` na init kontejnerech
2. **Zdraví přes HTTP/TCP**, ne přes Coolify status

### Cross-server connection refused

1. Ověř že cílový port je exposed na host: `docker port CONTAINER`
2. Ověř IP adresu v Coolify env vars
3. Ověř firewall: `nc -zv BACKEND_IP PORT`

### Deploy nic neudělá (no changes)

Coolify `restart` = FULL redeploy (pull + build + recreate). Pokud to nepomáhá:
- Ověř `docker_compose_location` na aplikaci
- Ověř `git_repository` a `git_branch`

### OOM na Backend/Experimental

- Zkontroluj celkový RAM: `docker stats --no-stream`
- Sniž JVM heap (Xmx) nebo Ollama model size
- Backend (12 GB): nech min. 2 GB volné pro OS

---

## Checklist pro novou story

- [ ] Placement rozhodnuto (která služba na který server)
- [ ] Compose soubory vytvořeny (1 per server)
- [ ] `.env.coolify-{story}*.example` soubory s komentáři
- [ ] Coolify aplikace vytvořeny přes API (`applications/public`)
- [ ] Env vars nastaveny přes Coolify API
- [ ] Cross-server IPs nastaveny jako env vars (ne hardcoded)
- [ ] `coolify/servers.json` aktualizován
- [ ] `scripts/check-infra.mjs` aktualizován (UUID + health endpoints)
- [ ] Forgejo secrets nastaveny (COOLIFY_UUID_*)
- [ ] Deploy triggered a verified
- [ ] Langfuse projekt vytvořen (pokud AI komponenta) s dedikovanými klíči
