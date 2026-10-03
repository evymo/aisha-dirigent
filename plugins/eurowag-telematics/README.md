# Eurowag Telematics

REST/JSON konektor **Eurowag Telematics customer API** (nástupce Webdispečink SOAP).

**Stav: zapojený plugin `data_source`**, administrovatelný z administrace přes
ingest (stejně jako Webdispečink, T-cars, Money a AVP). `manifest.json` má
`source_spec.adapter_entry`, `src/index.ts` běží v sandboxu (crony + capability).

**0.2.1 (2026-09-28): data doopravdy celá.** Změřeno proti ostrému API: `/drivers`
i `/trips` stránkují (výchozí 12, max 29) a 0.2.0 četla jen první stránku — 12 z 59
řidičů a nejvýš 12 jízd na vozidlo za okno. Řidič u jízdy má klíč `id` (0.2.0 četla
`driver_id` → každá jízda bez řidiče). Časy jízd jsou UTC bez zóny (ukládají se
se `Z`). Token endpoint za Cloudflare odmítá knihovní User-Agent a sandbox žádný
nepřidává → plugin posílá vlastní (`userAgent`).

**0.2.0 (2026-09-27): obecná surová dráha, žádná dvojčata, žádné polohy.**
Plugin ukládá, co Eurowag tvrdí, do `source_catalog_rows` (zdroj
`eurowag-telematics`) a na dvojčata to přenáší jádro — jen přes POTVRZENÉ vazby
identity. Verze 0.1.0 zakládala dvojčata sama a psala události přímo (proti
rozhodnutí majitele z 24. 9. a s prázdnou sandbox politikou, která by jí nic
nepustila).

| soubor | obsah |
|---|---|
| [src/index.ts](src/index.ts) | plugin: `init`/`handle`/`dispose`, crony, zápis na surovou dráhu, kurzory |
| [src/katalog.ts](src/katalog.ts) | mapování Eurowag záznamů → řádky surové dráhy (bez poloh) |
| [src/ew-client.ts](src/ew-client.ts) | transportní klient (Keycloak token, api_key, GET-only) + korekce vendor lží |
| [src/tests/](src/tests/) | unit testy klienta a celé sync dráhy (bez sítě) |

## Co se ukládá

| capability | co | `kind` (režim) | pak |
|---|---|---|---|
| `cron.sync_fleet` | vozidla (`monitoredObjectId`, SPZ `rn`) + řidiči (jméno) | `vehicle`, `driver` (snapshot) | `ew_propose_identity` — návrhy vazeb |
| `cron.poll_vehicle_states` | tachometr (km), hladina (l), zapalování — **bez polohy a rychlosti** | `vehicle_state` (series) | `ew_project_catalog` |
| `cron.sync_trips` | jízdy per vozidlo: km, spotřeba, l/100 km, doba, CO₂, řidič — **bez míst** | `trip` (series) | `ew_project_catalog` |
| `http.GET./vehicles-states`, `/drivers`, `/trips` | read-only náhledy (náhled stavů bez souřadnic) | — | — |

Na dvojčata (jádro, `ew_project_catalog`): jízda → `trip` na vozidle
(`eurowag-telematics:trip`; do nájezdu se podle katalogu nesčítá — pravdou pro
kilometry je Webdispečink —, spotřeba `trip_consumption_l` ano), stav →
`vehicle_state` (`eurowag-telematics:vehicle-state`; hladina a tachometr pro
katalog). Klíče identity nesou druh: `vozidlo:<monitoredObjectId>`,
`osoba:<driver id>` (vazba je jedinečná bez druhu entity).

