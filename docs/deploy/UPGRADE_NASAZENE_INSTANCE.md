# Upgrade UŽ NASAZENÉ instance — klíče, které compose nově vyžaduje

Compose soubory v tomhle repu čtou konfiguraci stráží `${KLÍČ:?…}` — bez
dosazeného literálu, fail-loud. Stráž má ale smysl jen s PLNIČEM: hodnotu musí
někdo zapsat do `.env.coolify` a `scripts/coolify-sync-envs.sh` ji pak roznese
na aplikace v Coolify (posílá **jen** klíče, které v `.env.coolify` leží).

## Jak se klíče doručují (změřeno 2026-09-12)

| cesta | kdo do `.env.coolify` ZAPISUJE | kdo roznáší |
|---|---|---|
| cold-start (`scripts/aisha-cold-start.sh`) | heredoc cold-startu → heal pass `scripts/aisha-env-doctor.mjs` (APPLY) | `coolify-sync-envs.sh` |
| redeploy (`npm run redeploy`, `scripts/aisha-redeploy.mjs`) | **jen** `aisha-env-doctor.mjs` (APPLY, `srovnejOdvozeneKlice`) | `coolify-sync-envs.sh <app>` |

Z toho plyne pravidlo, které hlídá brána
`src/tests/gates/deklarace-v-compose-ma-zapisovatele.gate.test.ts`: klíč, který
zapisuje **jen** heredoc cold-startu, se k už nasazené instanci redeployem
NIKDY nedostane. Instance nasazená před přidáním takového klíče ho v Coolify
env nemá — a první redeploy (i ten, který spustí Coolify samo po restartu
serveru) spadne na interpolaci compose.

## Obecný postup: co aplikace NEMAJÍ, se změří — nehádá (od 2026-09-13)

Tabulka výš říká, kudy klíč teče. Jestli do aplikace opravdu DOTEKL, se dřív
nezjišťovalo — až nasazením, které spadlo. Naměřeno 2026-09-13 po slití forků:
20 z 32 aplikací nemělo v Coolify povinnou proměnnou svého compose (8 klíčů),
přestože `.env.coolify` byl pro polovinu z nich v pořádku.

Otázku „dostane compose téhle aplikace všechno, bez čeho spadne?" teď klade
jedna knihovna, `scripts/lib/povinne-promenne.mjs`, na čtyřech stanovištích:

| stanoviště | co udělá s nálezem |
|---|---|
| `cold-start-doctor.sh` fáze P | vypíše aplikace, klíče a **příkaz**: co je v `.env.coolify` → `KEYS=… coolify-sync-envs.sh <appky>`; co tam není → nejdřív env-doktor |
| `coolify-sync-envs.sh` (read-back po zápisu) | aplikaci označí za selhanou; `REDEPLOY=1` ji nenasadí; `aisha-redeploy.mjs` se tím zastaví před nasazením |
| CI `deploy-and-verify.sh` (před zápisem revize) | nasazení NESPUSTÍ a pojmenuje chybějící klíče (CI nemá `.env.coolify`, doplnit neumí) |
| lokálně: `local-compose-gen.mjs` / `local-warmup.sh` | vypíše VŠECHNY mezery naráz (docker hlásí jen první); znovupoužitý stack starší než jeho compose odmítne |

Postup po merge, který přidal `${KLÍČ:?}`:

```bash
# 1. co aplikacím chybí (jen čte; ~1 volání na aplikaci)
bash scripts/cold-start-doctor.sh --phase P
# 2. co v .env.coolify není, doplní env-doktor (odvoditelné) nebo řekne, že je to vstup obsluhy
node scripts/aisha-env-doctor.mjs
# 3. roznést JEN vypsané klíče vypsaným aplikacím (plný sync přepisuje hodnoty bootstrapu)
KEYS=<klíče z kroku 1> bash scripts/coolify-sync-envs.sh <appky z kroku 1>
# 4. znovu krok 1 — musí vyjít „N/N aplikací má povinné proměnné compose doručené"
```

Totéž jde bez doktora přímo: `node scripts/lib/povinne-promenne.mjs --coolify
--prefix <prefix> --env-file .env.coolify`.

## `PKI_BUNDLE_REQUIRED` (od 2026-09-12; 18 compose souborů)

**Co se stalo.** Base `fcd9156c1` měl v compose `${PKI_BUNDLE_REQUIRED:-true}` a
heredoc klíč nepsal. Slití forku přineslo `${PKI_BUNDLE_REQUIRED:?}` + zápis
v heredocu — tedy plnič jen při cold-startu. Instance nasazené z base klíč
v Coolify env nemají.

**Oprava v repu.** Odvození má jeden domov
(`scripts/lib/derive-pki-bundle-required.mjs`: manifest příběhu nasazuje
`app: pki:` ⇒ `true`, jinak `false`) a volá ho cold-start i CONTRACT
env-doktora (`derived`). Redeploy tedy klíč doručí sám: env-doktor ho odvodí
z manifestu instance a zapíše, sync roznese.

**Co musí udělat operátor už nasazené instance PŘED prvním redeployem z
Coolify UI / po restartu serveru** (redeploy přes `npm run redeploy` to dělá
sám, ale Coolify-side restart ne):

