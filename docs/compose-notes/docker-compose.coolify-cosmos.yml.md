# docker-compose.coolify-cosmos.yml — notes

Prose extracted from `docker-compose.coolify-cosmos.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-common: &common`

docker-compose.coolify-cosmos.yml

AISHA Cosmos App-Chain stack — deployed on Experimental server.

Single-validator private chain serving as:
- Immutable audit ledger for governance + AISHA tokens
- On-chain governance (x/gov proposals & voting)
- Token treasury management

NOT a public chain — not exposed to internet.
Edge functions reach it via aisha-network Docker network.

Server: Experimental (staging/AI, 4 CPU / 8 GB RAM / 80 GB disk)
Domain: None (internal-only, no Traefik)

Coolify UI setup:
- Docker Compose source: docker-compose.coolify-cosmos.yml
- Server: Experimental
- Environment Variables: COSMOS_SIGNER_MNEMONIC, CHAIN_ID
- No docker_compose_domains (internal-only)

## `pki-init:`

─────────────────────────────────────────────
pki-init — bakes AISHA CA bundle into pki-certs volume.
NetBird agent uses /certs/pki/aisha-ca-bundle.pem to trust the
AISHA PKI cert presented by the netbird-internal-tls caddy sidecar.
─────────────────────────────────────────────

## `PKI_BRIDGE_URL: ${PKI_BRIDGE_URL:-}`

Referencing PKI_BRIDGE_URL makes coolify-sync-envs push it here so we can
fetch the LIVE realm CA bundle (the baked one goes stale vs the running CA).

## `command: ["/usr/local/bin/assemble-ca-bundle.sh"]`

Assembles the mesh trust bundle (system roots + LIVE-or-baked AISHA realm
CAs). Baked into Dockerfile.pki-init so all 3 mesh stacks share one impl.

## `cosmos-node:`

─────────────────────────────────────────────
AISHA Cosmos Node — single-validator app-chain
─────────────────────────────────────────────

## `- "26657"`

CometBFT RPC (used by CosmJS from mobile for user-signed txs)

## `- "1317"`

LCD/REST API (used by edge functions for backend-signed txs)

## `- "9090"`

gRPC (for future service-to-service comms)

## `- "26656"`

P2P (not needed for single-validator, but exposed for future)

## `expose:` (cosmos-node)

⛔ HOSTITELSKÝ PORT RPC ODSTRANĚN (naměřeno 2026-09-16). `cosmos-node` publikoval
`${COSMOS_RPC_HOST_PORT:-26757}:26657` pro „rpc.aisha.guru přes Traefik na Frontendu".
Ta trasa neexistovala (`rpc.aisha.guru` → 404), katalog vede ledger jako `public: false`
a konzumenti (svc-blockchain) míří na alias kontejneru / mesh jméno. Port tedy nikdo
nepoužíval — jen blokoval: na sdíleném uzlu Experimental ho držela ledger jiné instance
a nasazení ledger guru padalo na „driver failed programming external connectivity".
Pravidlo platformy: veřejná tvář jde přes edge do mesh na službu, nic bokem (výjimka
jen UDP). Bude-li RPC pro mobilní peněženku potřeba, patří do katalogu jako veřejná
tvář přes edge, ne jako hostitelský port.

## `volumes:`

NOTE: 1317 (LCD/REST) intentionally NOT bound to host — it's
internal-only (edge functions reach it via Docker network).
Binding to host caused "port 1317 already allocated" on redeploy
when stale containers held the port (2026-05-22).

## `svc-blockchain:`

─────────────────────────────────────────────
svc-blockchain — on-chain dispatcher (Node/Fastify, port 3013).
The ONLY drainer of the blockchain outbox (retry_pending_blockchain_syncs →
RabbitMQ → WF_BLOCKCHAIN_SYNC → /ledger-sync); it signs + broadcasts to
cosmos-node via CosmJS. Co-located with the node so the dispatcher→chain hop
(cosmos-node:1317/26657) stays in-stack; it reaches the core data plane
(postgrest/rabbitmq/keycloak) cross-stack over the shared coolify network.
Internal-only — no Traefik, no public domain (like cosmos-node).
LEDGER-01: without this service deployed the outbox fills forever.
─────────────────────────────────────────────

## `LEDGER_ENABLED: ${LEDGER_ENABLED:-false}`

Ledger opt-out switch: the in-DB audit chain is unconditional; LEDGER_ENABLED
governs whether this dispatcher anchors on-chain. Empty signer = read-only.

## `POSTGREST_URL: ${POSTGREST_URL:-http://aisha-postgrest:3000}`

── Core data plane (cross-stack via container_name on the shared network) ──

## `KEYCLOAK_URL: ${KEYCLOAK_URL:-http://aisha-keycloak:80}`

── Identity (Keycloak) — verifies user tokens on governance-vote/claim ──

