# NetBird Mesh — Zero-Trust VPN pro AISHA stack

> **Status:** F0–F4 implementace (2026-04-24, commit `b04db006`)
> **Doména:** `mesh.aisha.internal`
> **Control plane:** Frontend (`netbird-management`, `netbird-signal`, `netbird-dashboard`, `coturn` shared TURN)

---

## Princip

NetBird je self-hosted mesh VPN postavený nad WireGuard. Slouží jako **jediná cesta** pro
cross-server konektivitu (Frontend ↔ Backend ↔ Experimental) a pro per-run agent sandboxing
(`svc-agent-runner` vytváří efemerní peer pro každý běh agenta).

**Cílový stav:**
- Žádná hardcoded IP adresa (`192.168.x.x`, `10.0.x.x`) v aplikačním kódu / compose / docs.
- Všechny cross-server URL v compose: `${SERVER}.mesh.aisha.internal` (např. `backend.mesh.aisha.internal`).
- 192.168.x.x reference povolené **pouze** v testovacích mockách a historickém runbooku.

---

## ABSOLUTNÍ pravidlo: NetBird běží POUZE v Docker sidecarech

> ❌ **NIKDY** neinstaluj NetBird agent přímo na host (Frontend / Backend / Experimental).
> ✅ Agent běží jako Docker kontejner UVNITŘ příslušného Coolify stacku — v BRIDGE
> režimu (vlastní netns), NE `network_mode: host`. Hostitelský slot drží jediný
> agent; každý další stack se do mesh hlásí ve vlastním namespace a jeho
> `mesh-ingress` ten namespace sdílí (`network_mode: service:netbird-agent`).
> Tabulka níž je historický stav F0–F4; dnešní tvar viz „Konverze stacku na mesh".

### Proč:
- Coolify spravuje lifecycle kontejnerů — host install by byl mimo orchestraci.
- Upgrade NetBird = `docker compose pull && up -d` v Coolify, ne SSH na host.
- Multi-tenant izolace: každý Coolify stack může mít vlastní NetBird agent s vlastními setup keys.
- Audit trail: všechny změny prochází git → Coolify webhook → deploy.

### Architektura sidecarů (per server):

| Server | Stack | Sidecar service | `network_mode` |
|---|---|---|---|
| Frontend | `frontend--core` (`docker-compose.coolify.yml`) | `frontend--core--netbird` | `host` |
| Backend | `backend--integration` (`docker-compose.coolify-integration.yml`) | `backend--integration--netbird` | `host` |
| Experimental | `experimental--cosmos` (`docker-compose.coolify-cosmos.yml`) | `experimental--cosmos--netbird` | `host` |

### Setup keys

Každý sidecar potřebuje **dedikovaný setup key** (vytvořený v NetBird dashboardu nebo přes API):

```bash
# Coolify env vars — jeden klíč na PLACEMENT, vydává je netbird-bootstrap.sh
# (skutečná jména; dřív tu stálo NETBIRD_SETUP_KEY_*, které nikde neexistuje):
NETBIRD_STACK_KEY_FRONTEND=<frontend stacky: core, edge>
NETBIRD_STACK_KEY_BACKEND=<backend stacky: potok, n8n, admin, …>
NETBIRD_STACK_KEY_INTEGRATION=<integration>
NETBIRD_STACK_KEY_EXPERIMENTAL=<experimental stacky: cosmos, model, local-ingest>
```

Sdílení klíčů mezi servery je **zakázané** (audit + revocation izolace).

---

## Mesh DNS

NetBird poskytuje vlastní DNS resolver (typicky `100.64.0.x` v WireGuard rozsahu).
Service-to-service URL v compose musí používat `*.mesh.aisha.internal`:

```yaml
# ✅ SPRÁVNĚ
- RAGNAROK_URL=http://backend.mesh.aisha.internal:7100

# ❌ ŠPATNĚ
- RAGNAROK_URL=http://<backend-lan-ip>:7100
- RAGNAROK_URL=http://backend:7100         # internal name z jiného stacku — nedostupné cross-server
```

Pro non-NetBird kontejnery které potřebují resolvovat mesh hostnames, přidat:

```yaml
services:
  myservice:
    dns:
      # Resolver má DETERMINISTICKOU adresu (mesh-router pinuje MESH_DNS_RESOLVER_IP
      # na síti mesh-dns; NETBIRD_DNS_IP z ní odvozuje generate-secrets).
      # ⛔ ŽÁDNÝ fallback na 127.0.0.11 — dřív tu stál a rozbil i veřejné DNS
      # (brána coldstart-mesh-dns-activation ho jmenuje jako past).
      - ${NETBIRD_DNS_IP:?vydává generate-secrets; coolify-sync-envs doručí}
    dns_search:
      - ${MESH_TLD:?vydává generate-secrets}
    networks:
      - mesh-dns
```

