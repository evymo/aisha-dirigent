# docker-compose.coolify-pki.yml — notes

Prose extracted from `docker-compose.coolify-pki.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `KEYCLOAK_INTERNAL_URL: ${KEYCLOAK_INTERNAL_URL:-http://aisha-keycloak:80}`

2026-07-20: the JWKS path is the CONTAINER ALIAS over plain HTTP, not a
routed hostname. The rationale above is right — it must be mesh-independent
— but KEYCLOAK_DOMAIN_DIRECT satisfied that only "via the hairpin", and the
hairpin does not work: dialing a public/front-served name from inside the
cluster leaves for the public IP and never comes back. Measured from this
very container (2026-07-20):
    https://${KEYCLOAK_DOMAIN_DIRECT}  → FAIL (cert mismatch, then 503)
    http://aisha-keycloak:80           → OK
The failure mode is exactly the one documented above for the mesh host:
JWKS fetch fails → jose cannot verify → every /v1/issue token is rejected
401 → no mesh cert is ever issued. The alias is mesh-independent AND
hairpin-independent AND needs no cert: signing keys are public data and the
hop never leaves the docker network. `aisha-keycloak` is a stable network
alias on the shared coolify network regardless of APP_NAME_PREFIX.

## `pki-server:`

ŽÁDNÁ sdílená síť. `pki-db` je čistě vnitrostackový (mimo tenhle compose
ho nic neodkazuje) — na sdílené `coolify` nemá co dělat.

PROČ (změřeno 2026-08-10): compose ke každé službě automaticky přidá alias
rovný jménu služby. Na sdílené síti si tak `pki-db` nárokoval i cizí
nájemník se stejně pojmenovanou službou a Docker DNS mezi nimi STŘÍDAL.
Zhruba půlka spojení OpenXPKI mířila do cizí databáze → přihlášení
odmítnuto → realm CA se nezaložila → pki-init fail-closed → core nenaběhl.
Navíc se tím naše přihlašovací údaje opakovaně posílaly cizí službě.

Bez `networks:` zůstane služba na per-app síti, kterou připojuje Coolify
(ověřeno: kontejnery jsou na ní i bez deklarace) — a tam je `pki-db`
jednoznačný, protože je v ní jen tenhle stack. pki-server ji tam potká.

## `interval: 120s`

(healthcheck `pki-server` a `pki-client` — `openxpkictl status server|client`)

⛔ NAMĚŘENO 2026-09-29 na produkčním uzlu, z cgroupy (`cpu.stat usage_usec`),
ne z okamžitého `docker stats` (ten ukázal „105 %" — to byl jen vzorek uprostřed
kontroly):

| | hodnota |
|---|---|
| jedno `openxpkictl status server` | **3,5–5,8 s CPU**, 4,3–6,5 s wall |
| `pki-server` průměr od startu (199 min) | **27 % jádra** (60s okna: 22–25 %) |
| dlouho běžící procesy (`openxpkid` main + watchdog) za tu dobu | ~40 s CPU z 3 241 s |
| `pki-client` průměr (táž kontrola `status client`) | 6 % jádra |

Perl při KAŽDÉM spuštění `openxpkictl` znovu načte a projde celý konfigurační
strom OpenXPKI. Docker počítá `interval` od KONCE předchozí kontroly, takže při
`15s` byla perioda ~20 s a čtvrtina jádra šla trvale jen na „jsem naživu". Démon
sám je v klidu téměř nečinný.

Vedlejší stopa: každá kontrola otevře spojení na socket démona a zavře ho, což
server loguje jako `FATAL OpenXPKI::Service::Default->init() failed:
…_CLIENT_READ_CLOSED_CONNECTION` (naměřeno ~1 řádek na kontrolu; zbytek do
7/min odpovídá `pki-webui` `/healthcheck/ping` à 15 s). Není to porucha, ale
plní `openxpki.log`.

Kontrola zůstává TÁŽ — readiness nad socketem démona (`stack-map` i
`depends-on-healthy` ji tak dál klasifikují). Mění se jen takt:

- `start_interval: 10s` — během `start_period` (180 s) se ptá rychle, takže
  `pki-client` (`service_healthy`) na zdravý server nečeká déle než dřív.
  Vyžaduje Docker Engine ≥ 25; uzel má 29.7, compose v5.4.
- `interval: 120s` — po startu stačí jednou za 2 min (cena klesne ~6×).
- `timeout: 30s` — 10 s bylo proti naměřeným 6,5 s na vytíženém uzlu těsné;
  timeout by pod zátěží vyráběl falešné selhání.
- `retries: 3` — 3 × ~125 s ≈ 6 min do `unhealthy` (dřív 30 × ~20 s ≈ 10 min),
  detekce výpadku se tedy nezhoršila.

## `AISHA_CA_NAME: "${AISHA_CA_NAME:-}"`

Identita CA — bez ní `pki-realm-bootstrap.sh` skončí na
  FATAL: cannot determine CA identity — set AISHA_CA_NAME / AISHA_OPERATOR_ORG (or APP_NAME_PREFIX)
a realm CA se NEZALOŽÍ. Změřeno 2026-08-10: všechny tři proměnné v
.env.coolify BYLY, ale tenhle compose nepředával ANI JEDNU (grep = 0),
takže `printenv` v pki-serveru vracel prázdno. Nebyla to chyba výroby
hodnot, ale jejich DORUČENÍ — a projevila se až o tři vlny dál, když
`pki-init` v CORE fail-closed čekal na realm CA, která nikdy nevznikla.
Bez fallbacku u identity: dosazené jméno CA by vydalo certifikáty znějící
na cizí subjekt.

## `PKI_BOOTSTRAP_JWKS: ${PKI_BOOTSTRAP_JWKS:-}`

Bootstrap runk pro multi-node: VEŘEJNÉ podpisové klíče realmu, doručené
pipeline místo stažené sítí. Rozsekává cyklus „token potřebuje JWKS →
JWKS potřebuje mesh → mesh potřebuje cert → cert potřebuje token".
Prázdno = runk nedoručen (čerstvý cold start před KC) — živá cesta je
primární vždy; doručuje scripts/pki-bootstrap-jwks-sync.mjs po wave 3.
Nejde o tajemství (public keys) ani o dosazenou hodnotu (prázdno ≠ odhad).

## `- ${PKI_BRIDGE_DOMAIN:?vydává derive-domains — alias MUSÍ být totéž jméno, které volá PKI_BRIDGE_URL}`

Bootstrap-safe name for PKI_BRIDGE_URL / the Traefik Host rule. Both derive
from PKI_BRIDGE_DOMAIN, which derive-domains.mjs deliberately pins to the
mesh-INDEPENDENT direct host ("pki-bridge is a mesh-BOOTSTRAP dependency:
it mints the mesh cert, so its canonical domain must never be the mesh
overlay"). Correct — but nothing ANSWERED that name, so pki-init got
NXDOMAIN and every consumer silently ended up with public roots only.

Same alias convention core already uses (aisha-db, aisha-postgrest).
Measured 2026-07-28: bridge served all three realm CAs and had received
zero requests; mesh-router retried `netbird up` 1489x on a bundle that
could not verify the mesh cert (Verify return code 21).

⛔ JEDEN DOMOV (2026-08-12). Tady stál literál `pki-bridge.backend.
${INTERNAL_TLD}`, zatímco Traefik Host rule o pár řádků níž i
PKI_BRIDGE_URL u volajícího braly `${PKI_BRIDGE_DOMAIN}`. Dokud se ta
dvě jména shodou okolností rovnala, nikdo si nevšiml, že jsou DVĚ.
Jakmile jméno začalo nést identitu instance, rozešla se: pki-init
volal `<projekt>-pki-bridge.backend.<tld>`, docker DNS uvnitř znal jen
`pki-bridge.backend.<tld>`, dotaz tedy vypadl na VEŘEJNÉ DNS, obešel
celý cluster a vrátil se jako 504 po 30 s. aisha-core kvůli tomu
nešlo nasadit (PKI_BUNDLE_REQUIRED=true) a vlna 2 zastavila cold-start.

Alias se proto odvozuje z TÉHOŽ klíče, který volající používá.

POZOR NA TVAR ADRESY: alias dělá z FQDN jméno KONTEJNERU — a na
kontejneru je jen http:3040 (TLS ukončuje Traefik). Konzument, který
tohle jméno volá, ho proto NESMÍ volat přes https bez portu; kolokovaní
dostávají http://pki-bridge:3040 (viz PKI_COLOCATED_SLOTS v resolveru)
a FQDN s https zůstává jen pro cross-host hop PŘES Traefik.

## `coolify: {}`

⛔ `{}` NENÍ kosmetika. Položka sítě s PRÁZDNOU hodnotou (`coolify:` bez
ničeho) se při nasazení přes Coolify ZAHODÍ — kontejner na síti prostě
není. Naměřeno 2026-08-13 na živých kontejnerech téhož hostu:
    gateway   (zápis `coolify: {}`)  → na síti coolify JE
    pki-auth  (zápis `- coolify`)    → na síti coolify JE
    pki-bridge (zápis `coolify:`)    → na síti coolify NENÍ, mesh-dns NENÍ
Důsledek: Traefik na most nedosáhl (504 po 30 s z venku) a mesh-dns síť
zůstala „osiřelá". Vanilla docker compose prázdnou hodnotu bere jako
platnou — tohle je vlastnost Coolify přepisu compose, proto to compose
preflight nechytí a hlídá to brána compose-sit-neni-null.

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

### Pojistka na prázdné tajemství stojí ve startovacím skriptu

`${SECRET:?}` v `environment:` je požadavek na PARSOVÁNÍ, a Coolify parsuje
compose dvakrát — při buildu (jen s `build-time.env`) a při spuštění. Aby
build neumřel, musí takové tajemství nést `is_buildtime=true`, což znamená
`--build-arg` a zápis do `docker history` napořád. Pojistka se tak platila
trvale vystaveným heslem.

Otázku „dorazila hodnota?" dnes zodpovídá `scripts/coolify-sync-envs.sh`
zpětným čtením po zápisu. Zbylé riziko — kontejner dostane prázdno odjinud —
řeší test na začátku startovacího skriptu, tedy u SPOTŘEBY, kde se z hodnoty
stává účet. Podrobné odůvodnění: `docker-compose.coolify-shared-redis.yml.md`.

Hlídá to brána `src/tests/gates/tajemstvi-ma-pojistku-u-spotreby.gate.test.ts`
— odebrat `${VAR:?}` bez přidání pojistky u spotřeby neprojde.

### OPENXPKI_OPERATOR_PASSWORD a PKI_SVAULT_KEY jdou passthrough

Obě měly `${K:?}` v `environment:` služby `pki-init`. Tím si vynucovaly
build-time příznak, a ten znamená `--build-arg` a zápis do `docker history` —
podrobné odůvodnění v `docker-compose.coolify-shared-redis.yml.md`.

Převod byl bezpečný, protože pojistka u spotřeby už existovala a je PŘESNĚJŠÍ
než ta v compose:

  · `PKI_SVAULT_KEY` — `[ -z "$${PKI_SVAULT_KEY:-}" ]` → FATAL, protože bez něj
    nejde vyrenderovat `crypto.yaml`;
  · `OPENXPKI_OPERATOR_PASSWORD` — skript nejdřív zkusí BYO digest
    (`OPENXPKI_OPERATOR_PASSWORD_HASH`), pak z hesla odvodí vlastní, a padá až
    když nemá ANI JEDNO. To `${VAR:?}` v compose neumělo: vynutilo si heslo
    i tehdy, když operátor legitimně dodal jen hotový hash.

Hlídá brána `tajemstvi-ma-pojistku-u-spotreby.gate.test.ts`.

## `- "${KEYCLOAK_EXTRA_HOST_ALIAS:?vydává derive-domains; bez něj by extra_hosts nesl duplicitu nebo prázdné jméno}:host-gateway"`

Druhé jméno MUSÍ být různé — Compose dělá z `extra_hosts` MAPU a dvě shodné
položky ji rozbijí:

    validating docker-compose.coolify-pki.yml:
      services.pki-auth.extra_hosts must be a mapping

⛔ NAMĚŘENO 2026-09-04 na produkci forku: `<fork>-pki` se nenasadila. Na
upstreamu se `KEYCLOAK_DOMAIN_PUBLIC` a `KEYCLOAK_DOMAIN` liší; na forku se
OBĚ rovnaly (jediná doména `auth.<tld>`), takže vznikly dvě identické položky.
Není to vada hodnot — reprodukováno lokálně se SPRÁVNÝMI hodnotami. Duplicitu
nesnese ani seznam („must be a mapping“), ani mapa („mapping key already
defined“), a Compose neumí řádek podmíněně vynechat — rozdílnost proto musí
zaručit RESOLVER: `derive-domains.mjs` vydá `KEYCLOAK_EXTRA_HOST_ALIAS` buď
jako skutečnou přímou doménu, nebo jako sentinel `keycloak-alias-disabled.invalid`
(RFC 6761 — záznam existuje, ale nikdy se netrefí), když splývá s veřejnou.
Týž řádek nesou llm-gateway, monitoring a openclaw. Hlídá brána
`extra-hosts-nesmi-mit-duplicitu`.
