# Nasazovací tok: kompletní mapa závislostí

**Pravidlo majitele (2026-08-24):** *„Vše, co je nutné k postavení meshe, nahodit.
Pak mesh. Pak přestěhovat do meshe a připravit edge. Potom dotáhnout zbytek.
Jediná výjimka by byla, kdyby netbird management potřeboval edge — jinak vše
vnitřkem; nikdo dovnitř jinak než přes mesh. Cíl je bezpečnost a izolace provozu."*

Tahle mapa je odvozená z **naměřených** závislostí (každá hrana má důkaz),
ne z toho, jak jsou vlny zrovna napsané.

## Naměřené hrany

| co | potřebuje | důkaz |
|---|---|---|
| `pki` | nic (kořen důvěry) | staví se první, bez závislostí |
| `registry` | nic (cache obrazů) | dtto |
| `core` (db, postgrest, gateway…) | pki (certy), registry | `pki-init` volume, NODE_EXTRA_CA_CERTS |
| `keycloak` | `core.db` | KC_DB; realm vzniká `--import-realm` při PRVNÍM startu (naměřeno: realm `aisha` = 200 vnitřně bez jakéhokoli provisioningu) |
| `netbird management` | **VNITŘNÍ** KC discovery při bootu | `management.go:252` exit 1 bez ní; `OIDCConfigEndpoint=${KEYCLOAK_URL_FROM_CLUSTER}/…` — **edge NEpotřebuje** |
| setup klíče (ražba) | běžící management + bootstrap uživatel v KC | `netbird-bootstrap.sh` (mgmt API, token uživatele `aisha-bootstrap`) |
| mesh agenti (sidecary všech stacků) | management + setup klíč | bez nich `wt0` nevznikne; zdraví agenta = členství v meshi |
| zdraví appky v Coolify | zdraví VŠECH kontejnerů | ⇒ každá appka s agentem je `running:unhealthy`, dokud mesh není |
| `edge` | mesh trasy na vnitřky (auth, web, api, extranet) | bez meshe nemá kam směrovat; veřejné povrchy = 503 dokud edge nestojí |
| `shared-redis` | mesh (je to peer, TCP trasa v netns agenta) | naměřeno 2026-08-22: dřív než mesh ⇒ agent se nemá kam zapsat |
| konzumenti Redisu (edge — odvolání tokenů, realtime) | shared-redis dosažitelný | fail-closed kontrola odvolání: nedostupný Redis = 8s timeouty (naměřeno ráno 2026-08-24) |
| operátorský provisioning (bootstrap user, provision-sso, Apple secret) | KC admin API dosažitelné Z OPERÁTORA (mimo mesh) | **jediný off-mesh šev celého toku** — viz níž |

## Cílový tok (= pravidlo majitele, beze změn)

```
KROK 1 — co mesh potřebuje (vše VNITŘNÍ, žádná veřejná plocha):
  vlna 0  netinit        hostitelské sítě
  vlna 1  registry       cache obrazů
  vlna 2  pki            kořen důvěry
  vlna 3  core           db + postgrest + gateway (na kontejnerové síti)
  vlna 4  keycloak       auth; realm vznikne --import-realm

  » operátorský šev: bootstrap uživatel + SSO secrety (KC admin API) «

KROK 2 — mesh:
  vlna 5  netbird        management si OIDC bere VNITŘNÍM jménem (naměřeno)
          + ražba setup klíčů (potřebuje bootstrap uživatele z KROKU 1)

KROK 3 — přestěhovat do meshe + připravit edge:
  vlna 6  redeploy registry + pki + core + keycloak (agenti se zapíšou)
          + EDGE (poprvé — směruje veřejné → mesh; jeho agent se zapíše rovnou)
  vlna 7  shared-redis (mesh peer, PRVNÍ nasazení až tady) + OIDC appky

KROK 4 — zbytek (vše meshem):
  vlna 8  services
  vlna 9  messaging
  vlna 10 edge — finální otevření dveří (ověření, žádný nový stavební krok)
```

**Výjimka, kterou majitel připustil, NENÍ potřeba:** netbird management si OIDC
bere vnitřním jménem (`KEYCLOAK_URL_FROM_CLUSTER`), na edge nezávisí — ověřeno
v šabloně i pádem, který nastal, když ta hodnota chyběla.

## Jediný off-mesh šev: operátor → KC admin API

Bootstrap uživatele a SSO secrety razí skripty z operátorova stroje, který
v meshi z definice není. Mechanismus na to EXISTUJE: `KEYCLOAK_DOMAIN_DIRECT` =
„KC Traefik direct router" — vlastní router Keycloaku na HOSTITELI, nezávislý
na meshi i na edge. Vada byla jen v hodnotě: derivace do něj dala VNITŘNÍ
jméno (`…backend.<internal>`), které operátor nepřeloží — dosazení popřelo
účel proměnné.

Správná hodnota je jméno, které se přeloží na hostitele a NEJDE přes edge
(sslip tvar `auth.<ip-hostitele>.sslip.io`, dosažitelný jen z LAN). Žádné
dveře se tím neotvírají dřív: pfSense ven pouští jen edge.

## Co bylo 2026-08-24 špatně (moje zásahy) a jak to mapa narovnává

1. **Edge ve vlně 4** („dveře pro bootstrap") — MIMO pravidlo. Otevíral
   veřejnou plochu před meshem kvůli švu, který má vlastní mechanismus
   (DIRECT router). → Edge patří do KROKU 3 (vlna 6 + finále 10).
2. **`KEYCLOAK_DOMAIN_DIRECT` dosazený mesh jménem** → operátorská fáze B
   cyklila nad 000, zatímco KC běžel zdravý. → DIRECT = hostitelské jméno.
3. **Tvrdé brány před meshem** vyžadovaly `running:healthy`, které v tom okně
   nemůže nastat (zdraví agenta = členství v meshi) → kaskáda 32 zastavených
   aplikací. → V okně před vlnou 5 je `running:unhealthy` očekávaný stav;
   `exited`/`restarting` zůstávají chybou vždy.
4. **Měkké selhání vracelo tvrdý kód** (clamav zastavil bootstrap) → kód 3
   = „jen měkké/bootstrap okno", volající pokračuje hlasitě.
