# Čtyři volitelné stacky: nedodělky, ne přežitky

**Datum:** 2026-09-09, doplněno 2026-09-14, **přeměřeno proti upstream main `ff946d474` 2026-09-25**
· **Stav:** evidence záměru, ŽÁDNÁ změna chování nasazení

`<prefix>-messaging`, `-model`, `-realtime` a `-observability-stack` jsou na měřené
instanci (profil `cloud-multi`) dlouhodobě `exited:unhealthy`. Rozhodnutí vlastníka
instance (2026-09-09): **nic z toho není přežitek, všechno chceme — jen to teď
nepotřebujeme.** Tenhle dokument to zapisuje tak, aby tomu rozuměly naše vlastní
skripty, ne jen člověk.

## Naměřený stav (ne odhad)

| aplikace | katalog `services.json` | tier | manifest skupina | vlna | `provision_when_env` |
|---|---|---|---|---|---|
| `realtime` | ano | optional | `backend` | 5 | **žádný** |
| `observability-stack` | **CHYBÍ** | — | `backend` | 8 | **nelze — není v katalogu** |
| `model` | ano | optional | `experimental` | 8 | `CHAT_GGUF_URL` ✓ (od `29d8f28c3`, 2026-09-13) |
| `messaging` | ano | optional | `backend` | 9 | **žádný** |

Doplňující fakta:

- `KNOWN_BROKEN` v [`scripts/aisha-redeploy.mjs`](../../scripts/aisha-redeploy.mjs)
  je **prázdná množina** — zbyla v ní jen historická poznámka o openclaw.
  Žádná z těch čtyř aplikací není nikde označená jako rozbitá nebo vypnutá.
- Profil `cloud-multi` má `tier_filter: ["required","important","optional"]`
  a `exclude: []` — tedy **všechny čtyři profil zahrnuje** a cold start je zakládá
  (u `model` jen tehdy, když instance deklaruje `CHAT_GGUF_URL`).
- Tři ze čtyř jsou v manifestu ve skupině `backend`, takže je
  `cold-start-verify.mjs` drží na **plné laťce**. Měkčí laťku pro
  „smí být schválně zastavené" má jen skupina `experimental` — z těch čtyř
  jenom `model`.
- Lokální zrcadlo (`local-dev`) je řeší správně: `tier_filter` bez
  `optional` + `exclude: [messaging, …]`. **Rozpor je pouze v cloudovém profilu.**

Poslední nasazení na měřené instanci podle Coolify API (změřeno 2026-09-14):

| aplikace | poslední pokus | výsledek | co z toho plyne |
|---|---|---|---|
| `messaging` | 2026-08-28 | `failed` | nedostal se do běhu |
| `model` | 2026-09-04 | `failed` | nedostal se do běhu |
| `observability-stack` | 2026-08-31 | `finished` (po jednom `failed`) | nasadil se, spadl až potom |
| `realtime` | 2026-09-06 | `finished` | nasadil se, spadl až potom |

## Jádro věci