## `COSMOS_REST_URL: ${COSMOS_REST_URL:-http://cosmos-node:1317}`

── Cosmos chain (in-stack node) — shares the stack's signer + chain-id ──

## `ALLOWED_ORIGINS: ${ALLOWED_ORIGINS:-}`

── OWASP hardening (@aisha/security) ──

## `aliases:`

Cross-stack callers reach the dispatcher at http://svc-blockchain:3013.

## `netbird-agent:`

─────────────────────────────────────────────
Cosmos LCD Proxy — optional Nginx for REST API rate limiting
(can be enabled later if needed)
─────────────────────────────────────────────
cosmos-proxy:
  <<: *common
  image: cache.aisha.guru/library/nginx:alpine
  container_name: aisha-cosmos-proxy
  depends_on:
    cosmos-node:
      condition: service_healthy
  volumes:
    - ./cosmos/config/nginx-cosmos.conf:/etc/nginx/conf.d/default.conf:ro
  expose:
    - "8080"

---------------------------------------------------------------------------
NetBird Agent — Zero-Trust mesh peer for Experimental host
network_mode: host — shares Experimental's WG interface with cosmos-node.
Peer name: experimental-cosmos. DNS: experimental.mesh.aisha.internal
---------------------------------------------------------------------------

## `- netbird-experimental-data-v3:/var/lib/netbird`

NetBird 0.70+ persists agent identity in /var/lib/netbird/default.json,
NOT /etc/netbird. Mount the SAME named volume at both paths (edge
mesh-router pattern). Without this, every restart re-enrolls with a fresh
WireGuard key → duplicate peers → Signal rejects streams. See H-N3 in
docs/audit/2026-07-07-repo-audit-a-z.md.

## `extra_hosts:`

Internal mesh path (network_mode: host on Experimental) — connects to caddy
sidecar on Frontend:33073 with AISHA PKI cert.

NETBIRD_MGMT_HOST fallback uses Docker's `host-gateway` magic value
which resolves at container start to the bridge gateway IP — matches
the working pattern in docker-compose.coolify.yml (frontend-core agent,
line 709). Previously this used `${NETBIRD_MGMT_HOST:?...}` (required,
error if unset), which broke every deploy of the cosmos stack on a
fresh Coolify env where the operator hadn't manually wired the var.
Operator can still override with an explicit LAN IP in Coolify env
if the stack deploys to a different physical host than netbird-mgmt.

## `pki-certs:`

AISHA PKI cert bundle volume (populated by pki-init from baked CA).

## `netbird-experimental-data-v3:`

Volume name bumped to v3 — see docker-compose.coolify-netbird.yml comment.

## `internal:`

Both `internal` and `coolify` alias the external coolify network — avoid
per-stack bridges (Docker default address pool exhaustion).

## `KEYCLOAK_URL: ${KEYCLOAK_URL}`

Jde MESHEM, jako ostatní logika. Ledger běží na `experimental` placementu,
zatímco Keycloak na `backend` — docker alias hranici nodu nepřekročí,
kdežto mesh ano. A protože ledger NENÍ v bootstrap cestě (na rozdíl od
pki-bridge, který razí právě ten mesh certifikát), v okamžiku jeho běhu
mesh existuje. Dřívější `:-http://aisha-keycloak:80` default byl navíc
MRTVÝ: KEYCLOAK_URL vede aisha-env-doctor.mjs jako statický kontraktní
klíč, takže se do Coolify vždycky pushne a k `:-` se nikdy nedojde.

## `cap_add:`

Bridge mode, NE network_mode: host — vlastní netns, jak to má core,
local-ingest, potok i edge ("Bridge mode — own netns, no host daemon
conflict"). V hostitelském namespace agent NEMÁ vlastní wt0, vidí to
hostitelské: měřeno 2026-07-28 hlásily backend-integration i
experimental-cosmos TÉŽE rozhraní (ifindex 6083) a TUTÉŽ adresu
100.103.31.228, zatímco management DB jim přidělila různé
(.31.228 vs .15.146). Jeden agent vyhrál, druhý tiše jel na cizí
identitě. Ani jeden z těchhle dvou stacků nemá mesh-ingress, takže
hostitelský režim jim nic nedával — jen bral vlastní identitu.

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

## Alias `<prefix>-cosmos--node` patří cosmos-node, ne netbird-agentovi (2026-09-30)

- Cíl mesh tras 1317/26657 (`<prefix>-cosmos--node`) nesl jen netbird-agent, v jehož
  netns běží cosmos-mesh-ingress — ingress tak proxoval sám na sebe (na produkci
  forku naměřeno: jméno se v ingressu překládá na agenta). Alias přesunut na
  cosmos-node. Třída vady a brána: compose-notes domain-services, oddíl
  „netbird-agent nenese alias cíle trasy“.
