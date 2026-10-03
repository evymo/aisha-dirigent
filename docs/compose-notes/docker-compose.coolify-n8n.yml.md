# docker-compose.coolify-n8n.yml — notes

Prose extracted from `docker-compose.coolify-n8n.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-n8n-mesh-client: &n8n-mesh-client`

Cesta n8n (main + worker) DOVNITŘ meshe — sdílená kotva, obě služby ji
slučují (`<<: *n8n-mesh-client`).

⛔ NAMĚŘENO 2026-09-14 (<fork>). Workflows se na API nespojily ze DVOU
nezávislých důvodů a oprava potřebuje oba:

1. **Routa.** `dns: ${NETBIRD_DNS_IP}` přeložil `…-api.mesh.<tld>` na mesh IP
   jádra (100.112.x), ale netns n8n neměl routu do rozsahu peerů → default
   brána dockeru → hostitel → LAN → `UND_ERR_CONNECT_TIMEOUT`. `netbird-agent`
   tohoto stacku je záměrně „inbound only" (sdílí netns s `n8n-mesh-ingress`),
   odchozí cestu n8n nikdo nestavěl.
2. **Adresa.** `AISHA_API_URL=https://${API_DOMAIN}` a ruční
   `AISHA_POSTGREST_URL` z trezoru mířily na `https://<mesh jméno>` = port 443.
   Mesh-ingress jádra poslouchá **jen http :3001** a směruje podle Host
   (holá IP → 421, TLS → „wrong version number"). Změřeno ze sítě mesh-routeru:
   443 zavřený, `http://…:3001/health` → 200.

Tvar opravy:

- Jádro routy je kopie `infra/mesh/mesh-client-route.sh` (blok `_mesh=…esac`;
  shodu hlídá `mesh-lane-miri-jmenem-ne-hopem`) s JEDINÝM rozdílem: kanon píše
  `${MESH_ENABLED:-false}`, n8n `${MESH_ENABLED}`. Compose tu hodnotu deklaruje
  povinně (`:?`), takže fallback by byl mrtvý — a pravidlo „žádný fallback nad
  env" (brána `zadny-fallback-nad-identitou`) ho nepustí. Bez hodnoty skript
  díky `set -u` skončí nahlas. Lokální zrcadlo dodává `MESH_ENABLED=false`
  a `API_UPSTREAM_MESH` z `config/local-presets.mjs`.
  Druhý, nepodmíněný blok kanonického souboru se nepřebírá — n8n bez meshe
  nemá routu stavět.
- V mesh režimu `AISHA_API_URL` = odvozená lane `API_UPSTREAM_MESH`
  (derive-domains, `http://<mesh jméno jádra>:3001`), jinak zůstává
  `https://${API_DOMAIN}`. `AISHA_POSTGREST_URL` (čte ho 48 workflows) je
  vždy táž adresa — ruční hodnota z trezoru už se do kontejneru nepředává.
  Chybí-li lane při vyhlášené mesh, start končí `exit 64` (fail-closed).
- Práva: obraz `n8nio/n8n` běží jako `node`, nemá `su-exec` a BusyBox
  `setpriv` neumí `--reuid`. Kontejner proto startuje jako root jen na routu
  a hned `su -p … -- node` (zachová prostředí; `HOME=/home/node` nastaveno
  výslovně). `--` je nutné: BusyBox `su` jinak sežere argumenty n8n začínající
  pomlčkou (naměřeno na `--version`). `tini` zůstává PID 1.
- `argv[0]` `n8n-mesh-client` za skriptem je zástupce `$0` — díky němu
  `command: worker` dorazí jako `$1` a sdílený entrypoint obslouží main i worker.

`n8n-workflow-init` se neměnil: mesh DNS nemá a `AISHA_POSTGREST_URL` bez
`AISHA_POSTGREST_SERVICE_KEY` (žádný compose ho nepředává) nepoužije.

## `services:`

=============================================================================
AISHA n8n Stack — Workflow Engine + OAuth2 Proxy (Coolify Production)
=============================================================================
SSO Architecture:
  n8n OSS lacks native OIDC support.
  → n8n-auth (OAuth2 Proxy) authenticates via Keycloak SSO
  → Users with existing Keycloak session get seamless pass-through
  → Access controlled by 'n8n_access' realm role (synced from app permissions)

n8n connects to the main AISHA PostgreSQL database and communicates with
  - the AISHA backend gateway (${API_DOMAIN})
  - RabbitMQ for async events
  - Redis for queue state (n8n-redis)
edge functions via webhooks. Custom nodes from packages/n8n-nodes-aisha are
pre-installed via Docker image or bind-mount.

Required Coolify env vars:
  N8N_OIDC_SECRET, N8N_COOKIE_SECRET, N8N_DOMAIN, N8N_API_KEY,
  KEYCLOAK_DOMAIN, POSTGRES_PASSWORD, API_DOMAIN,
  AISHA_SERVICE_KEY

Optional:
  OPENAI_API_KEY, GOOGLE_AI_API_KEY, ANTHROPIC_API_KEY,
  LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY,
  AISHA_ACCESS_TOKEN, N8N_COMMUNITY_PACKAGES_REGISTRY, NPM_REGISTRY_URL

→ Coolify docker_compose_domains:
    <MCP_DOMAIN>      → n8n-auth:4180
    <DIRIGENT_DOMAIN> → n8n-auth:4180
  IMPORTANT: use service name with DASH ("n8n-auth") not underscore.
  docker_compose_domains keys are matched against compose service names
  verbatim — "n8n_auth" silently fails to bind on Coolify v4.x.
=============================================================================

## `n8n-config-init:`

---------------------------------------------------------------------------
n8n-config-init — writes n8n encryption config into persistent volume.
Prevents key drift when N8N_ENCRYPTION_KEY rotates but old config persists.
Also ensures volume ownership matches n8n runtime uid (node = 1000:1000),
jinak n8n padá na EACCES /home/node/.n8n/config (volume vlastní root).
---------------------------------------------------------------------------

## `n8n-nodes-init:`

Balíček `packages/n8n-nodes-aisha` sestavený z TÉHOŽ commitu (Dockerfile.n8n-nodes)
se před startem n8n zapíše do svazku `n8n-data` jako
`nodes/node_modules/n8n-nodes-aisha` (infra/n8n/doruc-uzly-aisha.sh). n8n
i n8n-worker na něj čekají (`service_completed_successfully`).

Proč právě tam: loader n8n 1.79.0 dává typům předponu balíčku
(`n8n-nodes-aisha.aishaRpc`, jak je čtou workflowy) jen balíčkům
z `<nodesDownloadDir>/node_modules` = `/home/node/.n8n/nodes/node_modules`,
a to leží ve svazku — vrstvu obrazu n8n by svazek překryl.
`N8N_CUSTOM_EXTENSIONS` (dřív tady) načítá s předponou `CUSTOM.` a mířil do
neexistující cesty; naměřeno 2026-09-17: n8n neznal žádný typ `aisha*`.

Výměna je atomická: nová verze se složí vedle, zkontroluje proti manifestu
`n8n` a teprve pak nahradí starou. Rozbitý balíček funkční nepřepíše.

## `n8n:`

---------------------------------------------------------------------------
n8n — Workflow engine (Dirigent Governor)
Internal-only — accessed through n8n-auth (OAuth2 Proxy).
---------------------------------------------------------------------------

## `- N8N_HOST=0.0.0.0`

── Server Config ──

## `- N8N_USER_MANAGEMENT_DISABLED=true`

── User Management (enabled — OAuth2 Proxy handles external auth) ──

## `- NODE_FUNCTION_ALLOW_BUILTIN=*`

── Custom Nodes ──

## `- EXECUTIONS_MODE=${N8N_EXECUTIONS_MODE:-queue}`

── Execution Mode (queue for production) ──

## `- RABBITMQ_URL=amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`

── RabbitMQ for AISHA Pipeline Events (mesh DNS, set Coolify env to override)

## `- DB_TYPE=postgresdb`

── Database Connection (main AISHA PostgreSQL) ──

## `- AISHA_API_URL=https://${API_DOMAIN}`

── AISHA Backend Integration ──

Výchozí adresa BEZ meshe. V mesh režimu ji entrypoint přepíše na
`API_UPSTREAM_MESH` — viz `x-n8n-mesh-client`.

## `- AISHA_ACCESS_TOKEN=${AISHA_ACCESS_TOKEN:-}`

── MCP & API ──

## `- OPENAI_API_KEY=${OPENAI_API_KEY:-}`

── LLM Provider Keys ──

## `- N8N_WEBHOOK_URL=${N8N_WEBHOOK_URL:-}`

── Self-tooling loop (WF_AISHA_*): PostgREST direct read, webhook dispatch,
   Forgejo committer. All values come from the n8n Coolify app env, which
   coolify-deploy-init.sh derives from canonical vars (AISHA_API_URL,
   SERVICE_ROLE_KEY, N8N_WEBHOOK_URL, FORGEJO_*). No hardcoding here. ──

## `- LANGFUSE_HOST=${LANGFUSE_HOST}`

── Langfuse Observability ──

## `- /var/run/docker.sock:/var/run/docker.sock:ro`

Docker socket: allows WF_PKI_CERT_ROTATION to do rolling docker restart

## `- ${NETBIRD_DNS_IP:-127.0.0.11}`

NetBird mesh DNS — resolves backend.mesh.aisha.internal for RabbitMQ

## `n8n-worker:`

NOTE: n8n is internal-only — accessed through n8n-auth (OAuth2 Proxy). It carries NO
Traefik labels and no router, so it is not exposed to the internet. It IS on the shared
coolify network (see the top-level `networks:` — `internal` aliases the external coolify
network), which is how it reaches sibling services such as svc-ai-chat:3011 for the
Flowboard provenance callback. "Not publicly routed" ≠ "not on the coolify network".

---------------------------------------------------------------------------
n8n Worker — executes workflow jobs from the queue
---------------------------------------------------------------------------

## `- N8N_WEBHOOK_URL=${N8N_WEBHOOK_URL:-}`

── Self-tooling loop (WF_AISHA_*) runs in the WORKER (queue mode) — these
   must be present here, mirroring the n8n service. Derived from canonical
   app env by coolify-deploy-init.sh; no hardcoding. ──

## `- ${NETBIRD_DNS_IP:-127.0.0.11}`

NetBird mesh DNS — resolves backend.mesh.aisha.internal for RabbitMQ

## `n8n-redis:`

---------------------------------------------------------------------------
Redis — Queue backend for n8n (Bull queue)
---------------------------------------------------------------------------

## `n8n-auth:`

---------------------------------------------------------------------------
OAuth2 Proxy — OIDC auth gateway for n8n (no native OIDC in OSS)
Authenticates via Keycloak, proxies to n8n on internal network.
Access controlled by 'n8n_access' realm role (synced from app permissions).
---------------------------------------------------------------------------

## `extra_hosts:`

Resolve KC public hostnames internally via host bridge → Coolify
Traefik → KC. Stays on host, no pfSense round-trip.

## `OAUTH2_PROXY_OIDC_ISSUER_URL: https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}`

── OIDC split-URL pattern: issuer for token matching, skip auto-discovery ──

## `OAUTH2_PROXY_COOKIE_DOMAINS: ${OAUTH2_COOKIE_DOMAINS}`

Multi-zone cookie support: service is reachable via both
<MCP_DOMAIN> (canonical public, via Frontend mesh-proxy) and
<N8N_DOMAIN> (direct on Backend Traefik). OAuth2 Proxy v7 picks the
longest-suffix-matching cookie domain per request host.

## `OAUTH2_PROXY_WHITELIST_DOMAINS: ${OAUTH2_WHITELIST_DOMAINS}`

No fixed redirect_url: OAuth2 Proxy derives callback from the incoming
Host so login works on <N8N_DOMAIN>, <MCP_DOMAIN> and <DIRIGENT_DOMAIN>.

## `OAUTH2_PROXY_SKIP_AUTH_ROUTES: "^/webhook/.*,^/webhook-test/.*,^/healthz,^/\\.well-known/.*"`

Skip oauth2 ONLY for paths that MUST be reachable from outside without a Keycloak
session. Threat model: what an EXTERNAL party can reach. The ENTIRE n8n admin API
(/api/v1/*) is now OAuth-gated on the public edge — NO /api/v1 skip:
 - internal service-to-service uses n8n:5678 over the docker network (never this
   proxy), so it needs no public skip;
 - the host-side cold-start verify degrades to trusting the in-cluster workflow-init
   (a non-interactive script can't do a browser login, and adding Bearer-token
   acceptance to the proxy would only WIDEN the surface — the opposite of the goal).
 So both /api/v1/credentials (the secret store) AND /api/v1/workflows are closed.
 - /webhook*    : external integrations legitimately call these directly (own auth).
 - /healthz, /.well-known : liveness + OIDC discovery.

## `- "caddy_0.handle_path.0_reverse_proxy=n8n-auth:4180"`

Frontend proxy is Traefik. Auto-gen Traefik routers from
docker_compose_domains target a service ID (`https-0-{uuid}-n8n-auth`)
that doesn't resolve to a healthy upstream for non-primary services.
We add explicit routers with priority=10000 reusing the manually
defined `n8n-auth-svc` (which works on ${N8N_DOMAIN}).

Coolify also auto-generates Caddy labels with `{{upstreams 4180}}`.
In case Caddy is the active proxy (proxy.type can change), override
the broken template with a literal container DNS name + port.

## `- "traefik.http.routers.n8n-direct-https.entryPoints=https"`

Two separate routers — single-router with `||` rule worked for
<N8N_DOMAIN> but not <MCP_DOMAIN> (Traefik may have a
subtle quirk with multi-Host rules + auto-gen router collision).
Both target the same n8n-auth-svc. Priority=10000 to outrank
auto-gen routers that target a non-resolving service id.

## `n8n-workflow-init:`

---------------------------------------------------------------------------
n8n Workflow Init — one-shot in-cluster bootstrap (key mint + WF_* deploy)

Reuses the Dockerfile.migrate image (node 22 + repo + deploy-workflows.mjs +
n8n/workflows/*.json). On every deploy it mints a public API key headlessly
via n8n's /rest/owner/setup → /rest/api-keys (the supported 1.79 mechanism,
since programmatic key creation is blocked from outside) and deploys the
workflows directly against http://n8n:5678. It talks to n8n ONLY on the
internal network — never through n8n-auth (oauth2-proxy) — so NO skip-auth
route is opened for key creation. Kroky: klíč → typy (overit-typy.mjs, zná
n8n vše, na co workflowy odkazují?) → credentials → workflowy → verdikt.
Selhání kroku = nenulový konec, ale ten nikdo nečte (restart "no", Coolify ho
do stavu aplikace nepromítne) — výsledek proto nese verdikt
(bootstrap-verdikt.mjs → log_integration_action), který čte cold-start.
---------------------------------------------------------------------------

## `- N8N_REST_URL=http://n8n:5678`

No secret material here: the bootstrap claims the seeded n8n owner with
a RANDOM in-process password (discarded immediately) and mints the key
in-cluster — so no owner password / API key / Coolify token is ever
passed in or stored. Owner identity is a non-secret account label.

## `- AISHA_API_URL=${API_UPSTREAM_MESH:?vydává topology resolver — https na mesh jméno API nikdo neobsluhuje}`

Init nemá wrapper `x-n8n-mesh-client`, proto adresu API dostává rovnou
z `API_UPSTREAM_MESH` (tatáž hodnota, na kterou wrapper přepisuje n8n).
Naměřeno 2026-09-17: `https://${API_DOMAIN}` = mesh jméno core na 443, kde
nikdo neposlouchá (ECONNREFUSED) — verdikt bootstrapu (`AISHA_POSTGREST_URL`)
se proto nikdy nezapsal. Brána: api-v-meshi-jen-pres-port-gateway.

── AISHA PostgREST credential bootstrap ──
deploy-workflows.mjs creates the aishaPostgrestApi n8n credential ("AISHA
PostgREST") if absent so the workflows' __REMAP__ refs resolve. Needs the
service key + gateway URL (the same canonical values the n8n service uses).

## `- FORGEJO_API_TOKEN=${FORGEJO_API_TOKEN:-}`

Bootstrap-only secrets (read once here to mint encrypted n8n credentials):

## `- /run/n8n`

Raw key material lands here only — never on a named volume.

## `internal:`

Both `internal` and `coolify` alias the external coolify network — avoid
per-stack bridges (Docker default address pool exhaustion).

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").

## `external: true`

EXTERNAL — zakládá ji táž warmup aplikace, se subnetem z MESH_DNS_SUBNET
(mesh-router si na téhle síti pinuje ipv4_address, takže rozsah musí být
náš, ne náhodný z Dockeru).

## `- POSTGREST_SERVICE_TOKEN=${POSTGREST_SERVICE_TOKEN}` (služba `n8n-workflow-init`)

Vstupy `scripts/n8n/provision-credentials.mjs` — pověření, na která workflowy
odkazují JMÉNEM. Init je od 2026-09-13 zakládá PŘED nahráním workflowů (dřív se
na cestě cold-startu nezakládala vůbec) a výsledek (klíč, credentials,
workflowy) zapíše jako verdikt přes `log_integration_action('n8n','bootstrap')`;
cold-start krok 6 ho čte.

Tajemství platformy (`POSTGREST_SERVICE_TOKEN`) je tu BEZ `:?`: strážné rozvinutí
by ho zapeklo do build metadat (brána `build-time-mnozina-vsech-compose`).
Prázdnou hodnotu hlídá místo použití (`n8n-deploy-entrypoint.sh`, fail-closed)
a verdikt ji ohlásí. Vstupy obsluhy (cizí API klíče, NocoDB, GitHub) smí chybět —
verdikt je vyjmenuje a souhrn cold-startu je vypíše jako „chybí vstup obsluhy".