Poll stavů je výchozí **hodinový** (rozpočet API 2 000/den je sdílený
s Webdispečinkem); `vehicleStatePollSeconds: 0` poll **vypne** (ne „každou
minutu"). Jízdy jsou **per vozidlo** — per-vozidlo try/catch, pauza + strop
volání, okno s **překryvem 48 h** a kurzor, který se posune jen když celé okno
bez chyby doběhlo. Selže-li návrh nebo projekce, uložené zůstane a běh skončí
**chybou** se zprávou (blok stavu zdrojů v administraci ji ukáže).

```bash
cd plugins/eurowag-telematics && npx vitest run   # unit testy (bez sítě)
```

Přístupy **nejsou a nesmí být v repozitáři** — chodí v `ctx.config` z administrace
(`apiKey`/`username`/`password` jsou v `config_schema` označené `"secret": true`).

## Ruční probe (mimo cron)

```bash
node --experimental-transform-types plugins/eurowag-telematics/probe.ts
```

Pro jednorázové ověření živě — přihlásí se, vypíše stav celé flotily, počet
řidičů a jízdy jednoho vozidla za posledních 7 dní. Bere přístupy z
kořenového `.env` monorepa (mimo repo, jen pro ruční ladění — produkční cesta
je pořád `ctx.config` výš), **ne** ze secret store. Používá stejný
`ew-client.ts` jako produkce — žádná druhá implementace auth logiky.

⚠️ **`--experimental-transform-types`, ne `--experimental-strip-types`.**
Klient používá TS parameter properties (`constructor(readonly status: number,
...)`), které čisté odstranění typů (jak to dělá `avp-portal/probe.ts` v jiném
repu) neumí — spadne na `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.

Ověřeno naživo 28. 9. 2026: 16 vozidel, 59 řidičů.

## Auth — dvě věci, co se snadno spletou

1. Bearer je z **Keycloak password grantu proti realmu Eurowagu**
   (`login.eurowag.com`), ne proti platformnímu realmu a ne API klíč.
2. API klíč jde jako **query parametr u každého volání** (`api_key`). Platný bearer
   bez něj server odmítne. Klient ho přidává centrálně, aby ho žádné volání nezapomnělo.

> **Past:** `configuration.json` obsahuje `client_id: "34210"` — to je **číslo
> zákazníka**, ne OAuth klient. S ním vrátí server `invalid_client`. OAuth klient
> je `dfo-client` (default v manifestu).

> **Past (Cloudflare):** `login.eurowag.com` je za Cloudflare a na knihovní
> User-Agent (`node`, `curl`, Python) vrací 403 challenge / `Error 1010`.
> ⛔ Sandbox `fetch` **žádný UA nepřidává** (broker předá jen hlavičky pluginu,
> Node pak pošle `node`) — dřívější tvrzení „sandbox posílá UA prohlížeče“ bylo
> nepravdivé. Klient proto posílá `userAgent` z administrace, výchozí je
> prohlížečový. Při opakovaných špatných pokusech Cloudflare dočasně zpřísní
> i prohlížečový UA — ladit šetrně. Chyba běhu Cloudflare pojmenuje.
>
> Token: Keycloak vrací `expires_in` 300 s a (od 09/2026) `refresh_expires_in`
> 36 000 s; plugin přesto razí password grantem — běh je hodinový, token by
> mezi běhy stejně vypršel.

Token žije ~300 s a free tier má 2000 volání/den, proto si ho klient cachuje a
razí znovu těsně před vypršením, ne u každého volání.

## Pole, která jsou vyplněná, ale nepravdivá

Korekce žijí v klientu / mapperu, protože kontrola úplnosti je nevidí:

| pole | jak vypadá | co to je |
|---|---|---|
| `startTime`, `endTime` (jízda) | `2026-09-28T10:11:09` | **UTC bez zóny** — konec poslední jízdy = `last_change_state` (`+00:00`) na sekundu; ukládá se se `Z` |
| `drivers[]` (jízda) | `{id, isMain, name, surname, sso_id}` | klíč je **`id`**, ne `driver_id`; hlavní řidič = `isMain` |
| `odometer`, `distance` | `377261330` | **metry**, ne kilometry (`odometerKm` dělí tisícem) |
| `totalConsumption` | vyplněné na 100 % záznamů | `-1.0` je **sentinel „neznámo"** (`consumptionLiters` → null) |
| `consumption_liters_100km` | `281.69` | dopočet z krátké jízdy, fyzicky nemožný — pásmo přes `maxPlausibleConsumptionPer100km` |

## ⚠️ Omezení customer-api (ověřeno 3. 9. 2026, doplněno 28. 9.)

- **Stránkování:** `/drivers` (`{data, limit, offset, total}`) a `/trips` (holé pole,
  bez total) mají `limit` výchozí 12 a **max 29** (`limit=30` → 422). Klient čte do
  konce; strop `tripCallBudget` počítá stránky. Pojistka: 200 stránek → chyba.
- `configuration.filter` 28. 9.: **16 objektů** (dřív 6) — plugin čte, co filtr pustí.
- `/vehicles-states` občas vrátí 500 (28. 9. jednou, hned nato 200) — běh skončí
  chybou a příští termín to zopakuje.

- `vehicles-states.fuelTanks[].level` chodí jen u **starých vozů** (monitored-objecty
  `312xxx`); **nové tahače `530xxx` vrací `level: null`** a i **tachometr zkrácený**
  (počítadlo od instalace jednotky), přestože appka Webeye u nich hladinu i plný
  nájezd ukazuje. Není to chyba pluginu — data se pro tyto objekty do customer-api
  exportu nemapují. Řeší se s Eurowagem (viz `../../pozadavek-eurowag-palivo-tahace.md`).
- **Hladina v % (`FuelTankLevel.perc`)** je jen ve schématu `ActivityInterval`
  (přes `/v1/transports`); ten je pro tenhle účet prázdný (nepoužívá se dispečink
  zakázek), takže `perc` přes customer-api nedostaneme.
- `configuration.filter` škáluje klíč na výsek flotily — analýzy nad ním nemusí
  pokrývat každé vozidlo. `technical_account_*` je `null` (osobní účet s MFA);
  do provozu patří technický účet z EW Office.

## Onboarding

Než se zdroj zapne, prochází
[SOURCE_ONBOARDING_CONTRACT](../../docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md) —
klasifikace, consent, namespace ACL a approval. Registrace zdroje (neaktivní,
`is_active=false`) je v `<fork>-instance-data/63_eurowag_zdroj.sql`.
