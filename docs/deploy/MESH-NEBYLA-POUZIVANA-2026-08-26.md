# Mesh existovala a nepoužívala ji ani jedna služba

**Datum:** 2026-08-26
**Rozsah:** resolver topologie, edge-proxy, adresa netbird managementu, umístění služeb

Navazuje na [IDENTITA-INSTANCE-2026-08-25.md](IDENTITA-INSTANCE-2026-08-25.md),
kde je popsaná první vlna (realm vepsaný natvrdo do sdílené šablony).

---

## Shrnutí

Po odblokování fáze D se mesh postavila: netbird API odpovídalo, vznikly skupiny
i setup keys, a **oba uzly se připojily jako peeři** (`edge`, `frontend-core`,
oba `connected`). Přesto `api` i `extranet` dál vracely 404.

Příčina: **mesh sice existovala, ale nepoužívala ji ani jedna služba.** Všechen
provoz mezi službami tekl dál slotovou zónou (`*.backend.<tld>`), protože
odvození bylo přesvědčené, že mesh není zapnutá.

---

## Řetěz

```
MESH_ENABLED=false  (výchozí hodnota, nikdo ji nedeklaroval)
  → resolver plní *_UPSTREAM_MESH SLOTOVOU adresou místo meshové
    → edge se přepne do režimu `public`
      → veškerý provoz jde přes *.backend.<tld>
        → mesh je postavená, zaplacená a nevyužitá
```

Nic z toho nespadlo. Peer byl `connected`, kontejnery `healthy`, brány zelené.

### Kde všude ta hodnota bydlela

| místo | hodnota | poznámka |
|---|---|---|
| `scripts/lib/derive-domains.mjs` | `process.env.MESH_ENABLED ?? "false"` | **nejhlubší default** — resolver rozhodl sám |
| `config/domains.env` | `MESH_ENABLED=false` | a sourcuje se **až ZA** resolverem, takže na odvození stejně nemá vliv |
| `config/domains.env.example` | `MESH_ENABLED=false` | doplňuje jen prázdné klíče |
| `.env-prod-backup` | **chybí** | přitom právě sem podle hlášky cold-startu patří |

### Proč to nezachytila fail-closed pojistka

Cold-start ji má, a je správně napsaná:

> `MESH_ENABLED není deklarované — nevím, jestli tahle instance jede přes mesh.`
> `Mesh je architektura instance, ne volitelný doplněk; 'nevím' není 'ne'.`

Jenže `config/domains.env` tu proměnnou nastavovalo na `false`. Hodnota tedy
**nikdy nebyla prázdná** a pojistka se nikdy nespustila.

> **Obecné poučení:** výchozí hodnota v konfiguraci vypne fail-closed pojistku
> stejně spolehlivě jako její smazání — jen to není vidět v diffu.

Je to táž třída jako `preservedValue` u adresy managementu (níž) a jako realm
vepsaný natvrdo (první vlna): hodnota existuje, nic nespadne, smysl je pryč.

---

## Proměnná, která lhala jménem

Nejzávažnější zjištění není hodnota, ale **tvar**:

```
MESH_ENABLED=true   →  API_UPSTREAM_MESH = …api.mesh.<instance>.internal:3001
MESH_ENABLED=false  →  API_UPSTREAM_MESH = …api.backend.<tld>:3001
```

Proměnná, jejímž **jediným smyslem** je nést meshovou adresu, při vypnuté meshi
tiše nesla adresu nemeshovou. Konzument nemá jak poznat rozdíl — jméno slibuje
zónu, obsah je z jiné.

`EXTRANET_UPSTREAM_MESH` se v tom případě neemitovalo vůbec, takže bylo prázdné.

**Pravidlo:** proměnná jménem `*_MESH` musí nést meshovou adresu, nebo
NEEXISTOVAT. Nikdy jinou zónu pod meshovým jménem.

---

## Další vady odhalené po cestě

### edge-proxy: Host se neřídil režimem