---

## Per-run agent sandboxing — běh do meshe NEPATŘÍ (2026-10-06, volba A)

Runner (`services/svc-agent-runner/src/`) dřív pro každý běh razil klíč NetBirdu
(`createEphemeralKey`) a předával ho kontejneru jako `NB_SETUP_KEY`. Žádný obraz běhu ho
nepoužil — klíč jen ležel v prostředí pluginu, a `revokePeer` hledal uzel podle id KLÍČE,
takže zapsaný uzel by v meshi zůstal. Majitel 2026-10-06 („síť zavřít“ = volba A):

1. Klíč se pro běh **nerazí vůbec**; runner nemá klienta správy meshe ani pověření
   (`NETBIRD_MGMT_SECRET`, `NETBIRD_API_*`, `NETBIRD_SANDBOX_GROUP` v exec stacku nejsou).
2. Síť běhů zakládá runner s `Internal: true` a bez adresy hostitele (`inhibit_ipv4`) —
   žádná výchozí trasa ven ani cesta k posluchačům hostitele; otevřenou síť toho jména odmítne.
3. Jediná cesta ven je **broker-proxy** runneru (`broker-proxy.ts`, převzatá z větve forku
   `feat/runner-broker-proxy`, varianta C 2026-10-01): `/sandbox/*` na broker pro všechny
   běhy a `CONNECT` s tokenem běhu jen pro claude_cli_task (hostitelé z konfigurace, jen
   https, jen veřejné adresy). Mesh trasu má jen runner sám (`NETBIRD_PEER_CIDR` přes `NETBIRD_DNS_IP`).

Výklad: `docs/compose-notes/docker-compose.coolify-exec.yml.md`; brána tvaru:
`src/tests/gates/beh-kontejneru-tvar.gate.test.ts`. Skupina `sandbox-run` v NetBirdu
(netbird-bootstrap.sh) zůstává založená, runner ji nepoužívá.

---

## Control plane components (`docker-compose.coolify-netbird.yml`)

| Service | Container | Účel |
|---|---|---|
| Management API | `frontend--netbird--management` | Auth, setup keys, peer registry |
| Signal | `frontend--netbird--signal` | NAT traversal coordination |
| Dashboard | `frontend--netbird--dashboard` | Web UI (`netbird.aisha.network`) |
| Relay (TURN) | sdílený `frontend--core--coturn` | Fallback pro restriktivní NAT |

OIDC integrace s Keycloak: realm `aisha`, klienti `netbird` (frontend SPA) +
`netbird-backend` (M2M Management API). Viz `keycloak/aisha-realm.json`.

---

## Migrace z LAN (192.168.x.x) → Mesh

Historicky stack používal přímé LAN IPs. Cílový stav je **plná migrace na mesh**:

| Stará reference | Nová reference |
|---|---|
| `<backend-lan-ip>` (Backend backend) | `backend.mesh.aisha.internal` |
| `<experimental-lan-ip>` (Experimental staging) | `experimental.mesh.aisha.internal` |
| Frontend LAN IP | `frontend.mesh.aisha.internal` |

Audit nových výskytů: gate `src/tests/gates/no-hardcoded-network.gate.test.ts`
zakazuje zavlékání `hardcoded LAN IP` do souborů mimo whitelist (mocks, historický runbook).

---

## Konverze stacku na mesh — definice hotového

Cílový tvar (majitel 2026-07-30, potvrzeno 2026-08-21): **dovnitř jen přes edge,
vnitřně VŠE v mesh, izolovaně, pojmenované po instanci, pevně řízené.**

Verdikt „je stack na mesh" má **jednoho vlastníka**: `scripts/lib/mesh-conformance.mjs`.
Čtou ho brána `mesh-inside-edge-outside` (ráčna nad baseline) i generátor baseline.
Konformní stack má:

1. službu `netbird-agent` — peer instance ve VLASTNÍM netns (bridge mode),
2. službu v jeho netns (`network_mode: service:netbird-agent`) — `<stack>-mesh-ingress`,
   který příchozí mesh provoz rozvádí podle `<ID>_MESH_INGRESS_ROUTES`.

