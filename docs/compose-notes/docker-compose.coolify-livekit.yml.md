# docker-compose.coolify-livekit.yml — notes

Prose extracted from `docker-compose.coolify-livekit.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-common: &common`

=============================================================================
Evymo LiveKit + Coturn Stack — Real-Time Media (Coolify Production)
=============================================================================
LiveKit: SFU media server for video consultations + walkie-talkie PTT
Coturn: TURN relay for NAT traversal (symmetric NAT, corporate firewalls)

Shares aisha-network with core stack so edge functions can reach LiveKit API.
Element Call (Matrix stack) uses LiveKit as media backend via matrix-rtc-auth.

Required Coolify env vars:
  LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_DOMAIN,
  TURN_DOMAIN, TURN_STATIC_SECRET

Optional:
  LIVEKIT_LOG_LEVEL (default: info)

→ Coolify docker_compose_domains:
    livekit.backend.id3a.cz → livekit:7880
=============================================================================

## `livekit-config-init:`

---------------------------------------------------------------------------
livekit-config-init — bakes livekit.yaml into a named volume.
Workaround for Coolify bind-mount trap where ./coolify/livekit.yaml on the
cloned repo path silently turns into a directory inside the container.
See /memories/repo/coolify-bind-mount-trap.md
---------------------------------------------------------------------------

## `command: ["sh", "-c", "envsubst < /config/livekit.yaml > /out/livekit.yaml && echo 'livekit config staged'"]`

envsubst expands ${TURN_DOMAIN}, ${LIVEKIT_LOG_LEVEL}, key/turn credentials
in the YAML before livekit-server reads it (LiveKit YAML does NOT support
env var expansion natively).

## `livekit:`

---------------------------------------------------------------------------
LiveKit — SFU Media Server
---------------------------------------------------------------------------

## `- "7882:7882/udp"`

UDP port range for WebRTC media (host networking for UDP performance)

## `- "7880"`

WSS: signaling (Traefik terminates TLS)

## `- "7881"`

TCP: RTC fallback

## `coturn-config-init:`

---------------------------------------------------------------------------
coturn-config-init — bakes coturn.conf into a named volume (bind-mount trap)
---------------------------------------------------------------------------

## `coturn:`

---------------------------------------------------------------------------
Coturn — TURN/STUN Relay Server
---------------------------------------------------------------------------

## `- "3478:3478"`

STUN/TURN TCP

## `- "5349:5349"`

STUN/TURN TLS

## `- "49152-49200:49152-49200/udp"`

Media relay UDP range

## `internal:`

Per-host bridge — služby na stejném hostu sdílejí síť přes konzistentní `name`.
Cross-host komunikace jde přes Netbird mesh DNS (<svc>.aisha.netbird).

## `ports:`

Táž parametrizace jako u coturn níž: médiový UDP port je hostitelský zdroj,
takže musí unést dvě instance na jednom stroji. 7880/7881 zůstávají jen
`expose` — ty jdou po meshi a hostitele se netýkají.

## `ports:`

Publikované porty nesou identitu instance stejně jako container_name,
volumes a sítě výš. Byly jediný sdílený zdroj v tomhle souboru, který ji
NEnesl — a hostitelský port je přitom nejtvrdší sdílený zdroj ze všech:
druhý nájemník ho prostě nedostane. Naměřeno 2026-08-12 na sdíleném hostu:
`driver failed programming external connectivity`, coturn se nespustil a
vzal s sebou celou vlnu 2.

Coturn na mesh přesunout NELZE — je to relay pro průchod NATem, tedy pro
externí klienty; na meshi by na něj nikdo zvenčí nedosáhl. Potřeba portu
je tedy legitimní, fixní číslo nikoli.

⛔ ŽÁDNÉ VÝCHOZÍ HODNOTY (rozhodnutí majitele 2026-09-15). Dřív tu stály
standardní STUN/TURN porty jako default — a default je právě ten tichý nárok,
kvůli kterému coturn 2026-08-12 prohrál závod o 3478/5349. `LIVEKIT_RTC_PORT`,
`TURN_PORT` a `TURN_TLS_PORT` jsou RUČNÍ deklarace operátora
v `.env-prod-backup` (forward na firewallu nastavuje člověk), compose je nese
`${X:?…}` a instance s livekitem bez deklarace spadne hlasitě při interpolaci.
Env-doktor klíče zapisuje prázdné (bez literálu), aby šly doručit; vlastnost
hlídá brána `udp-port-je-rucni-deklarace`.

⚠️ `TURN_RELAY_PORTS` zatím default nese — je to vedený dluh brány. Hostitelský
ROZSAH musí mít stejnou délku jako rozsah v `coolify/coturn.conf` (jinak compose
odmítne `invalid ranges`), takže deklarace musí nést i konfiguraci coturnu.

## `external: true`

EXTERNAL — zakládá ji táž warmup aplikace, se subnetem z MESH_DNS_SUBNET
(mesh-router si na téhle síti pinuje ipv4_address, takže rozsah musí být
náš, ne náhodný z Dockeru).