`api_host` bral `API_MESH_HOST` **bezpodmínečně**, tedy i v režimu `public`.
Do hlavičky Host pak šlo meshové jméno, které Traefik na cílovém uzlu po veřejné
cestě nezná:

```
Host: <prefix>-core-gateway.backend.<tld>  → 404
Host: <prefix>-api.backend.<tld>           → 200
```

Upstream se trefil správně; chyboval jen název, kterým se edge představil.
Navenek to vypadalo, že routa chybí — přitom existovala a cíl odpovídal.

### edge-proxy: EXTRANET_UPSTREAM chyběl v mesh větvi

Nastavoval se jen ve větvi `public`. V mesh režimu tedy zůstal prázdný, Caddy
blok pro `extra` se nevygeneroval a extranet vracel 404 — ačkoli kontejner běžel
a doména byla v Coolify zaregistrovaná.

### NETBIRD_MGMT_HOST: pozorování držené jako deklarace

Agenti si mesh jméno mapují přes `extra_hosts` na `NETBIRD_MGMT_HOST`.
`generate-secrets` tu hodnotu držel přes `preservedValue`, takže jednou zapsaná
adresa přebíjela každou čerstvě zjištěnou — a přežila přesun managementu na jiný
uzel. Agenti pak mířili tam, kde nikdo neposlouchá, a **mlčky se nepřipojili**.

Adresa uzlu je **pozorování**, ne deklarace: mění se přesunem služby
i re-provisioningem hostitele. Odvozuje se proto z umístění služby při každém
běhu a do repa se nezapisuje.

⚠️ **Past při ladění:** derivace patří AŽ ZA veškeré sourcování env souborů.
Napoprvé stála hned za discovery — proběhla, zalogovala se, a pak ji `set -a`
sourcování přepsalo zpět. Aplikace dostaly starou hodnotu, protože sync čte
vygenerovaný soubor, ne shell.

### Umístění netbirdu neodpovídalo jeho vlastním závislostem

Katalog, profil i manifest shodně kladly netbird na jeden uzel, zatímco běžel
u svých startovních závislostí (`keycloak`, `pki`) na jiném. Deklarace se
rozešla s nasazením a nic to nevymáhalo.

**Kritérium pro umístění** (netbird je řídicí rovina meshe, takže na meshi stát
nemůže): stroj musí mít **odvoditelnou LAN adresu** — uzel, který má v Coolify
jen `host.docker.internal`, tím padá, protože vzdálený peer z toho adresu
nesloží. Ze zbylých kandidátů rozhoduje `depends_on`: držet netbird u pki
znamená, že se tahle závislost neprotne se sítí právě v okamžiku, kdy síť
neexistuje.

**Kolizní plocha se sousedním stackem** je jediná: `netbird-internal-tls`
publikuje na hostitele `NETBIRD_MESH_PORT`, všechno ostatní je jen `expose:`.
Port odděluje per-instance offset — doloženo třemi netbird stacky vedle sebe
na jednom uzlu.

---

## Co zůstává otevřené

Slotová nálepka (`frontend` / `backend` / `experimental`) nese **tři různé věci**
a zrušená je zatím jen ta nejmenší:

| rovina | co nese | stav |
|---|---|---|
| umístění | na kterém stroji služba běží | 31 služeb, 18 override, 33 řádků manifestu — **otevřené** |
| vnitřní zóna | `internal_pattern: {subdomain}.{server}.{internal_tld}` | **otevřené**, závisí na routách mimo repo |
| mesh-ingress | matchuje `Host = <endpoint>.<zóna>`, jinak 421 | dědí se z roviny 2 |

Rovina 2 nejde smazat jednostranně: `*.backend.<tld>` routuje pfSense na
konkrétní stroj, kdežto `*.<jméno-stroje>.<tld>` routované není. Zkrácení toho
segmentu jednou odřízlo Keycloak od světa a muselo se vrátit.

Slotová zóna je legitimní jako **technický přístup ke strojům zvenčí** (kde sedí
edge, kudy se netbird spojí, než mesh existuje). Není legitimní jako cesta
DOVNITŘ — tam patří jedině mesh.
