# docker-compose.coolify-extranet.yml — notes

Prose for `docker-compose.coolify-extranet.yml`. The compose file is passed to
Coolify as a command-line argument and competes with ARG_MAX, so it carries
configuration only.

## Why this stack exists

The extranet is the customer-facing surface: the workbench shell composed from
the stack's ready capabilities (`surface_blocks` + RPC + Keycloak).

It ran in Coolify long before it was a stack. Someone created it by hand as a
"dockerfile app", which works — and takes it out of everything that watches a
stack. Measured 2026-07-29: it appeared in **no** registry (`ALL_STACKS`,
cold start, redeploy waves, the service catalog, CI), so nothing deployed it.
It sat on a commit from the previous night while three PRs merged past it, and
no gate noticed, because "deployed" is not "current".

Hence this file: the extranet is a stack like every other one.

## `build.dockerfile: deploy/surface-host/Dockerfile`

The image is GENERIC — one surface host builds any shell for any instance:

```
SHELL_APP    which shell (workbench-shell, …)
INSTANCE_DIR which instance overlay it builds against
```

So this compose names no instance. That is the same rule the design language
follows: generic code, instance as data.

## `INSTANCE_DIR: instances/${AISHA_INSTANCE:?…}` and `EXTRANET_DOMAIN:?`

Both are `:?` — **no defaults on identity**. A compose that does not know which
instance it builds must fail, not guess. A default here would silently build
somebody else's surface, which is the exact failure this stack was added to end:
the pipeline used to resolve a hardcoded `aisha-core` and deploy another
instance's app.

## `SURFACE_OVERLAY_*` v `build.args` a `secrets: forgejo_token`

⛔ NAMĚŘENO 2026-09-13 (log Coolify nasazení extranetu): build.args
nesly jen `SHELL_APP`, `INSTANCE_DIR` a `REGISTRY_PROXY`. Dockerfile povrchu se
přitom VĚTVÍ na `SURFACE_OVERLAY_GIT_URL` / `_PATH` / `_REF` / `_CACHEBUST`
a spoléhal na to, že je Coolify vloží sám. Log: „Added 30 ARG declarations to
Dockerfile for service extranet" — a v RUN `if [ -n "" ]`, build z
`/app/instances/<jméno>`, ENOENT. Vložená deklarace není doručená hodnota;
doručí ji jen `build.args`. Proto jsou tu výslovně, stejně jako
`AISHA_WEB_DESIGN_*` u `svc-web-artifact` v `docker-compose.coolify.yml`.
`${VAR:-}` bez výchozí hodnoty: prázdno = instance overlay nemá (komunitní
install), a Dockerfile pak staví proti `INSTANCE_DIR`.

**Pověření nikdy v URL.** URL instančního repa nesla `oauth2:<token>@`
(naměřeno 2026-09-13 — token shodný s `FORGEJO_TOKEN`). Build arg končí
v `docker history` napořád, proto cold-start vydává `SURFACE_OVERLAY_GIT_URL`
BEZ pověření a token jde BuildKit secretem `forgejo_token` — tatáž dráha jako
u `svc-web-artifact` a `Dockerfile.keycloak`. Dockerfile URL s pověřením
odmítne. `FORGEJO_TOKEN` nesmí být build-time (hlídá
`build-time-mnozina-vsech-compose`, invariant 3) a do aplikace ho doručí
`coolify-sync-envs.sh` jako čtvrtý odvozený zdroj (klíče `secrets:
<id>: environment:`).

## The public host is EDGE's, not this container's

This service exposes port 80 on the internal network. Its public face
(`extra.<PUBLIC_TLD>`) is routed **by edge**, like `api` and `auth`:

```
config/services.json          extranet → subdomain "extra", public, tier optional
scripts/lib/derive-domains.mjs   emits EXTRANET_UPSTREAM_PUBLIC (guarded)
docker-compose.coolify-prebuilt.yml   edge Caddy route + Traefik router
```

Until 2026-07-29 the container carried its public domain (`extra.<PUBLIC_TLD>`) on
its own Traefik labels, so public traffic bypassed edge entirely — against the
"public = edge" routing rule.

The Traefik labels that remain here are the internal-zone face; the public
hostname is not among them.

## `extranet-auth` — nepřihlášený nedostane ani bundle

