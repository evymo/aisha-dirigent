# docker-compose.coolify-domain-services.yml — notes

Prose extracted from `docker-compose.coolify-domain-services.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-svc-common: &svc-common`

==============================================================================
Coolify story: aisha-domain-services (Backend — domain microservice fleet)
==============================================================================
The core-stack gateway (services/gateway/src/routes/functions.ts) routes
/functions/v1/* to these domain services, but until now NONE of them were
deployed anywhere — docker-compose.coolify.yml (aisha-core) is at the
coolify-compose-compliance ceiling (≈35 KB / 9 build blocks) and deliberately
ships only gateway + svc-plugin-system + svc-mcp-knowledge + svc-web-artifact
(its own header: "Optional domain microservices are intentionally excluded").
So every function mapped to svc-stripe/svc-push/…/storage-auth returned a
gateway 502 "Failed to reach service". This sibling stack fixes that — the
canonical extract-to-sibling pattern (precedent: coolify-ai-chat.yml).

NETWORKING: each service joins the shared external `coolify` network and
declares an alias equal to the ROUTE_TABLE default hostname
(functions.ts: STRIPE_SERVICE_URL ?? 'http://svc-stripe:3010', …). Coolify
strips container_name, so the explicit alias is what the gateway resolves —
no gateway change needed (same as svc-ai-chat today). Core resources are
reached by their published cross-stack aliases: aisha-postgrest:3000,
aisha-keycloak:80, clamd:3310 (aisha-clamav stack).

ENV SCOPE: only the CORE data plane (PostgREST + Keycloak JWKS + CA bundle)
is wired here — enough for each service to boot healthy and verify JWTs.
Per-integration provider secrets (Stripe/Twilio/Firebase/VAPID/Packeta/
GitHub-App/LiveKit/…) are BYO: operators add them via Coolify env when wiring
that integration, and several services read them from the DB edge_app_secrets
store first anyway (svc-homeassistant fully, svc-fio-bank + svc-stripe key).
Services are fail-quiet without them (config uses `?? ''`), so an unwired
integration returns a service 4xx/5xx — NOT a gateway 502.

INTERNAL-ONLY: expose:, never host ports:; no Traefik router/labels beyond
coolify.managed — only the in-cluster gateway calls these.
==============================================================================

## `x-svc-env: &svc-env`

Core data plane shared by every domain service (cross-stack via published
aliases on the shared `coolify` network).

## `pki-init:`

───────────────────────────────────────────────────────────────────────────
pki-init — populate the per-stack volume with the internal CA bundle
(baked into Dockerfile.pki-init, no bind mounts — Coolify remote-worker safe).
───────────────────────────────────────────────────────────────────────────

## `svc-stripe:`

── Payments — gateway fn stripe-webhook/stripe-refund/create-checkout-session… ──

## `svc-push:`

── Push notifications — gateway fn send-push-notification/aisha-push (SSE) ──

## `svc-blockchain:`

── Blockchain dispatch — gateway fn blockchain-dispatch/claim-cosmos-reward… ──
Cosmos node + RabbitMQ live in sibling stacks; empty URLs → adapters degrade,
service still boots healthy (fail-quiet).

## `svc-fio-bank:`

── Fio bank sync — gateway fn fio-bank-sync (token from DB edge_app_secrets) ──

## `svc-homeassistant:`

── Home Assistant — gateway fn homeassistant-api (creds fully from DB) ──

## `svc-github-app:`

── GitHub App — gateway fn github-app-auth/github-repo-ops/github-webhook-bridge ──

## `svc-health-ai:`

── Health AI — gateway fn analyze-health-document/analyze-wearable-sync ──
Fetches uploaded files from MinIO; internal MinIO reachable when co-hosted.

## `svc-livekit:`

── LiveKit tokens/egress — gateway fn create-livekit-token/livekit-recording ──
LIVEKIT_HOST → the aisha-livekit media stack; recording S3 creds are BYO.

## `svc-communications:`

── SMS/OTP — gateway fn send-sms-otp/verify-sms-otp (provider creds BYO) ──

## `svc-packeta:`

── Packeta shipping — gateway fn packeta-api (dispatcher) ──

## `storage-auth:`

── Storage auth — gateway fn upload-health-document-preflight/download-health-document ──
MinIO creds reuse the core root creds; clamd AV is cross-stack (aisha-clamav).


## `# Mesh routa — viz compose-notes.` (storage-auth)

`CLAMD_HOST` je mesh jméno antiviru (katalog `internal_tcp_endpoints`). Resolver
na stroji ho PŘELOŽÍ, ale bez routy do rozsahu peerů (`NETBIRD_PEER_CIDR` přes
mesh-router `NETBIRD_DNS_IP`) se NESPOJÍ — sken každého uploadu visí na timeoutu,
ne na chybě. Tvar je týž jako u gateway jádra (docker-compose.coolify.yml):
`cap_add: [NET_ADMIN]`, entrypoint jako root postaví routu a hned `exec su-exec
node`, takže služba běží bez práv. `NETBIRD_DNS_IP` do kontejneru vkládá Coolify
se všemi proměnnými aplikace (naměřeno na gateway: v `docker inspect` je, ač
compose ho v `environment:` nevypisuje). Obraz proto nese `su-exec` + `iproute2`
a nemá `USER node`. Hlídá brána `mesh-lane-miri-jmenem-ne-hopem`
(MESH_TCP_BEZ_ROUTY_DLUH).
## `environment:`

Živý fetch místo kopie zapečeného bundle: měřeno 2026-07-28 nese
config/pki/aisha-ca-bundle.pem "CN=AISHA Root CA, O=Evymo", zatímco
bridge servíruje "CN=<instance> Root CA" — JINÁ autorita, takže
kontejner hlásil healthy a nevěřil ničemu, co instance podepisuje.
Realmová CA vzniká při 1. bootu z náhodného klíče ⇒ zapečená kopie
nemůže sedět na žádné živé instanci. assemble-ca-bundle.sh ten fallback
2026-07-19 zrušil; tenhle `cp` ho obcházel. Parametrizace je ve skriptu:
PKI_BRIDGE_URL prázdné ⇒ veřejné kořeny + exit 0 (fork bez mesh).

## `FIREBASE_SERVICE_ACCOUNT_JSON: ${FIREBASE_SERVICE_ACCOUNT_JSON:-}`

── Pověření k FCM ────────────────────────────────────────────────────
MUSÍ tu být vyjmenované, i když jsou volitelné: `coolify-sync-envs.sh`
posílá aplikaci JEN klíče, které jsou v JEJÍM compose. Dokud tu nebyly,
měl svc-push v prostředí 56 proměnných a ani jednu z těchhle — takže
push nemohl fungovat bez ohledu na to, co bylo v .env.coolify.

Dvě cesty, služba si vybere sama (viz services/svc-push/src/lib/fcm.ts):
 1) klíč service accountu — původní; některé instance ho mají
 2) federace přes náš Keycloak — bez dlouhověkého klíče; nutná tam, kde
    organizace zakazuje `iam.disableServiceAccountKeyCreation` (naměřeno u zákazníka)
Prázdné hodnoty jsou v pořádku: neúplnou sadu služba odmítne sama a
řekne, KTERÝ klíč chybí. Rozhodovat o tom tady by znamenalo mít pravidlo
na dvou místech.

## `VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}`

Web push (prohlížeč) — táž třída, taky se bez zmínky nedoručí.

## `domain-services-blockchain:`

NENÍ to `svc-blockchain` — to jméno drží kopie v
docker-compose.coolify-cosmos.yml, jak deklaruje config/services.json.

Přejmenováno i KLÍČEM, ne jen aliasem: docker přidává compose service name
jako alias na KAŽDOU připojenou síť, a `internal` je `external: true,
name: coolify`, tedy jedna síť celého clusteru. Samotné odebrání aliasu
kolizi neodstranilo — jméno drželo dál service name. Změřeno: `svc-blockchain`
se z jiných stacků adresuje (gateway na port 3013), takže
střídavé DNS mělo skutečného volajícího.

Kontejner zůstává, jen má vlastní jméno. Volání na `svc-blockchain` se teď
rozřeší jednoznačně na kopii se signerem a řetězem.

## `internal: {}`

BEZ aliasu `svc-blockchain` — to jméno patří kopii v
docker-compose.coolify-cosmos.yml, jak deklaruje config/services.json
(`svc-blockchain.compose`).

`internal` je JEDNA sdílená síť celého clusteru (external, name: coolify),
takže alias tady i tam znamenal dvě různé služby pod jedním jménem a DNS
odpovídalo střídavě: sedm dotazů ze svc-ai-chat vrátilo dvě různé adresy
ve dvou skupinách — dva různé buildy (11555f9a vs c28d5755).

Ta cosmosí má RabbitMQ, signer a adresy řetězu; tahle dědí jen obecnou
kotvu, takže na řetěz nedosáhne. Zhruba polovina volání tedy mířila na
kontejner, který nemohl nic obsloužit.

Kontejner ZŮSTÁVÁ — nemaže se, jen přestává obsazovat cizí jméno. Volání
na `svc-blockchain` odsud se teď rozřeší na tu nakonfigurovanou kopii,
tedy správně. Dokonfigurovat obě nelze: svc-blockchain je JEDINÝ drainer
blockchain outboxu a dva podepisovatelé na jedné frontě jsou horší než
dnešek. Kde ta jediná bydlí, říká katalog.

## `profiles: ["money"]`

⭐ ZA PROFILEM — instance, která do účetnictví nesahá, tuhle službu NEMÁ.
Bez profilu by se kontejner spustil všude: proměnné mají `${VAR:-}`, takže
compose se vyrenderuje, ale `configDefects()` chybějící MONEY_HOST/AGENDAS
najde a proces skončí `exit(1)` → restart loop. Stack běží, služba se topí,
a nikdo neví, jestli je to porucha nebo záměr. Profil to říká nahlas.
Zapnutí = `COMPOSE_PROFILES=money` + instanční proměnné, ne změna kódu.

## `cap_drop: ["ALL"]`

⭐ Tunel potřebuje NET_ADMIN a /dev/net/tun — a NIC VÍC.
`cap_drop: ALL` + jediné pojmenované právo: kdyby se sem někdy přidávalo
další, je vidět, že to je rozhodnutí, ne zvyk.

## `tmpfs:`

Tajemství se rozbalují do PAMĚTI, ne na svazek — restartem mizí a
v obrazu ani v záloze po nich nezůstane stopa.

## `SVC_MONEY_API_TOKEN: ${SVC_MONEY_API_TOKEN:-}`

Kdo se smí ptát. Chybějící hodnota NENÍ „vypnutá autorizace" — služba
pak odmítá vše, protože vnitřní síť je dosažitelnost, ne oprávnění.

## `VPN_ENABLED: ${VPN_ENABLED:-true}`

── Přístup do Money ────────────────────────────────────────────────
VŠECHNO z prostředí, NIC v obrazu. Rotace certifikátu = změna hodnoty
a restart, ne přestavba obrazu (kterou by nikdo nedělal, a tajemství
by tak stárlo).

MONEY_VPN_PROFILE_B64 = base64 celého .ovpn VČETNĚ klientského certifikátu.
MONEY_AGENDAS         = JSON pole agend; jedna agenda = jeden PORT na
                        témže hostiteli (Money tak rozlišuje účetní
                        jednotky) + vlastní API pověření. Jedna proměnná
                        proto, že přidání agendy se nemá dotknout compose.
── VPN: OBECNÁ schopnost vytočit tunel ─────────────────────────────
Záměrně `VPN_*`, ne `MONEY_VPN_*`: tunel se vytáčí stejně bez ohledu na
to, co je za ním, takže týž kontrakt použije i jiná služba beze změny.
`VPN_PROFILE_B64` = base64 celého .ovpn VČETNĚ klientského certifikátu →
rotace je změna hodnoty a restart, ne přestavba obrazu.
`VPN_CONNECT_RETRY_MAX` je strop pokusů: bez něj openvpn zkouší
donekonečna a protistrana to vidí jako útok (fail2ban).

## `MONEY_HOST: ${MONEY_HOST:-}`

── KAM voláme a pod čím (jiná životnost než tunel) ──────────────────

## `CLAMD_HOST: ${CLAMD_HOST:?doručuje env-doctor CONTRACT z identity instance}`

Instanční jméno, ne holý `clamd` — ten si na sdílené síti nárokuje i
cizí nájemník a clamd NEMÁ autentizaci, takže by `INSTREAM` poslal
obsah skenovaného souboru cizí službě (změřeno 2026-08-10).
Doručuje env-doctor (CONTRACT: ${APP_NAME_PREFIX}-clamd) — bez defaultu,
dosazené jméno by tu kolizi tiše vrátilo.

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

## `VAPID_PUBLIC_KEY: ${WEB_PUSH_VAPID_PUBLIC_KEY:-}`

⛔ NAMĚŘENO 2026-09-02: nasazovací linka plní WEB_PUSH_VAPID_* (coolify-deploy-init.sh
ř. 1749–1751), kdežto svc-push čte VAPID_* (src/config.ts ř. 23–25) — a most mezi
nimi nebyl žádný. Kontejner tedy dostával prázdné klíče. Frontend přitom
VITE_WEB_PUSH_VAPID_PUBLIC_KEY dostal (ř. 884 téhož skriptu), takže prohlížeč si
odběr založil veřejným klíčem, k němuž služba neměla privátní protějšek: odběry
vznikaly a KAŽDÉ odeslání tiše selhalo. Táž třída vady jako ENABLE_GOOGLE_OAUTH
bez konzumenta (instance-rollout.sh ř. 361).

Jedna úroveň, ŽÁDNÉ vnoření: parser build-time proměnných v Coolify si
s `${A:-${B}}` neporadí a brána coolify-compose-compliance to hlídá.
Fallback na holé VAPID_* by stejně byl na nic — pod tímhle jménem je nikdo
nevyrábí ani lokálně (config/local-presets.mjs plní VITE_WEB_PUSH_*).

## Web push: proč holé `${WEB_PUSH_VAPID_*}` (2026-09-21)

Do 21. 9. tu stálo `${WEB_PUSH_VAPID_PUBLIC_KEY:-}` — a hodnota nebyla nikde:
v trezoru byl jediný, PRÁZDNÝ `VITE_WEB_PUSH_VAPID_PUBLIC_KEY`, serverová trojice
v kontraktu doktora vůbec nebyla a `svc-push` ji četl jako `process.env.X ?? ''`.
Web push tedy nefungoval na OBOU koncích naráz — prohlížeč se bez veřejného klíče
k odběru nepřihlásil a server by stejně neměl čím podepsat. A protože všude stálo
`:-` a `?? ''`, nikde to nevydalo ani řádku v logu.

Tvar je proto `${VAR}` (holý), ne `:-` ani `:?`:
- `:-` je TICHÉ prázdno u hodnoty, kterou platforma GENERUJE — přesně to, co tu
  devět měsíců schovávalo vadu.
- `:?` uvnitř `environment:` protlačí tajemství do BUILDU a zapeče ho do
  `docker history`; ta množina smí jen klesat (brána `build-time-mnozina-vsech-compose`).
- holé `${VAR}` nedělá ani jedno a platforma ho na téže třídě už používá
  (`STORAGE_UPLOAD_TOKEN_SECRET`, `MINIO_ROOT_PASSWORD`).

⛔ Fail-closed proto nestojí v compose, ale tam, kde se hodnota SPOTŘEBUJE:
`overVapid()` v `services/svc-push/src/lib/web-push.ts` ověří TVAR (RFC 8292:
veřejný = bod `0x04||X||Y`, 65 B; soukromý = skalár, 32 B) a hlavně
SOUNÁLEŽITOST — ze soukromého odvodí veřejný bod a porovná. Půlka páru projde
každou kontrolou „proměnná je nastavená", ale poskytovatel ji odmítne s 403,
takže tohle je jediné místo, kde se pozná. Při neshodě se web push vypne a
důvod se vypíše JEDNOU, ne u každé zprávy.

## `      STORAGE_UPLOAD_TOKEN_SECRET: ${STORAGE_UPLOAD_TOKEN_SECRET}`

HMAC tajemství nahrávacích tokenů storage-auth (nahrání přes API místo
presigned URL MinIA, která nesla mesh host — z terénu nedosažitelný).
Holé `${…}` jako MINIO_ROOT_PASSWORD, ZÁMĚRNĚ ani `:?`, ani `:-`:
`:?` uvnitř `environment:` vtáhne tajemství do build-time množiny a Coolify
ho zapeče do `docker history` (brána build-time-mnozina-vsech-compose —
naměřeno pre-pushem 2026-09-18, rohatka 1 → 2); `:-` ho tiše vyprázdní
(brána coolify-compose-compliance). Hodnotu vydává generate-secrets, doktor ji
doplní a sync-envs doručí za běhu. Chybí-li, storage-auth při startu nahlas
varuje a vydává presigned URL jako dřív.

## `      IMGPROXY_KEY: ${IMGPROXY_KEY}`

Podpis cest imgproxy (2026-09-24). Veřejná proxy `/object/public/<bucket>/<klíč>`
umí volitelné parametry `?w=&h=&fx=&fy=&z=` (cílový rozměr, ohnisko 0..1,
přiblížení 1..4) a HEIC/HEIF doručuje převedené — obojí přes imgproxy jádra,
který má klíč i sůl z generate-secrets a nepodepsanou (`/insecure/`) cestu
odmítá. storage-auth proto podepisuje sám (`lib/imgproxy-podpis.ts`, bílá
listina parametrů). Holé `${…}` ze stejného důvodu jako MINIO_ROOT_PASSWORD
a STORAGE_UPLOAD_TOKEN_SECRET výše: `:?` by tajemství vtáhlo do build-time
množiny, `:-` by ho tiše vyprázdnilo. Bez klíče odpoví transformace 501
`not_configured` (objekt bez parametrů se dál streamuje beze změny) a
`/health` hlásí `capabilities.imageTransforms: false`.

## `      IMGPROXY_SALT: ${IMGPROXY_SALT}`

Sůl k IMGPROXY_KEY — podepisuje se `salt || cesta`, obě půlky musí být z téže
dvojice jako u imgproxy jádra (jinak imgproxy vrátí 403 a proxy 502).

## `      ZARIZENI_ZDROJ_TOKEN: ${ZARIZENI_ZDROJ_TOKEN:-}` · `      FORGEJO_URL: ${FORGEJO_URL}` (2026-09-24)

Doplnění balíčků schopnosti „zařízení" (Kiosk Admin a appky, které rozdává) do
bucketu `zarizeni` z deklarovaného `zdroj` — typicky registr balíčků Forgejo, kam
je publikuje build v CI. Zadání majitele: „aby se spustil build, který balíček
nahraje do storage automaticky, aby uživatel nemusel".

- `ZARIZENI_ZDROJ_TOKEN` je token JEN pro čtení balíčků (`read:package`), ne
  `FORGEJO_TOKEN` — ten má širší práva a Coolify vkládá env appky do VŠECH služeb
  tohoto compose. `:-` jako ostatní VOLITELNÁ tajemství od operátora (`ANTHROPIC_API_KEY`,
  `COOLIFY_API_KEY`): generátor ho nevyrábí (v kontraktu doktora `external`), holé `${…}`
  patří jen hodnotám, které platforma SAMA generuje (brána env-doctor-contract-coverage).
  Prázdnota tu není tichá — spotřebitel ji hlásí: doplnění skončí `zdroj … vrátil 401`.
- `FORGEJO_URL` určuje JEDINÝ původ, na který se token přikládá
  (`services/storage-auth/src/lib/registr-zdroj.ts`, i při přesměrování). Adresa
  balíčku přichází z dat instance; token s ní mimo dům neodejde.
- Chybí-li token a zdroj ho vyžaduje, doplnění selže NAHLAS v logu storage-auth
  (`zdroj … vrátil 401`) a úložiště zůstane beze změny. Kiosku se přitom NIKDY
  nenabídne soubor, jehož otisk nesedí s deklarací (`GET /zarizeni/appky`).

## netbird-agent nenese alias cíle trasy (smyčka mesh-ingressu, 2026-09-30)

- **Naměřeno na produkci forku po kole 15.** Gateway dostal `STORAGE_AUTH_URL =
  <prefix>-storage-auth.mesh.<tld>:3005` a od svého restartu (16:09Z) nedošel do
  storage-auth ani jeden požadavek — tablety hlásily timeout u aktualizací
  i hlášení. `/__mesh_health` téhož ingressu přitom odpovídal `ok`.
- **Kořen:** alias `<prefix>-storage-auth` nesly DVĚ služby — storage-auth
  a netbird-agent (07da0ca43, 21. 8.). Mesh-ingress běží v netns agenta, takže mu
  Docker DNS přeložil cíl `reverse_proxy http://<prefix>-storage-auth:3005` na
  agenta samotného. Caddy proxuje dál i s Host hlavičkou trasy → znovu tatáž trasa
  → dokola; každé kolečko přidá `X-Forwarded-For`, až gateway skončí na
  `Headers Overflow Error` nebo `Gateway Timeout`.
- Do kola 15 se to neukázalo, protože gateway bez `STORAGE_AUTH_URL` padal na
  výchozí `http://storage-auth:3005` přímo po sdílené síti — mimo mesh.
- **Oprava:** agent má jen sítě, žádný alias cíle. Brána
  `cil-mesh-trasy-ma-alias-s-identitou` teď měří i JEDNOZNAČNOST držitele aliasu
  (právě jedna služba, nikdy hostitel netns ingressu). Na stavu před opravou našla
  totéž ještě u `imgproxy` (alias i na službě web v jádru) a u cosmos (`cosmos--node`
  jen na agentovi).
