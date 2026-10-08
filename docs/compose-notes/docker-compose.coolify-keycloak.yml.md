# docker-compose.coolify-keycloak.yml — notes

Prose extracted from `docker-compose.coolify-keycloak.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-common: &common`

=============================================================================
Evymo KeyCloak Stack — Standalone OIDC Identity Provider (Coolify Production)
=============================================================================
Uses shared aisha-db (central PostgreSQL in core stack) via aisha-network.
Role keycloak_app + schema keycloak are provisioned by aisha-db entrypoint-wrapper.sh.

Coolify UI setup:
  - Docker Compose source: docker-compose.coolify-keycloak.yml
  - docker_compose_domains: keycloak → https://<KEYCLOAK_DOMAIN>
  - Environment Variables: KEYCLOAK_DB_PASSWORD, KEYCLOAK_ADMIN_PASSWORD,
    KEYCLOAK_DOMAIN

DB dependency: aisha-db (core stack) must be running. Keycloak retries on failure.
=============================================================================

## `keycloak:`

---------------------------------------------------------------------------
KeyCloak — OIDC Identity Provider
Uses central aisha-db via aisha-network (host: aisha-db, role: keycloak_app)
---------------------------------------------------------------------------

## `PLATFORM_ADMIN_EMAIL: ${PLATFORM_ADMIN_EMAIL:-}`

Platform admin identity — rendered into the realm import on boot by
render-realm-and-start.sh (no personal account baked into git). All
optional: what you don't set is derived/defaulted (lockout-safe →
admin@aisha.guru + temporary password). Defaults live in ONE place — the
render script's cascade (PLATFORM_ADMIN_EMAIL → ADMIN_EMAIL → admin@aisha.guru)
— so compose stays a pure pass-through: no hardcoded value (template-only
repo) and no nested ${} (Coolify build-time parser). generate-secrets.mjs
emits PLATFORM_ADMIN_EMAIL for real deploys; unset → admin@${PUBLIC_TLD}.

## `OAUTH_APPLE_CLIENT_ID: ${OAUTH_APPLE_CLIENT_ID:-}`

Social IdP credentials forwarded to render-realm-and-start.sh — the
realm template's apple/google identityProviders carry ${OAUTH_*}
placeholders that must resolve at first-boot import (afterwards
configure-realms.sh reconciles them from the same env on every run).

## `PUBLIC_TLD: ${PUBLIC_TLD:-}`

Domain vars forwarded to render-realm-and-start.sh for realm template rendering.

## `KC_HOSTNAME: ${KEYCLOAK_DOMAIN_PUBLIC}`

KC_HOSTNAME = KEYCLOAK_DOMAIN_PUBLIC — canonical
public issuer. All KC-generated tokens carry iss=${KEYCLOAK_DOMAIN_PUBLIC}.
KEYCLOAK_DOMAIN is a system/technical direct-server domain
kept for admin/ops access only; the entire stack runs on aisha.guru.
Internal services reach KC via extra_hosts: ${KEYCLOAK_DOMAIN_PUBLIC}:host-gateway
→ host bridge IP → Coolify Traefik :443 → KC. No pfSense round-trip.

## `KC_HTTP_PORT: "80"`

KC_HTTP_PORT=80 — Coolify Traefik defaultně routuje na port 80.
Bez explicitního loadbalancer.server.port labelu Coolify routuje :80.

## `KC_HEALTH_ENABLED: "true"`

Health endpoint je v KC 26 zvlášť — vyžaduje explicitní zapnutí +
běží na management portu 9000 (ne hlavním 8080).

## `KC_LEGACY_OBSERVABILITY_INTERFACE: "true"`