Katalog umí přesně jedno slovo pro „tuhle službu chceme, ale zapne se, až bude
čím": **`provision_when_env`**. Čtou ho `coolify-story-init.sh`,
`aisha-cold-start.sh`, `aisha-env-doctor.mjs`, `derive-domains.mjs`
i `mesh-routing-doctor.mjs`; otázku „je lane zapnutá?" odpovídá jediné místo
[`scripts/lib/provision-gate.mjs`](../../scripts/lib/provision-gate.mjs)
(`--zapnuto <id>`, `--neprovisionovane`; `false`/`0`/`no`/`off` = výslovné „ne").
Dnes ho deklaruje pět služeb — `extranet`, `local-ingest`, `potok`,
`source-broker` a `model`.

**Tři ze čtyř (`messaging`, `realtime`, `observability-stack`) ho neříkají.**
Proto je cold start založí, vlny je nasazují, doctor je čeká zdravé — a ony sedí
červené, protože je nikdo nenakonfiguroval. Není to porucha, je to nevyslovený záměr.

## Cílový stav a co pro něj udělat

Pořadí = od nejmenší práce k největší. Nic z toho teď nespouštět. Každé
`provision_when_env` níže se vyhodnocuje v `provision-gate.mjs` — žádná vlastní
kontrola v jiném skriptu.

### `model` — malý model jen na testy
Cíl: lehký GGUF, který se dá stáhnout a rozjet kvůli testům, ne produkční inference.
1. ~~`config/services.json` → `model`: `"provision_when_env": "CHAT_GGUF_URL"`~~ — hotovo (`29d8f28c3`).
2. Vybrat malý model + `CHAT_GGUF_URL` a `CHAT_GGUF_SHA256` do trezoru instance.
   Compose je připravený ([`docker-compose.coolify-model.yml`](../../docker-compose.coolify-model.yml),
   proměnné `CHAT_GGUF_URL` / `CHAT_GGUF_SHA256`), sha256 je povinná — stahuje se z internetu.
3. `--only=model` (vlnu 8 už vlastní, sirotek to není).

### `messaging` — Matrix jen s Telegramem
Cíl: Synapse + **jediný** most, telegramový. Ne všech šest.
1. Compose to už umí: mosty jsou za `profiles: ["bridge-telegram"]`
   ([`docker-compose.coolify-matrix.yml`](../../docker-compose.coolify-matrix.yml)),
   takže se zapínají jmenovitě — ostatní zůstanou vypnuté samy od sebe.
2. Tajemství: `API_ID` + `API_HASH` z my.telegram.org a `BOT_TOKEN` od @BotFather
   (popsáno v [`config/external-secrets.required.env`](../../config/external-secrets.required.env)).
3. `provision_when_env` na příslušný telegramový klíč, aby instance bez něj
   messaging vůbec nezakládala.
4. Pozor na rozsahy docker sítí — historicky tenhle stack padal na jejich
   vyčerpání (`scripts/fix-docker-network-pools.sh`).

### `observability-stack` — Loki + Prometheus + Grafana
Cíl: chceme, je to infrastruktura. **Nejdřív ale patří do katalogu** — dnes
v `config/services.json` není vůbec, i když ho zakládá manifest, nasazuje vlna 8,
zná ho deploy workflow i `coolify-domain-doctor.mjs`. Bez katalogového záznamu
mu `provision_when_env` nejde ani napsat.
Závislost: potřebuje MinIO ze stacku `observability` (langfuse, vlna 4).
Runbook existuje: [`docs/deploy/OBSERVABILITY_STACK_RUNBOOK.md`](OBSERVABILITY_STACK_RUNBOOK.md).

### `realtime` — ws-gateway + event-worker
Cíl: infrastruktura, chceme. Ze čtyř je nejblíž „mělo by prostě běžet":
je v katalogu, `public: true`, veřejná tvář `live`, edge na něj má mířit.
Než se zapne, je potřeba zjistit, **proč** je dole: nasazení skončilo
`finished`, stack tedy nastartoval a spadl **až za běhu**. Příčinu hledat v logu
kontejnerů (ws-gateway, event-worker), ne v nasazovací cestě.

## Co tenhle dokument NEMĚNÍ

Záměrně žádná změna kódu. Doplnit `provision_when_env` znamená, že cold start
ty aplikace přestane zakládat — to je správný cíl, ale je to **změna chování
nasazení** a patří do vlastní změny s vlastní zelenou bránou, ne do zápisu záměru.

## Ověřeno / neověřeno

- **Přeměřeno čtením upstream main `ff946d474` (2026-09-25):** obsah `KNOWN_BROKEN`,
  služby s `provision_when_env` v katalogu (5, vč. `model`), chybějící katalogový
  záznam observability-stacku, existence `provision-gate.mjs`, telegramový profil
  v matrix compose, GGUF proměnné v model compose.
- **Ověřeno z Coolify API (2026-09-14, jedna instance):** výsledek posledního
  nasazení každé ze čtyř aplikací (tabulka nahoře).
- **Neověřeno:** proč `messaging` a `model` při nasazení selhaly a proč
  `realtime` a `observability-stack` po úspěšném nasazení za běhu spadly.
  Logy nasazení ani kontejnerů nikdo nečetl.
