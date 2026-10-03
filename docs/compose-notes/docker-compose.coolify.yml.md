# docker-compose.coolify.yml — notes

Prose extracted from `docker-compose.coolify.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-v2-common: &v2-common`

=============================================================================
docker-compose.coolify-v2-core.yml — AISHA v2 Core (Coolify + Traefik)
=============================================================================

Reduced-size variant of v2 stack to avoid Coolify helper argv limit.
Keeps core Supabase-free runtime: PG17 + PostgREST + Gateway + Web + pgAdmin.
Optional domain microservices are intentionally excluded here.

## `PKI_BRIDGE_URL: ${PKI_BRIDGE_URL:-}`

Referenced so coolify-sync-envs pushes it → assemble-ca-bundle.sh fetches
the LIVE realm CA (baked-bundle fallback if the bridge isn't up yet).

## `command: ["/usr/local/bin/assemble-ca-bundle.sh"]`

Assemble mesh trust bundle; baked in Dockerfile.pki-init (shared by 3 stacks).

## `target: mc`

MinIO i `mc` se STAVÍ ZE ZDROJE — `docker/minio/Dockerfile`, kontext je jen ten
adresář. Obrazy z registrů neexistují: repozitáře `minio/mc` i `minio/minio` na
Docker Hubu zmizely 2026-09-11 (okno z logů nasazení: 09-10 20:24
`Image minio/mc Pulling → Pulled`, 09-11 22:38 `pull access denied`; jádro
instance bylo 12 hodin mimo provoz, protože compose je jeden celek), a
`quay.io/minio/{minio,mc}`, kam jsme přešli, vrací od 2026-09-24 `401` i
s anonymním tokenem. Repozitář MinIO CE je archivovaný.

Plán A (majitel, 2026-09-25): každý fork staví obraz ve SVÉ Coolify pipeline
z Go module proxy (`proxy.golang.org`, zip ověřený `sum.golang.org`) — bez
přístupu k našemu repu i registru. Verze jsou PŘESNĚ dosavadní
(`RELEASE.2025-09-07T16-13-09Z` server, `RELEASE.2025-08-13T08-35-41Z` mc),
ldflags jako upstream vydání (`minio --version` hlásí RELEASE, ne DEVELOPMENT).
Jediný domov pinů je Dockerfile (výchozí ARG + digesty ve FROM); hlídá brána
`minio-obraz-ze-zdroje`.

⛔ BEZ `image:` — stavěná služba s vlastním tagem se z build serveru na cíl
nepřenese (Coolify přenáší jen `<uuid>_<služba>:<commit>`), viz
`docs/architecture/CORE_COMPOSE_ROZHODNUTI.md` › `db`.

Cíl `mc` nese klienta a `storage-init` — jediný vstupní bod správy úložiště
(viz sekce `minio-init` níž). `entrypoint: ["storage-init"]` přebíjí
upstreamový `ENTRYPOINT ["mc"]`.

## `target: minio`

Týž Dockerfile, cíl `minio`: server + `mc` (jako upstream obraz), prostředí,
`ENTRYPOINT` (upstreamový `docker-entrypoint.sh` ze zipu modulu), `VOLUME /data`
a `EXPOSE 9000` beze změny — `command: server /data --console-address :9001`
i svazek `minio-data` jedou dál. Běhový základ je `curlimages/curl` připnutý
digestem: healthcheck volá `curl`, a obraz se tak skládá jen z neměnných vstupů
(žádný balíčkovač při buildu). Běží jako root jako dřív — existující data vlastní root.

## `STORAGE_ADMIN_URL: http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@${APP_NAME_PREFIX:?identita instance}-minio:9000`

Táž hodnota jako dřívější `MC_HOST_local`: `storage-init` ji předá `mc` jako
`MC_HOST_local`. Výhoda proti `mc alias set`: žádné parsování argumentů
(heslo s úvodním `-` by mc četl jako přepínač). Jméno je obecné, aby náhrada
úložiště nemusela měnit deklaraci.

## `AISHA_IMPLEMENTATION_HOOK: ${AISHA_IMPLEMENTATION_HOOK:-scripts/deploy/instance-data-hook.sh}`

Private instance overlay (KB/expert rules) — applied AFTER platform
seeds by the hook (scripts/deploy/instance-data-hook.sh). URL unset =
community/platform-only install, hook no-ops. Hook failure = deploy red.

## `AISHA_PKI_ISSUER_CLIENT_SECRET: ${AISHA_PKI_ISSUER_CLIENT_SECRET:-}`

Operator/admin provisioning (docker-migrate-entrypoint.sh gate +
scripts/db/provision-operators.mjs) deliberately hard-lists NOTHING here.
Those keys carry roster PII and the master-realm admin password, and the
channel that delivers them is coolify-deploy-init.sh, which pushes each of
them straight onto the core app. Re-declaring them as `${VAR:-}` here would
add nothing (the app already has them) while putting a secret and operator
emails into a committed compose file — instance-data-provisioning.gate.test.ts
forbids exactly that, and matches on the raw text of this block, so do not
name those keys here either.
Pre-generated aisha-pki-issuer secret (generate-secrets.mjs). The in-cluster
`aisha-bootstrap-user-init.sh --issuer-only` step PUTs this exact value onto
the KC client, so the renewer's immutable env already matches it — breaks the
PKI-issuer chicken-and-egg without any operator-side KC tunnel. Unlike the
keys above this one is not roster PII and carries no value in git, so the
reference is safe here and the gate permits it.

KNOWN DEBT (not fixed here on purpose): secret-hygiene reports this as a
silently-empty default, and it is right — generate-secrets.mjs always
produces this value, so empty means the env push failed rather than "not
configured". Converting it to `:?` was tried on 2026-07-20 and REVERTED:
local-compose-gen renders this same file for `--preset full`, where the
secret legitimately does not exist, so fail-fast breaks every local dev
render (local-container-namespacing + local-warmup-idempotence). Fixing
it properly means teaching the local generator to supply or strip
deploy-only secrets — a separate change, not a one-line flip.

## `image: ${AISHA_DB_IMAGE:-aisha-db-pg17:local}` (historické — služba dnes staví z `infra/postgres`)

Tagged so the pgbackrest sidecar reuses this image (no 2nd build block).

## `NOCODB_DB_PASSWORD: ${NOCODB_DB_PASSWORD}`

Per-role passwords consumed by infra/postgres/{set-passwords.sh,entrypoint-wrapper.sh}.
All are required so role passwords stay in sync with consuming stacks.

## `pgbackrest:`

pgBackRest — WAL archiving + scheduled base backups (DB-03/PITR). Reuses the
pg17 image; loop in pgbackrest-backup.sh; socket-authed via pg-run; own repo vol.

## `build: &pgbackrest_build`

Shares db's reconcile-wrapped pg17 image (anchored build; one image, built once —
not a distinct in-place build). Never a bare pin → rotated pw re-applies (#611/#612).

## `postgrest:`

NOTE: the WP-1.3 `pgbouncer` transaction-mode pooler was REMOVED (2026-07-06) —
deployed but NEVER adopted (no service set PG_HOST=pgbouncer); every service pools
straight to `db`. Re-introduce only as a COMPLETE unit (SECURITY DEFINER
pgbouncer.get_auth + AUTH_QUERY/AUTH_USER + apps switched to PG_HOST=pgbouncer).

## `networks:`

Cross-stack DNS alias (see redis)

## `PGRST_OPENAPI_MODE: ${PGRST_OPENAPI_MODE:-disabled}`

OpenAPI introspection OFF for unauthenticated callers. The default
"follow-privileges" serves the full swagger at GET / to anyone — every
anon-SELECT table name/column/type + every RPC signature — pure
structure disclosure (rows stay protected by RLS/absent GRANT). The
platform is RPC-only (clients call rpc('fn') by explicit name; health
is admin :3001/ready), so nothing consumes the public description.
"disabled" => GET / returns 404 for every role; real endpoints unaffected.

## `PGRST_JWT_SECRET: ${JWT_SECRET}`

HS256 (HMAC) signed by JWT_SECRET — primary auth path (boots without
Keycloak). Service tokens are HMAC JWTs minted by aisha-cold-start.sh
from this secret; Keycloak RS256/JWKS is verified at the gateway layer.

## `networks:`

Cross-stack DNS alias (Coolify strips container_name). Core-internal only.

## `context: .`

Workspace-aware build (services/gateway/Dockerfile) — @aisha/* resolve via
npm workspaces (symlinks), no Verdaccio auth. Same as svc-mcp-knowledge.

## `DATABASE_URL: postgresql://authenticator:${POSTGRES_PASSWORD}@db:5432/postgres`

NOTE: master-realm admin credentials are deliberately NOT injected here.
routes/admin.ts authenticates with KC_ADMIN_TOKEN; nothing in services/gateway/src
reads KC_ADMIN_USER/KC_ADMIN_PASSWORD. Master admin holds rights over EVERY realm,
so it must not sit in the environment of the process that terminates untrusted
requests. Realm bootstrap runs from operator scripts (aisha-cold-start.sh,
aisha-bootstrap-user-init.sh), which read it from .env.coolify at invocation.

## `test:`

Use node (always present) instead of wget — some busybox variants
return non-zero exit for HTTP/2 or chunked responses even on 200.

## `networks:`

Cross-stack DNS alias (Coolify strips container_name, so the
`aisha-gateway` name every AISHA_GATEWAY_URL default points at never
resolves without it — svc-web-artifact's /seed-default died with
ENOTFOUND on idc-studio 2026-07-15). Same pattern as aisha-db /
aisha-postgrest. DO NOT also list `coolify` here: Coolify's transform
remaps `internal` to the shared coolify network, so an explicit empty
`coolify: {}` endpoint targets the SAME docker network and clobbers
the aliased endpoint at `docker compose up` merge time (observed on
idc-studio: deployed compose carried the alias, runtime had none).
Traefik still reaches it — internal==coolify after the remap.

## `container_name: aisha-svc-plugin-system`

No VERDACCIO_TOKEN: @aisha/* resolve via npm workspaces (registry-free).

## `AGENT_RUNNER_URL: ${AGENT_RUNNER_URL:-}`

svc-agent-runner is deployed separately on Experimental (docker-compose.coolify-exec.yml).
Reach it via Netbird mesh DNS.

## `context: .`

Context = repo root so @aisha/* resolve via npm workspaces
(registry-free; no VERDACCIO_TOKEN). Dockerfile stays beside the
service but uses root-relative COPY paths.

## `JWT_SECRET: ${JWT_SECRET:?required — generate-secrets.mjs emits it + coolify-sync-envs.sh bulk-pushes (mandatory cold-start step)}`

verifyServiceRole HS256-verifies POSTGREST_SERVICE_TOKEN above with this
shared secret (config.ts reads JWT_SECRET first); required to verify at all.

## `AITG_PROBES_SERVICE_URL: ${AITG_PROBES_SERVICE_URL:-http://svc-aitg-probes:3041}`

svc-mcp-knowledge's `aitg_run_test` MCP tool dispatches here. config.ts:52
already read this variable with exactly this default, but NO compose ever set
it — so the hop had no lever: on a spread farm there was no way to repoint it
at a mesh name without editing code.

The default stays a container alias on purpose. Internal routing is derived
from TOPOLOGY, not fixed to one form: colocated → alias over the shared
`coolify` network, spread → routable mesh name. `core` and `ai-chat` are both
`backend` role in coolify/manifests/aisha.manifest, so today they are
colocated and the alias is the correct class. The `${VAR:-…}` form is what
keeps ONE name in the code while the layer underneath it can change — same
shape as RAGNAROK_URL, KEYCLOAK_INTERNAL_URL and the SVC_MCP_KNOWLEDGE_URL
that svc-ai-chat uses to reach this very service.

Free against the ARG_MAX gate: `${VAR:-default}` substitutes to its literal
default at deploy time, so it does not count toward MAX_ENV_VARS.

## `svc-web-artifact:`

─── svc-web-artifact — HTML→GrapesJS converter + URL scraper + seed-default ─
Story-driven web design pipeline. Reads domains/ (RO volume) for default seed;
writes back via PostgREST RPCs (service_role JWT).

## `context: .`

Context = repo root so @aisha/* resolve via npm workspaces
(registry-free; no VERDACCIO_TOKEN). Dockerfile stays beside the
service but uses root-relative COPY paths. See
ADR_HERMETIC_SERVICE_BUILDS.md.

## `AISHA_SEED_DOMAIN: ${AISHA_SEED_DOMAIN:-}`

Folder-name == domain convention for /seed-default: when set AND a
committed domains/templates/<value>/ exists (mounted via the RO volume
below), that design auto-seeds on boot; empty → neutral domains/default/.
Our own gitignored site ships via DB seed (export-web-seed) instead.

## `volumes:`

NO ./domains bind mount here (removed 2026-07-15): under Coolify the
relative source rewrites to /data/coolify/applications/<uuid>/domains,
which Coolify creates EMPTY (deploys run from ephemeral /artifacts) — the
RO mount then SHADOWS the image's baked /app/domains (templates + the
#425 operator design overlay) with nothing, so /seed-default reported
missing_html:index.html even for domains/default (idc-studio 2026-07-15).
The runtime image carries domains/ since #425 — the mount is redundant
everywhere and actively harmful under Coolify.

## `netbird-agent:`

─── NetBird agent — owns wt0 in its own netns (bridge mode) ──────────────
Uses bridge networking (own network namespace) to avoid conflicts with
any native NetBird daemon on the host. The sidecar `core-mesh-ingress`
shares this namespace and proxies inbound mesh traffic to local services
via the Docker network (same pattern as netbird-edge on Frontend).

## `depends_on:`

Gate on pki-init like every other consumer (local-ingest:145-147, potok:129-131).
Without this, core's agent can start before pki-init populates the trust bundle →
empty store → TLS verify to netbird-internal-tls fails → core never joins the mesh
(self-heals only on a later restart). Deterministic ordering closes that race.

## `extra_hosts:`

Agent reaches management via NETBIRD_MGMT_HOST:33073 (netbird-internal-tls
caddy sidecar, AISHA PKI cert → h2c to netbird-management:443) — bypasses
Coolify Traefik: no LE SNI mismatch, no NAT hairpin. extra_hosts pins it.

## `- netbird-frontend-data-v3:/var/lib/netbird`

H-N3: NetBird 0.70+ writes identity to /var/lib/netbird — persist it too (same
volume) or every restart re-enrolls → dup peers. See MESH_CUTOVER_RUNBOOK.md §1.

## `NB_SSL_TRUST_BUNDLE: /certs/pki/aisha-ca-bundle.pem`

Hardcoded (not ${...:-}): Coolify sends empty app-env so `:-` can't override →
empty trust. SSL_CERT_FILE is Go-native; pki-init fills it with LIVE realm CAs.

## `- "8080"`

Ports served by core-mesh-ingress sidecar in shared namespace.

## `test: ["CMD-SHELL", "if [ -z \"$$NB_SETUP_KEY\" ]; then exit 0; fi; ip -o addr show wt0 2>/dev/null | grep -qE 'inet 100\\.'"]`

Tolerant healthcheck: pending-bootstrap (empty key) → healthy (idle by design),
post-bootstrap (real key) → vyžaduje skutečné Management:Connected v netbird status.

## `core-mesh-ingress:`

─── Core mesh ingress — receives mesh traffic, proxies to local services ──
Sidecar sharing netbird-agent's network namespace (wt0 + Docker bridge);
edge stack's mesh-proxy connects here via WireGuard mesh on HTTP ports.

## `volumes:`

Extracted to sibling composes: svc-agent-runner → coolify-exec.yml;
Dozzle → coolify-monitoring.yml.

## `netbird-frontend-data-v3:`

Volume name bumped to v3 — see docker-compose.coolify-netbird.yml comment.

## `pgbackrest-repo:`

DB-03 PITR: backup repo (off PGDATA) + shared pg socket dir.

## `internal:`

`internal` and `coolify` both alias the external coolify network — services
avoid creating per-stack bridges (Docker default address pool exhaustion).


## `svc-web-artifact` → `build.args` (2026-08-10)

⛔ **Bez těchhle argů se designový overlay NIKDY nenasadil.**

`services/svc-web-artifact/Dockerfile` má `ARG AISHA_WEB_DESIGN_GIT_URL=` a větví
se na něm: prázdná hodnota znamená větev *„skipped — committed placeholder"*.
Tenhle compose ji ale nepředával — build blok měl jen `context` a `dockerfile`,
žádné `args:`. ARG byl proto při **každém** buildu prázdný.

Následek: instance měla designové repo nastavené v env (`AISHA_WEB_DESIGN_GIT_URL`)
a do obrazu se nikdy nedostalo. Build hlásil úspěch, protože přeskočení overlaye
je legitimní stav — community instalace bez značky ho tak má mít. Rozdíl mezi
„overlay nechci" a „chtěl jsem ho a nedotekl" nebyl z ničeho poznat.

⭐ Táž třída jako služba `web` v tomhle souboru: hodnota existuje, spotřebitel
existuje, a nikdo nespojil poslední článek.

Hlídá to brána `overlay-arg-dotece-do-buildu`: ARG, jehož PRÁZDNÁ hodnota funkci
tiše přeskočí (`[ -n "$X" ]` → else `skipped`), musí být v `build.args` každé
služby, která z toho Dockerfilu staví. ARG s bezpečným defaultem (`SKIP_I18N_CHECK`,
kde skip způsobí až vyplněná hodnota) se záměrně neměří.

`AISHA_WEB_DESIGN_SUBDIR` je podadresář repa, který je tou šablonou. Prázdný =
kořen (web v samostatném repu). Instance s JEDNÍM designovým repem tam dá např.
`web`, aby se do runtime obrazu nevezly zdrojáky jazyka (`rdl/`) a náhledy
komponent.


## `dns:` na službách core stacku — mesh resolver

Bez něj se z core nerozřeší ŽÁDNÉ `*.mesh.<tld>` jméno.

Změřeno 2026-07-29: core byl JEDINÝ stack bez `dns:` (23 ostatních ho má), takže
i `api.mesh.<tld>` odsud vracelo NXDOMAIN a všechno drželo na container aliasech
— tedy na ploché cestě, kterou segmentace zavírá. Ověřeno na stacku, který
resolver už používá: veřejná jména i aliasy fungují dál, takže přepnutí nic
neztrácí.

⚠️ Tenhle odstavec byl do 2026-08-10 zkopírovaný v compose souboru **šestkrát**
u každé služby zvlášť. Soubor se posílá jako argument příkazové řádky a soutěží
s ARG_MAX (brána `coolify-compose-compliance`, strop 35 000 B), takže duplikovaná
próza tam ubírá místo konfiguraci. V souboru zůstal jednořádkový odkaz sem.


## `redis` — healthcheck authenticates (2026-08-11)

`redis` runs with `--requirepass`, and the probe used to be an unauthenticated
`redis-cli ping`. That reply is `NOAUTH` — but **redis-cli exits 0 even when the
reply is an error**, so the probe PASSED regardless. A healthcheck that cannot
fail is worse than one that cannot pass: it reports a server nobody can
authenticate against as healthy, and the failure resurfaces later in whatever
depends on it, with no obvious cause.

(The sibling defect: `shared-redis` sets `user default off` in its ACL, where the
same probe could never pass — that one gate-blocked 23 apps. Same root, opposite
symptom.)

Two details in the one-line probe, both deliberate:

* `grep -q PONG` — the exit code alone is not a signal here, per the above.
* no `--no-auth-warning` — redis-cli therefore writes "Using a password with -a …
  may not be safe" to **stderr** on every interval. Accepted on purpose: this
  file is capped at 35 000 raw bytes (ARG_MAX) and upstream sits 109 B under it,
  so the longer, quieter forms (`--no-auth-warning`, or the `redis://` URI) do
  not fit. `grep` reads stdout, so the warning changes nothing but log noise.
  If the cap is ever relieved by the service extraction the size gate asks for,
  switch to the URI form and drop this note.

`REDIS_PASSWORD` is added to the service's `environment` because the probe runs
INSIDE the container — the `--requirepass ${REDIS_PASSWORD}` above it is
compose-level interpolation and never reaches the container's env. `langfuse-redis`
already had that declaration, which is why the identical probe works there.

## `dns:`

mesh resolver — viz compose-notes

## `dns:`

mesh resolver — viz compose-notes

## `ALLOWED_ORIGINS: ${ALLOWED_ORIGINS:-}`

CORS: gateway je služba, která ho pro api.<tld> VYNUCUJE — a jako jediná
ho nedeklarovala. `coolify-sync-envs.sh` posílá do Coolify jen PRŮNIK
(klíče v .env.coolify) ∩ (klíče, které compose jmenuje), takže hodnota,
kterou compose nezmíní, se k appce nikdy nedostane; v kontejneru zůstane,
co tam kdysi bylo. Ostatní stacky obojí deklarují (ai-chat, cosmos,
domain-services, realtime), core ne.

Naměřeno 2026-08-03: `derive-composites.sh` doplnil do SoT
`https://auth.<tld>` (PR #113), env-sync ho neposlal, a preflight z
přihlašovací stránky vracel 403 i po úspěšném nasazení — příznak provozu
tak zůstal na „zjišťuje se".

## `KC_ADMIN_CLIENT_ID: ${KC_ADMIN_CLIENT_ID:?KC_ADMIN_CLIENT_ID must be delivered by cold-start env (generate-secrets; the realm constant lives in keycloak/aisha-realm.json)}`

Servisní účet pro zakládání uživatelů z administrace (POST /admin/users/invite).
Vlastní klient, ne půjčený: rozsah je JEDEN realm a JEN uživatelé.
Secret VYRÁBÍ generate-secrets, takže prázdná hodnota tady neznamená
„operátor si tu funkci nepřeje", ale „push env do Coolify selhal" — a to
je infrastruktura, tedy PADÁ, ne 503. Kód gateway si 503 drží dál pro
běh mimo compose; tady je fail-fast, protože se ví, že hodnota má být.
Táž úvaha jako ::error:: × ::notfound:: v resolveru deploye (#102).

## `AISHA_SHARED_REDIS_URL: redis://core:${REDIS_PASSWORD_CORE}@${SHARED_REDIS_HOST:?required — derive-domains.mjs ho odvozuje ze SERVICE_ALIAS_PREFIX; coolify-sync-envs ho doručí}:6379`

Revocation set (DB 2) žije na SHARED redisu — odhlášení musí platit napříč
stacky, ne jen v tomhle. Bez téhle proměnné spadne @aisha/cache-redis na
default `redis://aisha-shared-redis:6379` BEZ credentials → shared redis
odpoví `NOAUTH Authentication required`, gateway (správně) přejde fail-open
— ale na KAŽDÉM autentizovaném requestu, včetně reconnect cyklu.
Změřeno na produkci 2026-07-30: log gatewaye plný `[ioredis] Unhandled
error event: ReplyError: NOAUTH`, sonda z kontejneru `REDIS FAIL po 144ms`.
Táž hodnota už byla u svc-mcp-knowledge — gateway ji jen nikdy nedostal.

## `dns:`

mesh resolver — viz compose-notes

## `dns:`

mesh resolver — viz compose-notes

## `PLUGIN_NETWORK_ALLOWLIST: ${PLUGIN_NETWORK_ALLOWLIST:-}`

Outbound reach for plugins. The sandbox is fail-closed: an empty list
means a plugin can call nothing at all, which is the correct default —
an instance opts a plugin's hosts in here, and each plugin is still
confined to its OWN manifest allowlist intersected with this one.

## `PLUGIN_RPC_WHITELIST: ${PLUGIN_RPC_WHITELIST:-}`

RPCs plugins may call, same opt-in shape.

## `dns:`

mesh resolver — viz compose-notes

## `dns:`

mesh resolver — viz compose-notes

## `args:`

Bez těchhle argů se designový overlay NIKDY nenasadil (viz compose-notes).

## `CORE_MESH_INGRESS_ROUTES: ${CORE_MESH_INGRESS_ROUTES:-}`

Směrovací tabulka z DERIVACE, ne z ruky: `port|host|cíl;…`.
Přidání služby do config/services.json změní tuhle proměnnou a ingress
se přenastaví při dalším nasazení — bez zásahu do compose.

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").

## `core-mesh-ingress: proč se matchuje na VÍC jmen`

RH je SEZNAM jmen oddělený čárkou. Jedna služba je dosažitelná pod
víc jmény podle toho, kudy se k ní jde: mesh jméno mezi uzly,
veřejná doména od klienta, a jméno upstreamu, na které edge PŘEPISUJE
hlavičku (`header_up Host mesh-router:3001`). Match jen na mesh
jméno znamenal 421 na vlastní veřejný provoz.


## Proza presunuta z compose (2026-09-04)

⛔ `docker-compose.coolify.yml` se posila na server JAKO ARGUMENT PRIKAZU a soutezi
s `ARG_MAX`; brana `coolify-compose-compliance` drzi strop 35 000 B. Core byl 823 B
pod nim jeste PRED pridanim cehokoli, takze kazdy dalsi radek byl blokujici.

Konvenci tenhle soubor uz mel (hlavicka `docker-compose.coolify-exec.yml`:
*carries configuration only*), jen se u core nedodrzovala.

⛔ PRESUNUTY JEN SKUTECNE YAML KOMENTARE. Komentar uvnitr blokoveho skalaru
(`command: |`) NENI metadata, ale OBSAH, ktery se nasazuje — prvni verze tohohle
presunu to nerozlisila a zmenila rendrovany compose. Detekce je v brane
`compose-nese-konfiguraci-ne-prozu`.

Overeno: `docker compose config` ma PRED i PO identicky otisk.

### `KC_ALLOWED_CLIENTS: ${KC_ALLOWED_CLIENTS:?složí ho aisha-env-doctor z deklarovaných OIDC klientů; chybí-li, je vada v DORUČENÍ}`

```
Komu brána věří při výměně KC tokenu za PostgREST JWT. Skládá to
`aisha-env-doctor` z DEKLARACÍ klientů (platformní realm + instanční
overlay); bez tohohle řádku by hodnota existovala v .env.coolify, brána
by ji vyžadovala — a `coolify-sync-envs` by ji NEDORUČIL, protože sync
posílá jen klíče, které compose zmiňuje. Naměřeno 2026-09-01.
```

### `SPA_DOOR_MODE: ${SPA_DOOR_MODE:-off}`

```
── Dveřník ────────────────────────────────────────────────────────────
⛔ Do 2026-08-31 sem NEVEDLA ŽÁDNÁ CESTA: `SPA_DOOR_MODE` nebyl v compose
ani v registru doctora, takže gateway padal na kódový default `off`
a dveře NEŠLO ZAPNOUT — ať se do `.env.coolify` napsalo cokoli.
Naměřeno v běžícím kontejneru: `SPA_DOOR_MODE=[]`.

`off` jako výchozí je záměr: instance, která dveře nechce, je nemá mít.
Zapnutí je rozhodnutí operátora (`measure` → ověřit → `enforce`).
```

### `GATEWAY_TRUSTED_PROXIES: ${GATEWAY_TRUSTED_PROXIES:?odvozuje derive-subnets.mjs, doručuje coolify-sync-envs}`

```
Kdo je „naše proxy“ při chůzi `x-forwarded-for` ZPRAVA. Do 2026-08-31
tu nebyl NIKDO a platil kódový default z config.ts, který znal jen
docker sítě — mesh skok se proto tvářil jako klient a dveře viděly u
KAŽDÉHO požadavku z internetu `ip=100.126.250.10 verdikt=closed`.
Hodnota se ODVOZUJE (scripts/lib/derive-subnets.mjs), tady se jen
doručuje; `:?` je stráž, ne fallback — bez doručení se nespustí.
```

### `plugin-publish-init`

```
── Pluginy do katalogu ─────────────────────────────────────────────────────
⛔ NAMĚŘENO 2026-09-02: `plugin_catalog` měl NULA řádků, přestože v repu leží
čtyři pluginy s platným manifestem. `plugins:build` ani `plugins:publish`
NEMĚLY VOLAJÍCÍHO — `dist/plugins/` vůbec neexistovalo. Následek: zdroj
`webdispecink-fleet` byl `is_active = true` BEZ vykonavatele, plánů nula,
tabulky flotily prázdné. `publish.mjs` přitom vznikl 2026-08-12 právě kvůli
téhle vadě — a bez spouštěče se vrátila.

⭐ Idempotentní: `submit_plugin` má `ON CONFLICT (slug) DO UPDATE` i
`ON CONFLICT (plugin_id, version) DO UPDATE`, takže smí běžet při KAŽDÉM
nasazení. Fork bez pluginů skončí ok a mlčí až po hlášce „není co publikovat".
Publikace pluginů do katalogu je krok NASAZENÍ, ne runbook.
Odůvodnění a incidenty: docs/compose-notes/docker-compose.coolify.yml.md
```

## `KC_ALLOWED_CLIENTS: ${KC_ALLOWED_CLIENTS:?složí ho aisha-env-doctor z deklarovaných OIDC klientů; chybí-li, je vada v DORUČENÍ}`

Proza: docs/compose-notes/docker-compose.coolify.yml.md

## `SPA_DOOR_MODE: ${SPA_DOOR_MODE:-off}`

Proza: docs/compose-notes/docker-compose.coolify.yml.md

## `SPA_REDIS_DB: ${SPA_REDIS_DB:-4}`

MUSÍ souhlasit se `svc-knock`, jinak gateway čte prázdnou mapu a v
`enforce` by zamkl VŠECHNY — týž default na obou stranách (4).

## `GATEWAY_TRUSTED_PROXIES: ${GATEWAY_TRUSTED_PROXIES:?odvozuje derive-subnets.mjs, doručuje coolify-sync-envs}`

Proza: docs/compose-notes/docker-compose.coolify.yml.md

## `SOURCE_API_URL: ${SOURCE_API_URL:-}`

Vnější zdrojová aplikace federace — TÁŽ proměnná, jakou už používá
svc-source-broker (docker-compose.coolify-source-broker.yml). Brána z ní
podává veřejné /public/community-count. Prázdné = schopnost chybí: routa
vrátí 503 s důvodem a počítadlo se nevykreslí. Adresa se NEHÁDÁ.

## `plugin-publish-init:`

Proza: docs/compose-notes/docker-compose.coolify.yml.md

## `POSTGREST_SERVICE_TOKEN: ${POSTGREST_SERVICE_TOKEN:?publikuje se servisní rolí}`

Stroj NAVRHUJE, člověk ZAPÍNÁ: podává se servisní rolí, plugin přistane
jako internal/submitted a zapne ho až admin. Heslo uživatele tu BÝVALO
a odešlo — viz docs/compose-notes/docker-compose.coolify.yml.md.

## `healthcheck:`

Init doběhne a skončí — zděděný healthcheck by ho označil `unhealthy`
a Coolify z toho udělá nezdravou appku. Týž tvar má `minio-init`.

## `GATEWAY_TRUSTED_PROXIES: ${GATEWAY_TRUSTED_PROXIES:-}`

TÝŽ seznam, jaký dostává gateway — jeden zdroj (`lib/derive-subnets.mjs`).
Bez něj Caddy `x-forwarded-for` přepíše a klientská adresa se ztratí.


### `AISHA_POSTGREST_URL` u `plugin-publish-init` (2026-09-06)

Próza přesunutá z compose — v souboru zůstal jen ukazatel.

⛔ NAMĚŘENO 2026-09-06 v RIQ produkci. `plugin-publish-init` končil kódem 1 při
KAŽDÉM nasazení: „3 zabaleno · 0 publikováno (`fetch failed`)". Následek doložen
v databázi — `plugin_catalog` i `plugin_versions` měly NULA řádků. Nikde to
nesvítilo: init kontejner smí selhat, aniž shodí stack, a appka zůstala
`running:healthy`. Je to týž konec jako 2026-08-12 a 2026-09-02 (viz sekce výš),
jen jinou cestou — tam chyběl spouštěč, tady dostal spouštěč vadnou adresu.

Vada byla v jediné hodnotě. Nasazovací `AISHA_POSTGREST_URL` veze
`https://<prefix>-api.mesh.<tld>` — adresu pro stanoviště ZVENČÍ. Z tohohle
kontejneru je vadná třikrát najednou:

1. **jméno se nepřeloží** — `docker-compose.coolify.yml` síť `mesh-dns`
   nedeklaruje (na rozdíl od ostatních stacků), takže ani služby, které o
   resolver žádají přes `dns:`, k němu nemají cestu; naměřeno `EAI_AGAIN`,
   resolver z `NETBIRD_DNS_IP` leží na síti `<prefix>-mesh-dns`, kde core
   nemá ani jeden kontejner;
2. **port nesedí** — mesh ingress servíruje `-api` na `:3001` a `-postgrest`
   na `:3000`, na 443 nikdy;
3. **míří jinam** — `-api` je API gateway, ne PostgREST.

⭐ ŘEŠENÍ: adresa souseda na téže síti se ODVOZUJE z identity instance, týmž
idiomem jako `S3_ENDPOINT` o řádek výš — `http://${APP_NAME_PREFIX}-postgrest:3000`.
Hlavička `publish-plugins.sh` říká „publikace MUSÍ běžet tam, kde ta jména něco
znamenají"; init sedí vedle PostgREST na sdílené síti instance, takže mesh je
odsud oklika, ne cesta dovnitř.

Doloženo koncem řetězu: s odvozenou adresou vydal týž obraz `3 publikováno ·
0 chyb` a katalog má 3 řádky `submitted/internal` (stroj navrhuje, člověk zapíná).

Hlídá `src/tests/gates/publikace-pluginu-odvozuje-adresy-souseda.gate.test.ts`
— mutačně ověřeno: vrácení hodnoty na tvar z prostředí shodí 2 ze 3 tvrzení.

⚠️ NEVYŘEŠENO a hlášeno zvlášť: chybějící síť `mesh-dns` v core compose je vada
sama o sobě — šest služeb tam žádá `dns: ${NETBIRD_DNS_IP}`, ke kterému nemají
cestu. Navíc mesh cesta DO core nenese provoz ani z peeru, který překlad má
(spojení na `<mesh IP core agenta>:3001` vyprší), takže to není jen otázka DNS.

### `plugin-publish-init` čeká na `migrate` (2026-09-07)

⛔ NAMĚŘENO v RIQ produkci, den po opravě adresy. Nasazení přineslo opravenou
funkci `submit_plugin` (zapisuje všech šest spec sloupců) — a `source_spec`
v katalogu přesto zůstal NULL. Funkce v databázi přitom UŽ NOVÁ BYLA.

Rozhodlo pořadí. `plugin-publish-init` měl `depends_on` jen na `db:
service_healthy`, takže startoval souběžně s `migrate`:

```
migrate              … 03:54:37,88
plugin-publish-init  … 03:54:38,15
```

Publikace tedy zapisovala přes STAROU funkci. Doloženo koncem řetězu: týž obraz
spuštěný o pár minut později — kdy už heals doběhly — `source_spec` zapsal
u všech tří pluginů, i se správnými namespacy.

⭐ TŘÍDA, NE JEDEN PŘÍPAD. „Databáze odpovídá" a „schéma je hotové" jsou DVA
různé stavy. Každý konzument schématu v nasazení musí čekat na DOKONČENÍ
migrace, jinak ho každá změna schématu z téhož nasazení mine — a mine ho TIŠE,
protože init smí selhat, aniž shodí stack, a appka zůstane `running:healthy`.

⭐ IDIOM UŽ EXISTOVAL: `gateway`, `svc-plugin-system`, `svc-web-artifact`
i `netbird-agent` na `migrate: service_completed_successfully` čekají. Publikace
byla jediný konzument schématu, který ho nedodržoval — nebylo tedy co vymýšlet,
jen srovnat.

Hlídá `src/tests/gates/publikace-ceka-na-dokoncenou-migraci.gate.test.ts`
(mutačně ověřeno: odebrání závislosti shodí 2 ze 4 tvrzení).

## `PKI_BUNDLE_REQUIRED: ${PKI_BUNDLE_REQUIRED:-true}`

Bez nasazené PKI se vypíná POŽADAVEK na bundle, ne jen jeho adresa.
`infra/pki/assemble-ca-bundle.sh` má vlastní výchozí `true`, takže prázdná
`PKI_BRIDGE_URL` NESTAČÍ: skript čeká `PKI_BUNDLE_WAIT_S` (600 s) a skončí
exit 1; `migrate` na něm visí přes `condition: service_completed_successfully`,
takže padá celý core a s ním gate pro všechny aplikace ve vlnách 4+.

⛔ NAMĚŘENO 2026-09-04 na produkci forku (lean profil bez PKI): 19 z 25 compose
s pki-init tuhle proměnnou vůbec nepředávalo, takže platilo výchozí `true`
a KAŽDÝ profil bez PKI na tom spadl. Od té doby ji nese každý compose s pki-init.

Hodnotu ODVOZUJE `scripts/aisha-cold-start.sh` z manifestu příběhu: `app: pki:`
v manifestu ⇒ `true` (operátorská deklarace má přednost), jinak `false`. Do
`.env.coolify` jde vždy, proto ji ostatní compose (`docker-compose.coolify-*.yml`)
čtou se stráží `${PKI_BUNDLE_REQUIRED:?…}` — dosazený literál by hádal fakt
o světě (brána zadny-fallback-nad-identitou). Tenhle core compose zatím drží
původní `:-true` (ratchet téže brány; nesnižuje se rukou).

## `STORAGE_SCOPED_USER: ${INGEST_DROP_ACCESS_KEY}`

⛔ BEZ `:?` — fail-closed uvnitř `environment:` si hodnotu VYNUTÍ DO BUILDU
(Coolify pošle env i jako --build-arg → tajemství v `docker history`; `minio-init`
je od 2026-09-25 stavěná služba, takže to platí dvojnásob). Doručuje
coolify-sync-envs za běhu; nepřítomnost hlásí stráž ve `storage-init` (exit 64).

## `cap_add:`

Mesh lane: jméno BEZ routy se přeloží a nespojí — viz services/gateway/Dockerfile.

## `migrate:`

Publikace čte a zapisuje SCHÉMA, které staví `migrate`. Zdravá databáze
neznamená hotové schéma — viz compose-notes (závod naměřen 2026-09-07).

## `AISHA_POSTGREST_URL: http://${APP_NAME_PREFIX:?identita instance}-postgrest:3000`

Adresa SOUSEDA na sdílené síti — odvozená jako `S3_ENDPOINT` výš; próza v compose-notes.

## `profiles: ["mesh"]`

Mesh komponenta — bez meshe nemá co dělat. Profil "mesh" zapíná
coolify-deploy-init.sh podle MESH_ENABLED; hlídá brána mesh-profil-drzi.

## `profiles: ["mesh"]`

Mesh komponenta — bez meshe nemá co dělat. Profil "mesh" zapíná
coolify-deploy-init.sh podle MESH_ENABLED; hlídá brána mesh-profil-drzi.

## `minio-init` — `storage-init`: deklarace úložiště, sdílený drop ingestu a scoped klíč

Od 2026-09-25 compose deklaruje jen CO, skript `storage-init` (v obrazu, cíl `mc`)
dělá JAK. Náhrada MinIO jiným úložištěm vymění obraz a skript jako celek;
deklarace zůstane:

| env | význam |
|---|---|
| `STORAGE_ADMIN_URL` | root pověření v URL (→ `MC_HOST_local`) |
| `STORAGE_BUCKETS` | buckety k založení (`mb --ignore-existing`, idempotentní) |
| `STORAGE_PUBLIC_READ` | podmnožina s anonymním čtením (`anonymous set download`) |
| `STORAGE_SCOPED_POLICY` / `_JSON` | jméno a dokument politiky omezeného klíče |
| `STORAGE_SCOPED_USER` / `_SECRET` | omezený klíč (`INGEST_DROP_*`) |

Buckety, které někdo OSLOVUJE, musí někdo ZALOŽIT — hlídá brána
`bucket-ma-sveho-zakladatele` (čte TUTO deklaraci přes `src/tests/gates/lib/storage-init.ts`).
`ingest-drop` je sdílený drop ingestu: engine do něj publikuje balíky, broker je
konzumuje (sidecary `ingest-drop-push` / `ingest-drop-pull`, rclone).

Klíč je SCOPED, ne root: sidecary dostanou právo pouze na `ingest-drop`. Politika
bez klíče nebo dokumentu je proto tvrdý pád (exit 64) — jinak by doprava balíků
musela sáhnout na root pověření. Klíč vydává `scripts/generate-secrets.mjs`,
doručuje `coolify-sync-envs`.

`mc admin policy create` i `attach` podruhé legitimně hlásí „už je tak", takže nesmí
padat — výsledek se místo toho ČTE ZPÁTKY (`mc admin user info`) a chybějící politika
je pád (exit 65). Založení bucketu a veřejné čtení naopak padají nahlas (`set -eu`):
dřívější inline skript bez `set -e` jejich chybu spolkl a skončil nulou.

## `core-mesh-ingress` — `trusted_proxies` a klientská adresa

⛔ NAMĚŘENO 2026-08-31: brána viděla `x-forwarded-for` s JEDINÝM prvkem — adresou svého
souseda (mesh-router edge). To je podpis NAHRAZENÍ, ne řetězu: Caddy bez `trusted_proxies`
příchozí hlavičce nedůvěřuje a přepíše ji tím, kdo se právě připojil. Každý náš skok tak
řetěz zahodil a klientská adresa se ke dveřím NEDOSTALA — `enforce` by zamkl i majitele.

Hodnota se NEOPISUJE: je to TÝŽ seznam, jaký dostává gateway (`lib/derive-subnets.mjs` →
`GATEWAY_TRUSTED_PROXIES`). Dva tvary (čárky pro env, mezery pro Caddy), jeden zdroj —
kdyby si je každý skládal sám, chůze zprava by v každém prvku končila jinde.

Nedoručený seznam se NEDOSAZUJE. Bez něj Caddy řetěz přepíše — to je vada, ale TICHÁ;
proto se aspoň řekne nahlas do logu.

## `netbird-agent` — stavový soubor po NetBird 0.70

NetBird 0.70 už nepíše `config.json`; stav si drží v `default.json`. Kontrola „agent si
pamatuje identitu" proto nesmí trvat na jednom jménu — stačí KTERÝKOLI stavový soubor.
Hlídá to brána `agent-si-pamatuje-identitu`; `NB_CONFIG_FILE` zůstává přepínačem pro
instalace, které si cestu drží jinde.

## `PG_MAJOR: ${POSTGRES_MAJOR:?}`

Major verze PostgreSQL je parametr INSTANCE: domov `config/image-versions.env`,
do `.env.coolify` ji zapíše env-doktor (`required-static`) a instance si ji drží.
Bez fallbacku — dosazená verze na existujících datech = výpadek. Změna u běžící
instance je dump/restore (`docs/deploy/POSTGRES_UPGRADE.md`);
`infra/postgres/entrypoint-wrapper.sh` nesoulad verze dat a obrazu odmítne.
`dockerfile:` chybí záměrně (výchozí `Dockerfile`) — core compose je těsně pod
limitem ARG_MAX (brána coolify-compose-compliance).

## `REGISTRY_PROXY: ${REGISTRY_PROXY:-}`

Bez něj šel build `db`/`pgbackrest` přímo na Docker Hub — změřeno 2026-09-14
z `docker history` produkčního obrazu (`REGISTRY_PROXY=` prázdné).

## `cap_add: [NET_ADMIN]`

Mesh routa gateway (služba `gateway`). Jméno BEZ routy se přeloží a nespojí — viz
`services/gateway/Dockerfile` (obraz nese `su-exec` + `iproute2`, entrypoint po
postavení routy shodí práva na `node`).

⛔ Naměřeno 2026-09-14 (výpadek přihlášení celé instance): blok vypadl při
slučování forku do upstreamu (`07805c921`, konflikt v compose). Gateway pak běžela
bez routy a jako root. `AISHA_SHARED_REDIS_URL` míří na MESH jméno (katalog
`internal_tcp_endpoints`), takže kontrola odvolání JWT čekala na Redis do timeoutu
a KAŽDÝ přihlášený požadavek skončil 401 po 10–20 s.

Tvar je kompaktní kvůli stropu velikosti compose (ARG_MAX): `$${VAR:?}` + `set -eu`
drží fail-closed — bez rozsahu peerů nebo při selhání `ip route` služba nenaběhne.
Hlídá brána `mesh-lane-miri-jmenem-ne-hopem` (vlastnost „mesh TCP jméno ⇒ routa"
nad všemi compose soubory, ne výčet služeb).

## `# Mesh routa — viz compose-notes.` (svc-mcp-knowledge)

`AISHA_SHARED_REDIS_URL` míří na mesh jméno sdíleného Redisu (katalog
`internal_tcp_endpoints`). Bez routy do rozsahu peerů se jméno přeloží a NESPOJÍ —
volání, která Redis potřebují, visí na timeoutu. Tvar je týž jako u gateway
výše: `cap_add: [NET_ADMIN]`, entrypoint jako root postaví routu a hned
`exec su-exec node`; obraz nese su-exec + iproute2 bez `USER node`.
`NETBIRD_DNS_IP` vkládá Coolify se všemi proměnnými aplikace.

Aby se to vešlo pod strop ARG_MAX (RAW 35 000 B), zkrátily se opakované hlášky
`${NETBIRD_DNS_IP:?…}` a `${MESH_TLD:?…}` (6× každá) na `:?generate-secrets` —
obojí vydává generate-secrets a doručuje coolify-sync-envs, vysvětlení žije tady,
ne v každém výskytu. Změřeno: 34 884 → 34 535 B raw, 31 681 B po dosazení.

## `KNOCK_ROSTER_TOKEN: ${KNOCK_ROSTER_TOKEN}` (gateway)

`/internal/knock/roster` — roster schválených tabletů pro dveře, s vlastním tokenem
dvojice gateway × svc-knock (ne se sdíleným INTERNAL_API_KEY). Token generuje
`generate-secrets.mjs`, takže prázdná hodnota znamená selhaný push env, ne vypnutou
funkci.

⛔ HOLÉ `${…}`, NE `:-` ANI `:?` (naměřeno 29. 9. na pushi kola 12):
- `:-` = tichý prázdný token (brána Compose Secret Hygiene);
- `:?` v `environment:` si hodnotu vynutí do BUILDU — Coolify ji pošle jako
  build-arg a zapeče do `docker history` (rohatka build-time-mnozina-vsech-compose
  vzrostla 12 → 13).

Selhat nahlas tedy nemá parser compose, ale doručení: klíč je v kontraktu
`aisha-env-doctor.mjs` (druh `secret`, min. 32 znaků), takže ho `coolify-sync-envs.sh`
po zápisu zpětně přečte a chybějící nahlásí. A gateway je fail-closed i tak:
prázdný token = `503 roster_nenastaven`, roster se nevydá nikomu.

## `KNOCK_UPSTREAM: ${KNOCK_UPSTREAM:-}` (gateway)

`/auth/v1/device/enrol` (a relace tabletu) pustí požadavek jen z adresy, kterou právě
otevřely dveře (svc-knock `/dvere`). ⛔ Bez téhle řádky gateway KNOCK_UPSTREAM NEDOSTANE
(compose je jediná cesta do kontejneru) → `dvereOtevrene('')` = false → ohlášení vždy
403 `dvere_zavrene` a žádný tablet se v administraci neobjeví (naměřeno riq 29. 9.).
Hodnotu odvozuje derive-domains z topologie, doručí ji coolify-sync-envs; prázdná
tam, kde dveře nejsou.

## `STORAGE_AUTH_URL: ${STORAGE_AUTH_URL:?…}` (gateway)

⛔ Naměřeno 2026-09-30 na riq: gateway ho vyžaduje od 2026-08-05 (42af539b2, „fotka z terénu má zapisovací
dráhu“ — `/functions/v1/upload-entity-evidence-preflight` míří na storage-auth), ale compose ho gatewayi
NEDEKLAROVAL. Coolify doručuje jen klíče, které compose zná, takže v kontejneru byl prázdný a každé nahrání
fotky z předání skončilo „gateway unhandled error — STORAGE_AUTH_URL není nastavené“. Fronta na tabletu pak
visela na „odesílá se“ a předání nedorazilo vůbec. Adresa se NEHÁDÁ (výchozí hodnota by na sdíleném hostiteli
ukázala na storage-auth jiné instance); vydává ji derive-domains, doručuje coolify-sync-envs — stejně jako u realtime.


## web nenese alias `<prefix>-imgproxy` (2026-09-30)

- Alias cíle mesh trasy `imgproxy:8080` byl omylem (07da0ca43) i na službě web;
  Docker DNS pak mesh-ingressu jádra vracel web (nginx :80). Alias patří jen
  imgproxy. Třída vady a brána: compose-notes domain-services, oddíl „netbird-agent
  nenese alias cíle trasy“.

## `KNOCK_UPSTREAM: ${KNOCK_UPSTREAM:-}` (gateway)

Dveře (svc-knock). Gateway ho čte v lib/najem-adresy.ts (prodloužení nájmu adresy otevřené zaťukáním). ⛔ Bez téhle řádky ho gateway NEDOSTANE — compose je jediná cesta do kontejneru — a prodlužování je tiše vypnuté (naměřeno 2026-09-29; na riq tím navíc padalo ohlášení tabletů). Hodnotu odvozuje derive-domains z topologie (prázdná tam, kde dveře nejsou), doručí coolify-sync-envs.

## `STRIPE_SERVICE_URL: http://${APP_NAME_PREFIX:?identita instance}-svc-stripe:3010` (gateway, jména *_SERVICE_URL)

⛔ Jména MUSÍ být ta, která gateway čte (routes/functions.ts → vyzadovanaAdresa). Do 2026-09-29 tu stála SVC_*_URL, kód četl *_SERVICE_URL → proměnná nedorazila a 12 funkcí (stripe, push, blockchain, fio, ha, github, health-ai, livekit, comms, packeta, plugin, web-artifact) vracelo 500. Hlídá brána sluzba-cte-compose-deklaruje.