Směrovací tabulku **vydává derivace z katalogu** (`internal_url` + `internal_endpoints`),
ne ruka. Přidání služby do katalogu změní proměnnou a ingress se přenastaví při
dalším nasazení.

```bash
node scripts/mesh-conformance-apply.mjs            # plán: kdo chybí a co dostane
node scripts/mesh-conformance-apply.mjs --write    # vloží bloky z KANONICKÉHO compose
bash scripts/preflight-compose.sh                  # každý compose se musí vyrenderovat
node scripts/gen-mesh-conformance-baseline.mjs --write
npm run test:gates
```

Bloky se **nekopírují** — čtou se za běhu z `docker-compose.coolify-model.yml`
(routes-driven varianta, kterou brána `mesh-ingress-one-generator` porovnává se
`scripts/gen-mesh-ingress.mjs`). Parametrizuje se jen jméno stacku, placement
(setup key, `NB_HOSTNAME`), porty z katalogu a sítě cílových služeb.

**Výjimky se deklarují v katalogu, ne jménem v kódu:** `mesh_bootstrap_dependency: true`
(+ `_comment_mesh`) = služba je předpokladem enrollmentu a na mesh stát nesmí.
Dnes jediná: Keycloak (chicken-and-egg 2026-07-16; majitel 2026-08-19 — kdo ho
potřebuje zevnitř, jde napřímo kontejnerovou sítí, `KEYCLOAK_INTERNAL_URL`).

**Známé mezery (přiznané, ne skryté):** služba bez HTTP portu (clamd, TCP 3310)
dostane agenta i ingress, ale ingress nemá co rozvádět — příchozí TCP přes mesh
potřebuje TCP passthrough v netns agenta a deklaraci TCP endpointu v katalogu.

**Nouzová větev musí poslouchat tam, kam se ptá health.** Když je směrovací
tabulka prázdná, Caddy schválně poslouchá jen na `/__mesh_health` a vrací
`no-routes` 503 — aby bylo VIDĚT, že tabulka chybí. `mesh-conformance-apply.mjs`
do 2026-08-31 přepisoval port jen v healthchecku, ne v tomhle nouzovém
Caddyfilu: healthcheck se pak ptal na skutečný port služby, zatímco nouzový
poslech zůstal na portu kanonického vzoru (`:8000`). Místo navrženého 503 přišlo
`connection refused` — diagnostika mlčela právě ve chvíli, kdy měla mluvit.

Naměřeno 2026-08-31: neshoda v **15 z 16** stacků. Jediný, kde porty seděly, byl
kanonický `model` — jeho vlastní port JE 8000, takže se vzor trefil sám sebou.
Šablona nesoucí svou konkrétní hodnotu projde testem proti sobě vždy; ověřit ji
lze jen na kopii, která se tou hodnotou liší.

Generátor je opravený, ale **existující soubory nepřepíše**:
`mesh-conformance-apply` sahá jen na stacky, které ještě nejsou na meshi
(`offenders` = `nonMeshStacks()`), takže už zmigrované si starý blok ponechají.
Náprava těch 15 je samostatný krok — a patří generátoru, ne ruce.

Na dostupnost to nemá vliv: s neshodou i bez ní je kontejner při prázdné tabulce
nezdravý. Mění se jen čitelnost příčiny.

**Jméno není routa.** Být na síti `mesh-dns` znamená, že se mesh jméno PŘELOŽÍ —
neznamená, že na tu adresu vede cesta. Služba, která má mesh jméno volat
(odchozí směr), potřebuje navíc `cap_add: NET_ADMIN` a routu z
`infra/mesh/mesh-client-route.sh`. Bez ní se jméno přeloží, spojení selže a
proces spadne — u kontejneru s restartem to skončí smyčkou a Coolify po
vyčerpání limitu zastaví CELOU aplikaci (bere `max()` počtu restartů přes
všechny kontejnery). Ingress řeší směr PŘÍCHOZÍ; odchozí je samostatná výbava.

---

## Související dokumenty

- [`docs/deploy/MULTI_SERVER_COOLIFY.md`](MULTI_SERVER_COOLIFY.md) — multi-server topologie
- [`coolify/manifests/netbird.manifest`](../../coolify/manifests/netbird.manifest) — Coolify deployment manifest
- [`docker-compose.coolify-netbird.yml`](../../docker-compose.coolify-netbird.yml) — control plane
- [`services/svc-agent-runner/src/broker-proxy.ts`](../../services/svc-agent-runner/src/broker-proxy.ts) — broker-proxy (jediná cesta ven ze sítě běhů)

---

## Peer discovery & Coolify env propagation

