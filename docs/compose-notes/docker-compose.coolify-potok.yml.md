# docker-compose.coolify-potok.yml — notes

Prose extracted from `docker-compose.coolify-potok.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `services:`

==============================================================================
Coolify story: aisha-potok (Backend — verification-governed reasoning engine)
==============================================================================
potok is a verification-first solver: solve(capability, task) → gate-verified
result + provenance. It does NOT train in-process on the mesh — /learn/* maps
onto the stack's existing WF_FINE_TUNE_JOB lane (§W2b). Generation goes through
the pluggable backend registry (§W2.5-A): aisha_gateway (mesh default via
AISHA_OMNI_URL) / local_openai / mlx / mock — 0 serviceable backends = fail-loud.

Modeled on docker-compose.coolify-openclaw.yml (internal + public-behind-auth;
the public edge face + oauth2-proxy is W4 in docker-compose.coolify-prebuilt.yml,
so no Traefik host labels here).

Required Coolify env vars:
  POTOK_TOKEN          — bearer token API (min. 16 znaků; fail-closed bind, W2)
  POTOK_ALLOWED_HOSTS  — Host allowlist (typicky veřejná potok doména)
Optional:
  POTOK_GEN_BACKEND    — pin generation backendu (unset → availability probe)
  AISHA_OMNI_URL       — AISHA Omni /v1 face (default = core gateway in-cluster)
  AISHA_OMNI_KEY       — PAT pro aisha_gateway backend
  POTOK_CAPABILITIES   — capability allow-list (mesh default vypíná swe_fix —
                         network-deny sandbox je macOS-only, viz plán §W2)
==============================================================================

## `pki-init:`

─────────────────────────────────────────────────────────────────────────
pki-init — bakes the AISHA CA bundle into the pki-certs volume so the
netbird-agent (below) trusts the mesh management TLS + the aisha_gateway
generation backend (AISHA_OMNI_URL) validates over the realm CA. Baked into
Dockerfile.pki-init (shared by all mesh stacks); modeled on cosmos 1:1.
─────────────────────────────────────────────────────────────────────────

## `PKI_BRIDGE_URL: ${PKI_BRIDGE_URL:-}`

coolify-sync-envs pushes PKI_BRIDGE_URL so we fetch the LIVE realm CA
bundle (the baked one goes stale vs the running CA).

## `svc-potok:`

─────────────────────────────────────────────────────────────────────────
svc-potok — reasoning/verification daemon (no DB, no GPU on the mesh)
─────────────────────────────────────────────────────────────────────────

## `context: .`

Repo-root context (Coolify ARG_MAX pattern) — root Dockerfile.potok
COPYs packages/potok/ and pins the no-MLX service deps.

## `- POTOK_TOKEN=${POTOK_TOKEN}`

Authn: bearer token + Host allowlist (fail-closed non-loopback bind, W2)

## `- POTOK_GEN_BACKEND=${POTOK_GEN_BACKEND:-}`

Generation backend registry (§W2.5-A); unset = availability probe+select

## `- POTOK_CAPABILITIES=${POTOK_CAPABILITIES:-}`

aisha_gateway backend — AISHA Omni /v1 face; in-cluster core gateway alias
AISHA_OMNI_URL/KEY přidá W2 (generation-backend registry) i s generováním
a delivery cestou — do té doby běží mock lane a mrtvé secret-vars tu nejsou.
Capability allow-list (mesh deployment: document-verification lane,
swe_fix disabled — Linux nemá network-deny sandbox)

## `- REQUESTS_CA_BUNDLE=/certs/pki/aisha-ca-bundle.pem`

Python-native mesh trust — the aisha_gateway backend (AISHA_OMNI_URL over
the mesh) validates against the AISHA realm CA. Populated by pki-init.

## `- potok-data:/app/data`

harvest/provenance persistence (trajectories, learn runs, provenance)

## `- pki-certs:/certs/pki:ro`

AISHA CA bundle (read-only) — populated by pki-init; trusted by the
aisha_gateway generation backend's HTTP client (env vars above).

## `test: ["CMD-SHELL", "python -c 'import sys,urllib.request; r=urllib.request.urlopen(\"http://127.0.0.1:8080/health\", timeout=4); sys.exit(0 if r.status==200 else 1)' || exit 1"]`

127.0.0.1, NOT localhost: localhost může resolvovat ::1 first zatímco
server poslouchá jen na IPv4 — viz openclaw compose (FailingStreak 8000+).

## `netbird-agent:`

─── NetBird agent — mesh peer potok.mesh.<MESH_TLD> ───────────────────────
BRIDGE mode (own netns), NOT network_mode:host — the Backend host's
host-netns mesh slot is held by the core/integration agents, so this stack
joins in its own namespace (frontend-core pattern, docker-compose.coolify.yml).
The mesh-ingress sidecar shares this namespace and proxies inbound mesh
traffic to svc-potok over the coolify network.

## `- netbird-potok-data-v3:/var/lib/netbird`

NetBird 0.70+ persists agent identity in /var/lib/netbird — same volume
at both paths or every restart re-enrolls → duplicate peers (H-N3).

## `NB_SSL_TRUST_BUNDLE: /certs/pki/aisha-ca-bundle.pem`

Hardcoded (not ${...:-}): Coolify sends empty app-env so `:-` can't
override → empty trust. pki-init fills it with the LIVE realm CAs.

## `- "8080"`

Port served by potok-mesh-ingress sidecar in the shared namespace.

## `test: ["CMD-SHELL", "if [ -z \"$$NB_SETUP_KEY\" ]; then exit 0; fi; ip -o addr show wt0 2>/dev/null | grep -qE 'inet 100\\.'"]`

Pending-bootstrap (empty key) → healthy (idle by design); post-bootstrap
(real key) → requires wt0 to hold a 100.x mesh address.

## `potok-mesh-ingress:`

─── Mesh ingress — receives mesh traffic, proxies to svc-potok ────────────
Sidecar sharing netbird-agent's network namespace (wt0 + Docker bridge);
other mesh peers reach potok.mesh.<MESH_TLD>:8080 → here → the app.

## `pki-certs:`

AISHA PKI CA bundle — populated by this stack's pki-init (per-stack).

## `netbird-potok-data-v3:`

NetBird agent identity (WireGuard key, peer ID). Distinct per peer.

## `internal:`

Both `internal` and `coolify` alias the external coolify network (avoid
per-stack bridges); the svc-potok alias resolves for same-stack and
cross-stack consumers (orchestrator capability routing, gateway).

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