```bash
# 1. doktor odvodí PKI_BUNDLE_REQUIRED z manifestu instance a zapíše ho do .env.coolify
node scripts/aisha-env-doctor.mjs
grep '^PKI_BUNDLE_REQUIRED=' .env.coolify      # true (příběh nasazuje pki) / false (nenasazuje)

# 2. roznést JEN tenhle klíč (plný sync by přepsal hodnoty vlastněné bootstrapem,
#    např. AISHA_PKI_ISSUER_CLIENT_SECRET — viz KEYS= v coolify-sync-envs.sh)
KEYS=PKI_BUNDLE_REQUIRED bash scripts/coolify-sync-envs.sh
```

Hodnota: `true`, když manifest instance (`coolify/manifests/<story>.manifest`,
overlay má přednost) obsahuje řádek `app: pki:`; jinak `false`. Operátorský pin
`PKI_BUNDLE_REQUIRED=false` v `.env-prod-backup` vyhrává (s nasazenou PKI smí
požadavek na bundle vypnout); bez nasazené PKI se `true` zapnout nedá.

Když doktor napíše `PKI_BUNDLE_REQUIRED se neodvodil (manifest instance
nenalezen)`, chybí deklarace identity (`APP_NAME_PREFIX` / `AISHA_STORY`) nebo
overlay s manifestem (`AISHA_INSTANCE_CONFIG_DIR`) — doplň je a spusť znovu,
prázdný klíč se rozesílat nemá.

## `FEDERATION_VAULT_KEY` (trezor relací brokeru zdroje, ADR-004)

**Týká se jen instancí s aplikací `source-broker`** (cold-start ji zakládá, jen když
je nastavené `SOURCE_API_URL`). Klíč šifruje tokeny uživatelů u zdroje a žije
jen v env brokeru, nikdy v DB.

**Proč tu je, ačkoli compose nemá `${…:?}`.** Stráž `:?` by klíč vtáhla do
build-time množiny a Coolify by ho zapekl do `docker history`. Compose ho proto
interpoluje holé a povinnost nese pole `x-aisha-povinne-za-behu` — předlet
(`povinne-promenne.mjs`, tedy všechna čtyři stanoviště z tabulky výš) ho hlídá
jako povinný a neprázdný. Broker bez platného klíče navíc nenastartuje.

**Kdo ho doplní sám:** `npm run redeploy` (env-doktor ho jako `hex` 32 B vygeneruje,
jen když chybí, sync roznese). **CI Deploy ne** — nemá `.env.coolify`; nasazení
`source-broker` na předletu zastaví, starý kontejner běží dál.

**Před sloučením PR (ze stromu PR, s `.env.coolify` instance):**

```bash
# 1. vygeneruje FEDERATION_VAULT_KEY, JEN když chybí — existující nikdy nepřepisuj:
#    nový klíč = uložené relace nejdou otevřít (rotace je nástroj, ne ruční krok)
node scripts/aisha-env-doctor.mjs
# 2. roznést JEN tenhle klíč jen brokeru
KEYS=FEDERATION_VAULT_KEY bash scripts/coolify-sync-envs.sh source-broker
# 3. ověřit — source-broker musí vyjít bez nálezu
node scripts/lib/povinne-promenne.mjs --coolify --prefix <prefix> --env-file .env.coolify
```

Starý broker proměnnou navíc ignoruje, takže doručení předem nic nerozbije.
Instance vynechaná před sloučením: předlet CI pojmenuje `FEDERATION_VAULT_KEY`,
kroky 1–3 z nového mainu, pak úlohu nasazení znovu.

## `KEYCLOAK_ADMIN` (realm-sync v `docker-compose.coolify-keycloak.yml`)

Žádný krok není potřeba: heredoc ho psal už v base (`KEYCLOAK_ADMIN=admin`) a
env-doktor ho drží v CONTRACT jako `static` — redeploy ho doplní, pokud by
chyběl. `realm-sync` je služba TÉHOŽ stacku jako `keycloak`, tedy dostává týž
env.

## `POSTGRES_MAJOR` (build-arg `PG_MAJOR` služeb `db` a `pgbackrest` v `docker-compose.coolify.yml`)

Major verze platformního PostgreSQL je parametr instance. Domov hodnoty pro nové
instance je `config/image-versions.env`; env-doktor ji drží v CONTRACT jako
`required-static` — zapíše ji jen tam, kde klíč chybí, a instance si ji pak
**drží**. Změna domova proto běžící instanci nepřepne.

**Co musí udělat operátor už nasazené instance PŘED prvním redeployem core:**

⛔ Od 2026-09-15 je domov hodnoty **18**. Instance, jejíž data jsou na 17 a která
klíč v `.env.coolify` ještě nemá, si ho musí zapsat SAMA — jinak ho env-doktor
doplní z domova (18) a obraz 18 nad daty 17 odmítne start. Verzi dat změř, nehádej:

```bash
# verze dat (na db instance)
psql -tAc "SELECT current_setting('server_version_num')::int / 10000"
grep '^POSTGRES_MAJOR=' .env.coolify          # klíč, který instance drží
# chybí-li: zapiš verzi dat do deklarace instance (.env-prod-backup), pak
node scripts/aisha-env-doctor.mjs
KEYS=POSTGRES_MAJOR bash scripts/coolify-sync-envs.sh
```

Ověř, že hodnota odpovídá datům instance (`SELECT current_setting('server_version')`
na db). Obraz jiné major verze nad existujícími daty `entrypoint-wrapper.sh`
odmítne spustit (`data v … jsou PostgreSQL 17, obraz je PostgreSQL 18`) — to je
záměr, ne chyba konfigurace.

Přechod instance na jinou major verzi popisuje
[POSTGRES_UPGRADE.md](POSTGRES_UPGRADE.md).