Do 2026-08-04 chránil extranet jen sám sebe: server vydal JS komukoli a teprve
appka v prohlížeči zjistila, že uživatel nemá token. Kdo se na bundle podíval,
přečetl si z něj strukturu sekcí i jména RPC, aniž by se kdy přihlásil.

`extranet-auth` je oauth2-proxy jako u sedmi ostatních chráněných povrchů
(`admin`, `n8n`, `pgadmin`, `monitoring`, `openclaw`, `prebuilt`, `pki`).
Veřejný Traefik router patří JEMU; `extranet` už žádný nemá a je dosažitelný
jen po vnitřní síti přes `OAUTH2_PROXY_UPSTREAMS: http://extranet:80`.

`OAUTH2_PROXY_SKIP_PROVIDER_BUTTON: "true"` je tu záměrně: proxy nesmí ukázat
vlastní mezistránku „přihlásit se přes…", ale poslat rovnou na Keycloak.

Žádné `SKIP_AUTH_ROUTES`. Výjimka je diagnostika, ne konfigurace — a `/ping`
si oauth2-proxy obsluhuje před autentizací sám, takže by stejně nic neodemkla.

Rozsah je zatím „kdokoli přihlášený" (`OAUTH2_PROXY_EMAIL_DOMAINS: "*"`, žádné
`ALLOWED_GROUPS`). Omezení podle pozice twinu je samostatný krok; role se do
tokenu už mapují (`OIDC_GROUPS_CLAIM: roles`), takže až přijde, bude kam sáhnout.

## Která doména kam — vnitřní × veřejná

Tady se dá snadno šlápnout vedle, protože obě proměnné vypadají zaměnitelně:

```
EXTRANET_DOMAIN        = extra.mesh.<MESH_TLD>   ← Traefik Host(): sem míří edge
EXTRANET_DOMAIN_PUBLIC = extra.<PUBLIC_TLD>      ← tohle vidí PROHLÍŽEČ
```

`OAUTH2_PROXY_REDIRECT_URL` a `redirectUris` klienta `extranet-proxy` v realmu
musí být **veřejné**: po přihlášení posílá prohlížeč sám sebe zpět a na
`*.mesh.<mesh-tld>` se nedostane. Traefik router naopak musí zůstat na
**vnitřní**, protože edge Caddy sem proxuje právě na ni
(`docker-compose.coolify-prebuilt.yml`, `@extranet host ${EXTRANET_DOMAIN_PUBLIC}`
→ `reverse_proxy ${EXTRANET_UPSTREAM}` s `header_up Host`).

Protože veřejný provoz teče přes edge na vnitřní jméno, stačilo přesunout
Traefik router na sidecar — edge tím míří na proxy, ne na statický host.
`OAUTH2_PROXY_REVERSE_PROXY: "true"` říká proxy, aby brala `X-Forwarded-*`,
které edge posílá.

## Odkud se berou tajemství

Řetěz je stejný jako u ostatních proxy a má čtyři články; vynechání kteréhokoli
se projeví až za běhu:

```
keycloak/aisha-realm.json         deklaruje klienta extranet-proxy (bez hesla)
scripts/generate-secrets.mjs      vyrobí EXTRANET_OIDC_SECRET + EXTRANET_COOKIE_SECRET
scripts/provision-sso.sh          nastaví heslo klienta v KC a přiřadí scope `groups`
scripts/lib/kc-client-secret.mjs  CLIENT_REGISTRY — aby drift uměl léčit i tenhle klient
```

`${EXTRANET_DOMAIN_PUBLIC}` v realmu navíc musí dorazit do prostředí KONTEJNERU
Keycloaku (`docker-compose.coolify-keycloak.yml`), jinak v realmu zůstane
literál `${EXTRANET_DOMAIN_PUBLIC}` a klient dostane neplatnou redirect URI.
Hlídá to brána `keycloak-realm-placeholders`.

## `tier: optional` / `provision_when_env: EXTRANET_ENABLED`

An instance that ships no extranet must still deploy. The catalog entry is
opt-in and every consumer guards on presence — the same shape as `realtime`,
whose absence would otherwise throw in the domain resolver.

## How to verify a deploy

Never by the colour of a CI job. A Coolify `/restart` re-runs the container on
the image it already has, so the job goes green while the artifact stays stale
(measured the same day, on `Deploy: Web`). Check the artifact:

```
docker ps --format '{{.Image}}' | grep _extranet   # image tag = the commit
curl -s https://extra.<tld>/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").