Mesh peer IPs are NOT stable identifiers — they're allocated by NetBird
Management at peer enrollment, and a re-enrolled peer may get a different
IP. Edge mesh-proxies on Frontend need to know e.g. the `core` peer's IP to
add a static `/etc/hosts` entry (because NetBird's embedded DNS proxy is
unreliable inside isolated container netns).

Pipeline:

```
scripts/netbird-peer-discover.mjs   →   stdin → coolify-mesh-sync.mjs
   (Keycloak M2M → /api/peers)         (PATCH Coolify envs/bulk on drift)
                  │
                  ▼
   CORE_MESH_IP=100.64.0.5
   EDGE_MESH_IP=100.64.0.6
   LEDGER_MESH_IP=100.64.0.7
```

### Operator commands

```bash
# Inspect current mesh state (read-only):
npm run mesh:discover                # KEY=value lines (sourceable)
npm run mesh:discover:json           # full peer JSON

# Reconcile Coolify env from current peers:
npm run mesh:sync                    # check (read-only)
npm run mesh:sync:apply              # apply (PATCH Coolify env)
```

### Required env

```
NETBIRD_API_URL=https://netbird.aisha.guru
KEYCLOAK_URL=https://auth.backend.id3a.cz
KEYCLOAK_REALM=aisha
NETBIRD_OIDC_CLIENT_ID=netbird-backend
NETBIRD_MGMT_SECRET=<from Keycloak / Coolify env>
# OR fallback: NETBIRD_AUTH_SCHEME=Token + NETBIRD_API_TOKEN
```

### Troubleshooting

- **Keycloak HTTP 401 invalid_client**: secret in Coolify env out of sync
  with Keycloak. Run `bash scripts/provision-sso.sh --keycloak-only`.
- **Empty peer list**: agents haven't enrolled. Check each stack's
  netbird-agent container logs and `NETBIRD_STACK_KEY_*` env vars.
- **Sync drift persists after --apply**: Coolify patched env but
  containers still use old values. Run
  `node scripts/aisha-redeploy.mjs --only=<app>`.
- **All peers `connected: false`** — systemic mesh failure. Two paths:
  - **Edge** uses public `https://netbird.aisha.guru` (LE cert) — check
    `docker logs aisha-edge-netbird` for management errors.
  - **Core/integration/ledger** use internal
    `https://netbird.mesh.aisha.internal:33073` (AISHA PKI cert). If
    `NETBIRD_INTERNAL_CERT_B64` is unset, Caddy generates a self-signed
    bootstrap cert that agents reject. Fix: issue cert via
    `bash scripts/pki-issue-internal-cert.sh netbird-mesh --auto-issue`.
- **Duplicate peer entries** (same hostname, different IDs): agent
  re-enrolls instead of reconnecting. Usually means the persistent volume
  was lost or the config is corrupt. Set `NB_FORCE_REENROLL=1` in Coolify
  env, redeploy once, then reset to `0`. Clean up stale entries via
  NetBird management API `DELETE /api/peers/{id}`.

### Functional peer naming (after Phase 2 rename)

Peer hostnames are role-based, not server-based:

| Functional | Mesh DNS | Coolify app |
|---|---|---|
| `core` | `core.mesh.aisha.internal` | aisha-core |
| `edge` | `edge.mesh.aisha.internal` | aisha-edge |
| `ledger` | `ledger.mesh.aisha.internal` | aisha-ledger |
| `integration` | `integration.mesh.aisha.internal` | aisha-integration |

A stack can relocate between hosts without renaming the peer.

## Public aliases for n8n / MCP

Two parallel `*.aisha.guru` routes serve the n8n orchestration backend
through the Frontend edge mesh-proxy:

- `mcp.aisha.guru` — backward-compat for existing MCP integrations.
- `dirigent.aisha.guru` — new user-facing brand for the orchestration layer.

Routing is driven by Coolify `docker_compose_domains` (not manual Traefik
labels — Coolify strips those). Each domain maps to a separate service name:
`mcp-mesh-proxy` → `mcp.aisha.guru`, `dirigent-mesh-proxy` → `dirigent.aisha.guru`.
Both share netbird-edge's network namespace, so port 8080 (Caddy) is reachable
on either. `dirigent-mesh-proxy` has no healthcheck by design — Traefik always
routes to it even when netbird-edge is temporarily unhealthy.

Contract source of truth: `scripts/coolify-domain-doctor.mjs`.
Gate test: `src/tests/gates/dirigent-domain.gate.test.ts`.