Expose /health/* and /metrics on the main HTTP port (8080) instead of
the separate management port 9000. Required so Traefik (and Coolify
auto-detected port 8080) can reach health endpoints on the same
backend the application is served on.

## `BG_SLOT: ${BG_SLOT:-blue}`

── Blue-Green slot identity (Phase 1 pilot) ──
BG_SLOT je pevně nastavené per app (blue/green), ale pokud single-app
deploy (žádný B/G pair), defaultně "blue" — žádný impact.

## `BG_ACTIVE_HOST: ${BG_ACTIVE_HOST:-}`

BG_ACTIVE_HOST řídí Traefik router rule. Pokud prázdné → router
disabled (no traffic); pokud nastavené → app servuje doménu.
Pro single-app deploy: necháme prázdné a Coolify auto-detect routuje
přes svůj generovaný router (current behavior).

## `internal:`

`aisha-keycloak` is a cross-stack CONTRACT alias: core's migrate
(provision-operators), realtime, matrix, cosmos, ai-chat,
domain-services, webdispecink and pki-renewer all reach KC as
http://aisha-keycloak:80 over the shared coolify network. Coolify only
auto-aliases the compose SERVICE name (`keycloak`), so the contract
alias must be declared explicitly — verified missing on tenant
2026-07-18: provision-operators died on '❌ fetch failed' (dead DNS
name) and every wipe ended with the platform admin unauthorized.
Declared on both keys (both resolve to the external coolify network).

## `- "coolify.managed=true"`

─────────────────────────────────────────────────────────────────
Explicit Traefik labels — routing is the COMPOSE'S responsibility,
not Coolify's docker_compose_domains PATCH (which is silent-drop
prone in v4 — see memory feedback_coolify_api_quirks.md).

Pattern: explicit Traefik labels with literal hostnames (same as
other public routes in this repo — see coolify-n8n / coolify /
coolify-monitoring compose files).

Memory: feedback_coolify_label_dollar_escape.md — Coolify always
escapes $ → $$ in label values, so use literal hostnames here,
never `${KEYCLOAK_DOMAIN}`. KEYCLOAK_DOMAIN / KEYCLOAK_DOMAIN_PUBLIC are
set as constants in config/domains.env.
─────────────────────────────────────────────────────────────────

## `- "traefik.http.services.keycloak-svc.loadbalancer.server.port=80"`

Service: route all matched traffic to KC's internal port 80

## `- "traefik.http.routers.keycloak-https.rule=Host(`${KEYCLOAK_DOMAIN_PUBLIC}`) || Host(`${KEYCLOAK_DOMAIN}`) || Host(`${KEYCLOAK_DOMAIN_DIRECT}`)"`

HTTPS router: tri-host (canonical public + canonical internal + DIRECT).
All hostnames hit the same KC; KC_HOSTNAME=KEYCLOAK_DOMAIN_PUBLIC ensures
all generated URLs (iss, redirects, action URLs) carry the canonical host.
KEYCLOAK_DOMAIN_DIRECT = the mesh-INDEPENDENT backend host (from the
topology resolver): under MESH_ENABLED=true the canonical KEYCLOAK_DOMAIN
is mesh-overlaid, but the edge's auth upstream must never depend on the
mesh (mesh enrollment needs KC — chicken-and-egg, incident 2026-07-16),
so it dials this direct host. PLAIN ${VAR} — no :-fallback (the
coolify-traefik-label-substitution gate forbids literal fallbacks in
router values); cold-start always writes KEYCLOAK_DOMAIN_DIRECT to the
app env (equal to KEYCLOAK_DOMAIN when mesh is off; Traefik tolerates a
duplicated Host()).

## `- "traefik.http.routers.keycloak-http.rule=Host(`${KEYCLOAK_DOMAIN_PUBLIC}`) || Host(`${KEYCLOAK_DOMAIN}`) || Host(`${KEYCLOAK_DOMAIN_DIRECT}`)"`

HTTP→HTTPS redirect router (uses redirect-to-https middleware
defined in coolify-prebuilt.yml; Traefik middlewares are global
once defined by any provider)

## `test: ["CMD", "bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/80 && printf 'GET /health/ready HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3 && grep -q 'UP' <&3"]`

KC 26.0.7 + KC_LEGACY_OBSERVABILITY_INTERFACE=true → /health/ready na KC_HTTP_PORT.
KC_HTTP_PORT=80 → probe na portu 80.
Base image (ubi9-micro) má bash (kc.sh ho používá) ale nemá curl/wget.

## `internal:`

Both `internal` and `coolify` alias the external coolify network — avoid
per-stack bridges (Docker default address pool exhaustion).

## `KC_THEME_OVERLAY_CACHEBUST: ${KC_THEME_OVERLAY_CACHEBUST:-}`

Musí se mezi nasazeními MĚNIT, jinak BuildKit klon instančního repa
zakešuje a v obrazu zůstane téma z prvního buildu (zeleně, a beze
změny). Nastavit na commit SHA instančního repa nebo časové razítko;
když je overlay zapnutý a tohle prázdné, build PADNE s vysvětlením.

## `cpus: ${KEYCLOAK_CPUS:-1.0}`

OOM guard (incident 2026-07-24): KC 26 is Quarkus — WITHOUT a container
mem_limit its cgroup sees the whole host, so MaxRAMPercentage grows the heap
toward ~70% of HOST RAM. On a shared 25G backend host two co-tenant Keycloaks
(e.g. aisha + a fork) alone exhausted RAM → OOM-killer → host-wide cascade.
Cap both the container AND the heap explicitly so a KC can never take the host.
Default 2g (not 1g): KC 26 `start --import-realm` peaks above 1g at boot
(heap 512m + metaspace + off-heap + import) — verified live 2026-07-24, a
1g cap OOM-killed the container before the realm finished importing; 2g
boots and imports in ~34s. Override per host via KEYCLOAK_MEM.

## `JAVA_OPTS_KC_HEAP: ${KEYCLOAK_JAVA_HEAP:--Xms256m -Xmx512m}`

Deterministic heap — independent of host RAM / whether a mem_limit is read.

## `KC_ADMIN_CLIENT_SECRET: ${KC_ADMIN_CLIENT_SECRET:?generuje generate-secrets — prázdné znamená, že selhal push env do Coolify, ne že si to operátor nepřeje; realm by klientovi nastavil prázdné heslo}`

── Placeholdery realmu MUSÍ dorazit do TOHOTO kontejneru ────────────────
render-realm-and-start.sh dosazuje jen jména, která definuje prostředí
kontejneru; co nedorazí, zůstane v realmu LITERÁLEM "${VAR}". Být uveden
v compose jako hodnota (KC_HOSTNAME: ${KEYCLOAK_DOMAIN_PUBLIC}) nebo
v traefik labelu NESTAČÍ — to Coolify dosadí při renderu compose, nikoli
do env kontejneru. Vlastnost hlídá brána keycloak-realm-placeholders.

## `COMPANION_DOMAIN: ${COMPANION_DOMAIN:-}`

openclaw-proxy má ${COMPANION_DOMAIN} v redirectUris. Přesně tenhle
placeholder už jednou cold start shodil na „Invalid client openclaw-proxy:
A redirect URI is not a valid URI" (viz komentář v render-realm-and-start.sh)
— a chyběl tu dodnes, protože se to projeví JEN nad čistou databází.

## `KEYCLOAK_DOMAIN_PUBLIC: ${KEYCLOAK_DOMAIN_PUBLIC:-}`

webOrigins klienta; bez dosazení by tam byl literál místo adresy.

## `AISHA_PKI_ISSUER_CLIENT_SECRET: ${AISHA_PKI_ISSUER_CLIENT_SECRET:?generuje generate-secrets — prázdné znamená selhaný push env; pki-renewer drží tutéž hodnotu a nepřihlásil by se}`

Secret klienta aisha-pki-issuer. Hodnotu vyrábí generate-secrets a drží ji
i docker-compose.coolify-pki.yml; kdyby sem nedorazila, realm by klientovi
nastavil jako heslo literál a pki-renewer by se nepřihlásil — obě strany
by přitom nastartovaly zeleně.

## `APPLE_TEAM_ID: ${APPLE_TEAM_ID:-}`

Apple key material for configure-realms.sh to MINT a fresh ~6-month
client secret on every boot (Apple caps the Sign-in-with-Apple secret at
a 6-month ES256 JWT, so a static OAUTH_APPLE_CLIENT_SECRET eventually
expires and Apple login silently dies). When these are set, the minted
secret supersedes the static one; when unset, the static value is used.

## `KC_HOSTNAME: ${KEYCLOAK_DOMAIN_PUBLIC:?vydává derive-domains; prázdno = selhal push env — bez hostname by KC stavěl redirecty z vnitřního aliasu}`

`:?` je load-bearing: bez přišpendleného hostname staví Keycloak
přihlašovací redirecty z toho, JAK ho kdo osloví — tedy z vnitřního
aliasu a KC_HTTP_PORT. Naměřeno 2026-08-13 na `<fork>`: login posílal
prohlížeč na `<fork>-keycloak:80`. Prázdná hodnota není volba operátora
(env-doctor ji má jako required-static a vydávají ji všechny profily) —
znamená selhaný push env, a ten má shodit preflight PŘED destrukcí,
ne potichu rozbít auth po nasazení.

## `KC_SPI_THEME_STATIC_MAX_AGE: "300"`

Statické zdroje tématu (CSS/JS) servíruje Keycloak pod cestou
/resources/<verze>/login/<téma>/…, jenže ta <verze> je odvozená od
verze Keycloaku — NE od obsahu tématu. Přes nasazení se tedy nemění.
Výchozí max-age je 2 592 000 s (30 dní) a odpověď nenese ani ETag, ani
Last-Modified, takže prohlížeč se dalších třicet dní nezeptá.

NAMĚŘENO 2026-08-03 po nasazení #106: prohlížeč vzal VŠECHNA CSS i JS
z keše (transferSize 0). Kešovaná design-language.css měla 6 931 B a
neobsahovala opravu `box-sizing`; čerstvá má 28 180 B a obsahuje ji.
Nasazení bylo správné, ale uživatel viděl staré téma — a při prohlídce
to vypadalo jako neúčinná oprava.

300 s je kompromis: v rámci jednoho přihlášení se nic nestahuje znovu,
ale změna tématu je vidět do pěti minut místo do měsíce. Celé téma má
~40 kB, takže cena za to je zanedbatelná.

## `coolify:`

⚠️ `coolify` je SDÍLENÁ síť — jede po ní provoz VŠECH zákazníků na tomhle
Coolify (změřeno 2026-08-04: 149 aplikací, 8 zákaznických prefixů, PĚT
Keycloaků). Alias odvozený ze SERVICE_ALIAS_PREFIX je jméno IMPLEMENTACE
stacku, ne zákazníka: u každé instance je to `aisha`, takže se její Keycloak na
sdílené síti hlásí jako `aisha-keycloak` — stejně jako Keycloak zákazníka
aisha. Konzumenti z jiných compose stacků (ai-chat, exec, ledger,
domain-services, matrix) pak mohou dostat CIZÍ Keycloak, tedy cizí
podpisové klíče. Přesně vada, kterou popisuje brána network-alias-unique:
po sobě jdoucí DNS dotazy vracely střídavě dvě různé adresy.

Instanční alias se proto přidává NAVÍC, ne místo. Docker unese víc aliasů
a rollout tím nemá okno výpadku:
  1) nasadit Keycloak → odpovídá na OBĚ jména
  2) přepnout konzumenty na `${APP_NAME_PREFIX}-keycloak` (KEYCLOAK_INTERNAL_URL)
  3) teprve pak zahodit sdílené jméno
Kdyby se přejmenovalo naráz, konzumenti by mezi kroky 1 a 2 neviděli nic.

Na `internal` (per-stack, izolovaná) alias zůstává implementační — tam
kolize vzniknout nemůže a stack má svůj slovník.

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").

## `secrets:`

NE build arg: hodnota argu se zapíše do metadat obrazu a `docker history`
ji vydá komukoli, kdo na obraz dosáhne. Secret žije jen po dobu jedné
instrukce v tmpfs. Coolify musí mít GIT_TOKEN označený jako
runtime-only, jinak ho pošle jako `--build-arg` navíc a únik se vrátí.

## `KC_CACHE: local`

⛔ LOKÁLNÍ CACHE, ne distribuovaná (naměřeno 2026-08-27 z logů uzlu).

Keycloak má ve výchozím stavu Infinispan v distribuovaném režimu
a hledá členy clusteru přes JGroups UDP MULTICAST se jménem `ISPN`.
Na SDÍLENÉM hostiteli si tím náš Keycloak našel Keycloak CIZÍHO
nájemníka, utvořil s ním jeden cluster a při startu čekal na odpovědi,
které nikdy nepřišly:

  ISPN000136: Error executing command PutKeyValueCommand on Cache 'work'
  TimeoutException: Timed out waiting for responses ... after 15 seconds
  ERROR: Failed to start server in (production) mode
  ERROR: Session not bound to a realm

Projevilo se to jako CRASH-LOOP po importu realmu — hláška mluvila
o realmu, příčinou bylo jméno clusteru sdílené mezi nájemníky.
Když startoval sám, log říkal „no members discovered — creating cluster
as coordinator" a prošel; jakmile soused běžel, spadl.

Tahle instance je JEDEN uzel (B/G pár se nezakládá), takže distribuovaná
cache nepřináší nic a jen otevírá dveře cizímu procesu. `local` je
zároveň rychlejší start a nulová multicast plocha.

## `KEYCLOAK_REALM: ${KEYCLOAK_REALM:?deklaruje instance — prázdné by naimportovalo realm bez jména a všech 110 konzumentů by hledalo jinde}`

Jméno realmu je DEKLARACE INSTANCE, ne konstanta platformy.

MECHANISMUS: šablona keycloak/aisha-realm.json nese realm jako
${KEYCLOAK_REALM} a entrypoint render-realm-and-start.sh dosazuje
každou ${VAR}, kterou prostředí má — BEZ tohohle řádku by se
placeholder nedosadil a realm by se jmenoval doslova
"${KEYCLOAK_REALM}".

PROČ NE KONSTANTA: šablona ho nesla natvrdo jako `aisha` — u nás
neviditelné, protože tak se náš realm opravdu jmenuje. Fork
s KEYCLOAK_REALM=<své> by ale naimportoval realm jménem DÁRCE
a jeho 110 konzumentů by pak sahalo na /realms/<své> → 404.

⛔ ŽÁDNÝ FALLBACK (`:?` schválně). Dosazená náhrada by znamenala,
že se instanci mlčky založí realm cizím jménem, a pozná se to až
na tom, že se nikdo nepřihlásí. Buď je jméno deklarované, nebo se
stack nepostaví.

⛔ A JEN JEDNOU. Upstream merge (2026-09-05) sem klíč přinesl podruhé
— s týmž významem, jiným textem. Dvě `KEYCLOAK_REALM:` v jedné mapě
jsou NEPLATNÝ YAML: `docker compose config` i každý parser spadnou na
"duplicated mapping key", takže neprošel ani jeden compose gate a
instance se nedala postavit. Přibude-li klíč znovu, patří sem, ne vedle.

## `APPSMITH_OIDC_SECRET: ${APPSMITH_OIDC_SECRET}`

── Secrety důvěrných klientů → do realmu při STARTU ────────────────────
Realm se importuje z šablony (`--import-realm`, render-realm-and-start.sh)
a její generická smyčka dosadí každý `${VAR}`, který prostředí definuje.
Do 2026-08-30 tyhle klienty razítkoval AŽ operátor přes provision-sso.sh
z venku — a právě kvůli tomu potřeboval na Keycloak dosáhnout dřív, než
existuje mesh i edge. Z toho vznikl jediný off-mesh šev celého toku.

Hodnoty tu byly celou dobu (env-doctor CONTRACT je deklaruje, cold-start
je má v .env.coolify); chybělo jen je kontejneru předat. Tím se realm
dorodí uvnitř a operátorský krok se mění z PODMÍNKY na ověření.

⛔ HOLÝ TVAR `${VAR}` — ne `:?` a ne `:-`. Obojí by porušilo jednu ze
DVOU bran, které si tu jdou proti sobě, a jen tenhle vyhoví oběma:

  `${VAR:?}`  build-time-mnozina-vsech-compose: pojistka uvnitř
              `environment:` si hodnotu VYNUTÍ do buildu a skončí
              v `docker history`. Rohatka 83→71→67→61→60 zakazuje růst.
  `${VAR:-}`  coolify-compose-compliance: prázdná výchozí hodnota u
              secretu, který platforma GENERUJE (pg v generate-secrets),
              potlačí i varování dockeru — „silently-empty class".
  `${VAR}`    do buildu nejde (chybí pojistka, která by ho tam vynutila)
              a při chybějící hodnotě docker VARUJE. Týž vzor jako
              `NB_SETUP_KEY: ${NETBIRD_STACK_KEY_FRONTEND}`.

Fail-closed se tím neztrácí, jen stojí TAM, KDE SE HODNOTA SPOTŘEBUJE:
render-realm-and-start.sh na chybějícím secretu končí, místo aby
naimportoval klienta s literálem místo hesla a nechal přihlášení padnout
na 'unauthorized_client' o dvě vrstvy dál.

## `KC_HOSTNAME: https://${KEYCLOAK_DOMAIN_PUBLIC:?vydává derive-domains; prázdno = selhal push env — bez hostname by KC stavěl redirecty z vnitřního aliasu}`

⛔ NAMĚŘENO 2026-08-20: tady stálo HOLÉ JMÉNO bez schématu, takže si
Keycloak schéma dobíral Z POŽADAVKU. Kdo se ptal vnitřně přes
`http://<prefix>-keycloak:80`, dostal token s `iss: http://auth.<tld>/…`
— a validátor, který čeká `https://`, ho odmítl:
    token nese:         iss : http://auth.<tld>/realms/aisha
    pki-bridge očekává: iss : https://auth.<tld>/realms/aisha
Issuer NESMÍ záviset na tom, kudy se klient ptal. Celá URL ho ustálí
(Keycloak 25+ ji u KC_HOSTNAME přijímá), takže vnitřní i veřejná cesta
vydají TÝŽ token — což je přesně to, co potřebuje bootstrap, který
chodí vnitřně, ale jehož token ověřují služby čekající veřejný issuer.

## `secrets:`

Zdroj `environment:` čte proměnnou z prostředí projektu, tedy i z `.env`, který
Coolify pro build zapisuje — ověřeno měřením 2026-08-15 i s proměnnou úmyslně
odstraněnou z procesního prostředí. Proměnná NESMÍ být v Coolify build-time:
`.env` ji dostane tak jako tak (compose interpolace bere všechny), zatímco
`--build-arg` už jen build-time sadu.

## `AISHA_BOOTSTRAP_CLIENT_SECRET: ${AISHA_BOOTSTRAP_CLIENT_SECRET}`

Bootstrap dvojice — realm si předgenerovaný secret PŘEVEZME při importu.
Bez toho si ho KC vygeneruje sám a někdo si ho musí přijít vyzvednout;
na instanci za NAT to znamená SSH do hostitele, protože veřejná trasa
vede přes edge, který na ten secret (přes discovery) sám čeká.

## `AISHA_BOOTSTRAP_PASSWORD: ${AISHA_BOOTSTRAP_PASSWORD}`

Hesla servisních účtů — `netbird-peer-discover` se hlásí přes ROPC
(grant_type=password), takže potřebuje OBOJE: secret klienta i heslo
uživatele. Šablona měla u `aisha-bootstrap` `"credentials": []`, takže
by ROPC padlo o krok dál a vypadalo by to jako úplně jiná vada.

## `realm-sync:`

realm-sync — deklarace klientů KONVERGUJE, ne jen vzniká.

`--import-realm` importuje jen na PRÁZDNÝ realm (záměr: re-deploy nesmí
přerazit admina, který si změnil heslo). Z toho ale plyne, že šablona je
zdroj pravdy, který se ke konzumentovi dostane JEDNOU — a každá pozdější
změna je tichá. Naměřeno 2026-09-05 na produkci forku: klient `aisha-bootstrap`
dostal v šabloně secret z prostředí, na existujícím realmu se nestalo nic,
discovery dál hlásilo „Pověření bootstrap uživatele chybí" a mesh stál.

Běží UVNITŘ stacku proti vnitřní adrese, takže nepotřebuje Keycloak
dosažitelný zvenčí — což na instanci za NAT před vznikem meshe ani nejde.
Sahá VÝHRADNĚ na klienty, kterým šablona secret deklaruje; uživatelů, rolí
ani admin hesla se nedotkne. Skript: `keycloak/reconcile-realm-clients.sh`;
hlídá brána `realm-deklarace-konverguje`.

`args: *kc-theme-overlay-args` / `secrets: *kc-build-secrets` — realm-sync
staví TENTÝŽ `Dockerfile.keycloak`, a ten se větví na `KC_THEME_OVERLAY_GIT_URL`
(prázdný default → téma přeskočeno, zadané → klon, jinak `exit 1`). Bez argů
vznikaly z jednoho Dockerfilu dva různé obrazy podle toho, která služba ho
stavěla. Naměřeno 2026-09-13 rozšířenou bránou `overlay-arg-dotece-do-buildu`
(ARG s prázdným defaultem, jehož prázdnotu RUN testuje a větví se do `exit`):
jediný zbylý nález po opravě extranetu. Kotva, ne kopie — vstupy obou buildů
se nemohou rozejít.

## `KC_INTERNAL_URL: ${KEYCLOAK_INTERNAL_URL:?vydává derive-domains; bez něj by smír mířil na holé jméno na sdílené síti}`

⛔ ADRESA Z RESOLVERU, NE HOLÉ JMÉNO. Napsat `http://keycloak:8080` se zdá
nevinné, ale `internal` i `coolify` jsou SDÍLENÉ sítě: holé jméno na nich
nárokuje i cizí nájemník a DNS mezi stejnojmennými round-robinuje —
smír by pak srovnával secrety CIZÍHO Keycloaku. Hlídá to brána
jmeno-na-sdilene-siti-nese-identitu, která tenhle řádek zachytila.
`KEYCLOAK_INTERNAL_URL` vydává derive-domains z katalogu a nese identitu
instance (`<fork>-keycloak:80`) — týž primitiv jako u všech ostatních
vnitřních adres.

## realm-sync: pověření poskytovatelů identity (2026-09-20, upřesněno 2026-09-24)

`realm-sync` dostává i `OAUTH_APPLE_CLIENT_ID/SECRET` a `OAUTH_GOOGLE_CLIENT_ID/SECRET`.

**Proč:** šablona realmu veze oba poskytovatele identity VYPNUTÉ a zapínají se podle
prostředí instance. `--import-realm` ale proběhne jen nad prázdným realmem, takže po
obnově realmu (nebo cold startu) zůstal Google vypnutý, i když instance pověření má —
naměřeno 2026-09-20 na jedné instanci forku: přihlašovací stránka nabízela jen Apple.
Smír (`keycloak/reconcile-realm-clients.sh`) je jediné místo, kterým projde KAŽDÝ start,
proto poskytovatele srovnává on.

**Jak:** pro `apple` a `google` čte pověření z prostředí; když ho má, poskytovatele
zapne a pověření doplní (tajemství přes stdin `-f -`, nikdy argumentem — v `ps` by bylo
vidět). Vypne ho jen tehdy, když pověření nemá prostředí ANI živý realm.

**Dvě pasti zápisu (obě naměřené):**

1. PUT poskytovatele BEZ `clientSecret` tajemství v Keycloaku SMAŽE (živě 2026-09-20
   při ručním zapnutí Google). Načíst a zapsat zpátky celou reprezentaci taky nejde —
   secret v ní je maskovaný `**********`. Smír proto posílá jen vyjmenovaná pole.
2. `kcadm update -f -` BEZ `-m` NESLUČUJE s GET („Merge is automatically enabled unless
   --file is specified"): částečný dokument jde jako celý PUT a Keycloak 26.0.8 ho odmítne
   (`Invalid identity provider id [null]`) — smír by padal při každém startu instance,
   která poskytovatele v realmu má. S `-m` se `config` sloučí DO HLOUBKY: klíče navíc
   přežijí (Apple `teamId`/`keyId`/klíč, Google `guiOrder`/`prompt`/`hostedDomain`)
   a secret se zapíše. S `--no-merge` by PUT nahradil celý `config`. Změřeno 2026-09-25
   na dočasném Keycloaku 26.0.8 se skutečným skriptem smíru.

**Chyba nástroje není „poskytovatel chybí":** čtení poskytovatele smí skončit jako
„v realmu není" JEN na 404 (`Resource not found for url: …`). Vypršené přihlášení, 5xx
nebo síť smír ukončí s hláškou kcadm — jinak by se bez pověření tiše „přeskočilo"
a s pověřením by to spadlo až na `create` se zavádějící hláškou.

Prázdná hodnota (`:-`) znamená „tahle instance poskytovatele nemá" — poskytovatel
identity je volitelná schopnost instance, ne povinné tajemství.

Hlídá brána `idp-se-srovnava-pri-kazdem-startu`.
