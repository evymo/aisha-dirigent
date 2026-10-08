# CI/CD Pipeline

## Architektura

```
┌─────────────────────────────────────────────────────────────────┐
│               Forgejo Actions (git.id3a.cz)                     │
│               Runner: DinD (coolify/apps/forgejo)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  🔍 detect  ──┬──► 🧪 check (TypeScript, Lint, i18n)            │
│  (changes)   │                                                   │
│              ├──► 🧪 test (Unit, Gates)                         │
│              │                                                   │
│              ├──► 🏗️ build (Vite production build)              │
│              │                                                   │
│              └──► 🚀 deploy (Coolify webhook)                   │
│                       └─► Coolify builds + deploys              │
│                           (docker-compose.coolify-prebuilt.yml) │
│                           migrate → web                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Smart Routing

Pipeline automaticky detekuje co se změnilo a přeskočí irelevantní joby:

| Změna | check | test | build | deploy |
|-------|-------|------|-------|--------|
| Jen docs | skip | skip | skip | skip |
| Jen migrations | ✅ | ✅ | skip | ✅ (migrate service) |
| Jen code | ✅ | ✅ | ✅ | ✅ |
| code + migrations | ✅ | ✅ | ✅ | ✅ |

Výjimka z tabulky: **brány (Web: Brány) běží při každé změně**, i jen v docs —
od 2026-10-05 je to jediné místo, kde se měří celá sada (viz níž).

## Plné sady jen v CI, místně cíleně (rozhodnutí majitele 2026-10-05)

Celá sada bran (obě dráhy), unit testy webu, `test:services`, build i integrační
dávky se měří **na runneru**. Místně (`.husky/pre-push`) běží jen to, co je levné
a celorepové, a testy změněných částí. **Slučuje se jen podle závěrů jobů v CI**
(`npm run ci:verdikt`), ne podle zelené pre-pushe.

Důvod: stroj s 11+ souběžnými relacemi se dusil (swap 9,5/11 GB, load 250+)
a pre-push integrační dávky — který dosud při merge commitu v rozsahu pouštěl
vždy celou sadu — spadl na 37 timeoutech zátěže a blokoval produkční opravu.

| kde | co běží |
|---|---|
| pre-push, vždy | preflight, `tsc --noEmit`, `lint`, `validate:static`, `i18n:check` |
| pre-push, cílená dráha | brány dotčené změnou · sady dotčených `services/`, `packages/`, `plugins/`, `extensions/` · unit a script testy, které změněné moduly přímo importují (nebo se samy změnily) |
| pre-push, širší dráha | totéž, jen místo výběru bran **celá lehká dráha** + vybrané těžké brány |
| pre-push, `AISHA_PREPUSH_VSE=1` | plná sada jako před 2026-10-05 (jediný režim, který zapisuje cache zelených stromů) |
| CI | všechno celé: Web: Brány (od 2026-10-05 bez podmínky na `app`), Web: Tests, Services: Tests, Web: Build, Extension, n8n, … |

Jak se rozhoduje (jeden domov pravidel, žádná kopie):

- **Co se mění** — `scripts/ci/prepush-vyber.sh` volá týž směrovač jako CI
  (`scripts/ci/zmenene-cesty.sh`). Báze = **společný předek s `<remote>/main`**:
  integrační dávka s merge commity se posuzuje rozdílem stromů proti mainu
  (co do mainu přinese, včetně řešení konfliktů), ne „vše" a ne to, co si z mainu
  stáhla. Přidávají se i necommitnuté a netrackované cesty.
- **Které brány** — `scripts/test/brany-dotcene.mjs` nad `src/tests/gates/lanes.json`:
  kategorie (kurátorská mapa) · změněná brána sama · brána, jejíž zdroj jmenuje
  změněnou cestu nebo kořen jejího pracovního prostoru (`oblasti`) · brána, která
  změněný modul přímo importuje · **třídní brány** (kategorie `trida-repo` s `vzdy`:
  zákon nad celou třídou souborů repa — každá nová cesta je potenciální nález,
  proto jdou do každého výběru).
- **Které testy** — `scripts/ci/prepush-cilene.mjs`: sady pracovních prostorů týmž
  predikátem jako celá `test:services` (`run-service-tests.mjs --jen`), unit a script
  testy přímým importem (aliasy z `tsconfig` `paths`); nad strop
  `AISHA_PREPUSH_STROP_TESTU` (deklarováno 60 souborů) se vesmír místně nespouští.

**Fail-closed jinak:** neznámá cesta (mapa ji nezná), rozpor směrování, pád výběru
nebo chybějící báze vedou na **širší** cílenou dráhu — nikdy na „nic" a nikdy na
tichý přeskok. Hák vypíše, co místně přeskočil, i s úlohou CI, která to změří
(a řekne, když ji CI pro danou změnu nespouští, např. `Web: Tests` při `app=false`).

Brány: `prepush-vyber-je-cileny` (chování výběru nad dočasným gitem, mutanti
„merge = vše" a „neznámá = nic", hák nad podstrčeným node/npm), `smerovani-jeden-domov`,
`vyber-bran-je-fail-closed`, `ci-zelene-stromy`. Podrobnosti výběru bran:
[docs/testing/BRANY_DRAHY_A_VYBER.md](../testing/BRANY_DRAHY_A_VYBER.md).

## Infrastruktura

| Komponenta | Služba | URL |
|------------|--------|-----|
| **Git server** | Forgejo | `git.id3a.cz` |
| **CI/CD Runner** | Forgejo Actions (DinD) | Součást Forgejo stacku |
| **NPM proxy** | Verdaccio | `npm.id3a.cz` |
| **Deployment** | Coolify | Traefik reverse proxy |
| **Web app** | nginx SPA | `web.aisha.guru` |
| **API** | Kong/Supabase | `api.aisha.guru` |

### Forgejo Runner

Runner je **součástí Forgejo stacku** (`coolify/apps/forgejo/docker-compose.yml`):
- Image: `code.forgejo.org/forgejo/runner:6.2.2`
- Izolace: DinD (Docker-in-Docker) — nepřipojuje se na host Docker socket
- Labels: `ubuntu-latest:docker://node:20-bookworm`, `self-hosted:host`
- **Runner NENÍ v tomto repozitáři** — žije v `coolify/apps/forgejo/`

### Proč DinD?

Runner nemůže přímo deployovat na host Docker daemon. Proto:
1. CI testuje kód (uvnitř DinD kontejneru)
2. CI triggeruje Coolify webhook po úspěšných testech
3. **Coolify** builduje a deployuje z `docker-compose.coolify-prebuilt.yml`

## Deploy strategie

### Web deploy (Coolify webhook)

```
push to main → Forgejo CI → testy projdou → curl webhook → Coolify builds + deploys
```

Coolify používá `docker-compose.coolify-prebuilt.yml` (~2KB):
- `migrate` service — spustí DB migrace (Dockerfile.migrate)
- `web` service — builduje frontend (Dockerfile.web), startuje po úspěšné migraci

**Proč prebuilt compose?** Hlavní `docker-compose.coolify.yml` (35KB, 18 služeb) způsoboval
`proc_open(): posix_spawn() failed: Argument list too long` — Coolify base64-encoduje
celý compose do SSH argumentu, 47KB přesahuje OS ARG_MAX limit.

### Supabase stack

Supabase backend (`docker-compose.coolify.yml`) je deploynutý **separátně** a mění se zřídka.
Web deploys jdou přes lehký prebuilt compose, ne přes 35KB all-in-one soubor.

### Stacky po vlnách a pravidlo slučování (od 2026-10-01)

Stacky (vlny 3+) nasazuje řetěz úloh, ne jedna úloha:

```
deploy-razitko → Kořen → Core → Edge, Extranet → deploy-zacatek → vlny 3–6 → vlna 7 → [pokračování vlny 7] → vlny 8+ → deploy-verdikt
```

- **Frontend nikdy před backendem (od 2026-10-03).** Edge a Extranet čekají na Core
  (úspěch, přeskočení, nebo úspěšné pokračování). Dřív běžely po Kořeni vedle sebe:
  nový web proti starému jádru = rozbité volání, dokud Core nedoběhne.

- **Proč.** Strop jobu na runneru je tvrdý (výchozí 1 h) a přebíjí `timeout-minutes`.
  Jediná úloha „vlny 3+“ (timeout 240) ho trefila 2026-09-30 uprostřed vlny 8:
  Coolify nasazení doběhla, ale nikdo je neověřil. Vlna 7 se 6–9 appkami trvá
  35–49 min (naměřeno na 10 nasazeních).
- **Měkký termín.** Každá vlnová úloha zná svůj strop (`STROP_ULOHY_MIN` =
  `timeout-minutes`) a 8 min před ním přestane čekat i spouštět a řekne, co
  zůstalo. Vlna 7 rozpracované appky **předá** (`predano=true`) — nasazení
  v Coolify běží dál.
- **Pokračování (jen jedno).** Naváže na nasazení TÉHOŽ běhu (razítko
  z `deploy-razitko`, které `deploy-zacatek` převezme): běžící dočká, hotové
  ověří, spadlé nebo chybějící nasadí.
  Ověřuje se stejným standardem jako dřív (`deploy-and-verify.sh`). Nasazení
  s JINOU revizí po začátku běhu = pád „během nasazení bylo sloučeno“.
- **Výsledek čte jen `deploy-verdikt`.** Vlna s předáním končí zeleně, i když
  ještě není ověřená. `deploy-verdikt` je success jen tehdy, když každá vlna má
  ověření z tohoto běhu; po dobu nasazení drží na HEAD mainu kontext
  `deploy-verdikt` = `pending`.

⛔ **Pravidlo slučování:** do `main` slučuj až tehdy, když je `deploy-verdikt`
předchozího commitu mainu **terminální** (ne jednotlivé deploy úlohy). Coolify
staví HEAD mainu — sloučení během nasazení ho rozbije („nasazená revize
NESEDÍ“, #1000, #1013).

Hlídá brána `nasazeni-stacku-po-vlnach`.

#### Deklarované držení aplikací (od 2026-10-02)

Aplikaci, kterou instance vědomě NEnasazuje (rozhodnutí majitele, např. web-render
a local-ingest od 2026-09-28: Coolify převádí holý `${VAR}` bind na prázdný svazek),
deklaruje overlay instance v `nasazeni-drzene.json`:

```json
[{ "aplikace": "web-render",
   "duvod": "Coolify převádí holý ${VAR} bind na prázdný svazek",
   "rozhodnuti": { "kdo": "majitel", "datum": "2026-09-28", "odkaz": "…" } }]
```

- `deploy-razitko` — PRVNÍ krok nasazení — deklaraci přečte
  (`scripts/ci/drzene-z-overlaye.sh`) a ověří (`scripts/lib/nasazeni-drzene.mjs`);
  neplatná deklarace ho shodí dřív, než se cokoli nasadí (do 2026-10-03 ji četl až
  `deploy-zacatek`, tedy po Kořeni, Core, Edge a Extranetu — nečitelný overlay by
  nechal instanci napůl nasazenou). Vlnové úlohy ji dostanou outputem přes
  `deploy-zacatek` (`nasad-podle-vln.sh --drzene`), verdikt přímo z razítka.
- **Odkud CI overlay zná:** secret repa `INSTANCE_OVERLAY_REPO` (host/vlastník/repo).
  Nezadává se ručně — je ODVOZENÝ z deklarace overlaye instance
  (`AISHA_INSTANCE_DATA_GIT_URL`) a doplní ho založení instance
  (`coolify-story-init.sh` → `ci-kontrakt.mjs --dopln`). Instance, která overlay
  deklaruje a v CI ho nemá, by nasadila i držené aplikace („instance nemá overlay —
  nic drženo“); cold-start doktor to proto hlásí jako FAIL, ne varování.
  Tentýž secret zapíná lane „Instance: brány nad overlayem“ v režimu vynucení.
- Držená aplikace se NEnasadí: souhrn a anotace vypíší „DRŽENO: … (rozhodnutí …;
  drženo od <datum>, N dní)“ a další vlny pokračují. `deploy-verdikt` je zelený
  S VÝPISEM držených aplikací.
- Zmizí-li položka, aplikace se nasadí normálně. Nedeklarovaná chybějící proměnná
  zůstává fail-closed (pád vlny jako dřív).
- ⛔ Overlay deklarovaný, ale NEČITELNÝ = pád `deploy-razitko`: nevíme, co je
  drženo, tedy co smíme nasadit („nic drženo“ by na instanci s doručenými
  proměnnými aplikaci nasadilo a odpojilo data). Instance bez overlaye = nic drženo.
- ⛔ Neplatná deklarace = pád: chybí důvod, kdo, datum (YYYY-MM-DD, ne budoucí)
  nebo odkaz; neznámá aplikace nebo klíč; aplikace vln 0–2 (Kořen) nebo aplikace
  s přímou úlohou (Core/Edge/Extranet) — plnič držení mají jen vlnové úlohy 3+,
  tu by deklarace nezastavila. Datum rozhodnutí smí být o den napřed před UTC
  (zápis po místní půlnoci na východ od UTC).
- `deploy-verdikt` navíc vyjmenuje a spočítá aplikace, které v Coolify instance
  NEJSOU (volitelné — nebo špatný prefix): „ověřeno“ je nesmí schovat.
- Datum platnosti držení záměrně není (bez pokynu majitele); stáří se vypisuje.

Hlídají brány `nasazeni-drzene-aplikace` (čtení, řetěz, deklarace instance
v lane overlay-gates) a `ci-nasazuje-podle-vln` (chování vlnového skriptu).

##### Držení platí na každé cestě, ne jen v CI (od 2026-10-04)

Do 2026-10-04 deklaraci četlo jen nasazení z CI. Studený start
(`aisha-cold-start.sh --skip-create`) ani ruční dispatch (`deploy.yml`) o ní
nevěděly a drženou aplikaci by přenasadily. Teď platí:

- **Jeden domov mutace.** Každé volání, které aplikaci v Coolify nasadí,
  restartuje, spustí nebo zastaví, odesílá `scripts/lib/coolify-mutace.mjs`
  (v shellu obal `scripts/lib/coolify-mutace.sh` → `coolify_mutace`). Před voláním
  se zeptá domova držení; držená aplikace = žádné volání, hláška
  „DRŽENO: <aplikace> — <důvod>“ a kód **100** (nejde zaměnit s úspěchem ani
  s chybou sítě). Platí i pro restart, start, stop a adresu webhooku nasazení.
- **Držená aplikace je zmrazená celá.** Studený start ji nezakládá a nesrovnává
  (`coolify-story-init.sh`), nenastavuje jí env, domény ani build server
  (`coolify-deploy-init.sh`, `coolify-sync-envs.sh`, `coolify-domain-doctor.mjs`,
  `aisha-bootstrap-user-init.sh`), nenasazuje ji ani nerestartuje
  (`aisha-redeploy.mjs`) a `--wipe` ji nesmaže; `--rewarmup` držené aplikace je
  rozpor voleb = STOP. Každé přeskočení se vypíše a souhrn běhu držené aplikace
  jmenuje.
- **Žádný přepínač držení nepřebije.** Výslovné cílení (`aisha-redeploy.mjs
  --only=<držená>`, `--canary=<držená>`, vstup ručního dispatche,
  `REDEPLOY=1 coolify-sync-envs.sh <držená>`) se odmítne — kód 100, v dispatchi
  červená. Držení se ruší smazáním položky v overlayi.
- **„Nevím, co je drženo“ = STOP** před prvním zásahem (studený start končí před
  doktorem; doktor to ve fázi E hlásí jako FAIL). Patří sem nečitelná nebo
  neplatná deklarace, deklarovaný a nedostupný overlay, deklarace overlaye
  (`AISHA_INSTANCE_DATA_GIT_URL`), kterou nejde přečíst jako adresu, ruční
  přebití (`AISHA_INSTANCE_CONFIG_DIR`) na adresář, který neexistuje, a vynucený
  overlay (`AISHA_OVERLAY_REQUIRED=1`), který chybí. Jen instance, která overlay
  vůbec nemá, nebo overlay bez souboru = nic drženo — a řekne se to.
- `--drzene` (seznam držení místo vlastního čtení deklarace) smí domovu mutace
  předat jen ruční dispatch (`deploy.yml`), kterému seznam dodá jeho vlastní krok
  čtení deklarace (`scripts/ci/drzene-z-overlaye.sh`); brána
  `nasazeni-drzene-aplikace` jiného volajícího nepustí. Výjimka z „jednoho domova“
  kryje dnešní počet volání v souboru, ne soubor — nové volání ve vyňatém souboru
  bránu shodí taky.
- `REDEPLOY=1 coolify-sync-envs.sh`: nasazení, které domov neodeslal nebo Coolify
  odmítlo, se vypíše s příčinou a běh skončí nenulou (dřív „?“ a kód 0).
- Mimo CI si overlay nástroj obstará sám (`drzeniInstance` → dveře overlaye);
  shell čte přes `scripts/lib/drzeni.sh`.
- Pravidlo „jen vlny 3+ bez přímé úlohy“ platí i pro studený start: deklarace je
  jedna a musí ji umět naplnit každá cesta.

**Otevřené (navazující práce, ne souhlas):** „zmrazená celá“ se dnes měří po
nástrojích, ne jako třída — zápis env nebo definice aplikace MIMO stráž žádná brána
nehledá. Známé zápisy bez čtení držení: `provision-surfaces.sh` (POST/PATCH
povrchů z `AISHA_SURFACES`) a `coolify-mesh-sync.mjs` (jen `edge`). Ani jeden cíl
validace držet nedovolí: extranet a edge mají přímou úlohu CI, ostatní povrchy
vlny neznají. Až bude držitelná aplikace mít
takový zápis, patří sem brána třídy „zápis do Coolify mimo stráž“.

##### Vlastnictví aplikací z topologie: co je v prostředí NAŠE (od 2026-10-04)

Manifest instance (`<overlay>/manifests/<instance>.manifest`) je **inventář** — jeden
pro všechna prostředí instance. Co je v daném prostředí **naše**, říká efektivní
profil prostředí: služba s `service_overrides.<id>.external_domain` běží jinde
(např. sdílený Keycloak jiné instance) a je dosažitelná na té adrese. Dřív o tom
rozhodoval `grep '^app: *keycloak:'` nad manifestem — staging, který Keycloak
konzumuje, zatímco produkce téže instance ho vlastní, by ho „vlastnil“ (založil
aplikaci na cizí doméně a importoval realm do cizího Keycloaku).

- **Jeden domov odpovědi:** `scripts/lib/vlastnictvi-aplikaci.mjs` (CLI + shell
  `scripts/lib/vlastnictvi.sh`: `vlastni`, `externi`, `vlastni_aplikace`). Jediný parser
  řádků `app:`; profil se čte dveřmi topologie (`loadProfileRaw`, overlay pak šablona)
  — prostředí tedy může externí adresu deklarovat samo (`external_domain: "${…}"` ve
  sdíleném profilu, hodnota v souboru domén prostředí).
- **`${VAR}` v `external_domain` musí prostředí DEKLAROVAT:** adresa = externí,
  výslovně prázdná hodnota (`VAR=`) = vlastní, **nenastavená = „nevím“ = STOP** (dřív
  se z ní stal prázdný řetězec a četla se jako „vlastní“ — samostatný nástroj bez
  souboru domén by staging s cizím Keycloakem „vlastnil“). Zdroj: prostředí procesu,
  jinak poslední přiřazení v souboru prostředí (`--env-soubor`; redeploy čte
  `.env.coolify` a zálohu obsluhy; domov mutace bere `--env-soubor` volajícího —
  sync-envs, povrchy), jinak výchozí hodnota `${VAR:-…}`. Prostředí, které
  službu vlastní (produkce), proto nese v souboru domén řádek `VAR=`. Studený start
  čte vlastnictví až po rozkladu souboru domén prostředí.
- **`--rewarmup` na externí službu = STOP** (i kdyby v projektu zbyla stará aplikace
  jejího jména — rewarmup ji podle jména najde a maže se svazky).
- **Externí služba se v prostředí nezakládá (story-init), nenasazuje (redeploy, sync
  `REDEPLOY=1`), nesrovnává (env, domény — sync-envs, deploy-init, doktor domén),
  nemaže (úklid sirotků i `--wipe`) a nikdy se do ní neimportuje realm** (cold-start:
  `KC_OWNED` z domova; `provision-surfaces.sh` nezakládá klienty povrchů v cizím realmu).
  Každé vynechání se vypíše: „EXTERNÍ: <role> — <adresa> — … nevlastním“.
- **Domov mutace má dva jmenované kódy:** držená (naše, zmrazená) = 100, externí
  (v prostředí není naše) = 101. Výslovné cílení externí služby (`--only`, `--canary`,
  `REDEPLOY=1 … <jméno>`) se odmítne kódem 101.
- **„Nevím, co je naše“ = STOP:** nedeklarovaný profil (`AISHA_PROFILE`; samostatný
  nástroj ho přečte i ze souboru prostředí instance), profil, který nejde najít,
  chybějící manifest nebo vadný řádek `app:`. Profil `legacy` (bez topologie) =
  vlastní celý manifest — a řekne se to.
- Brána `vlastnictvi-z-topologie`: čtení `app:` mimo domov v `scripts/` a `.forgejo/`
  = pád se souborem a řádkem; výjimky (kontroly a generátory, ne rozhodnutí o
  nasazení) jmenovitě s důvodem a se stropem.

**Otevřené:** (1) ruční dispatch v CI (`deploy.yml`) profil prostředí nezná — domov
mutace externí službu nerozliší a řekne to varováním (mutuje jen aplikace, které
v projektu existují; externí story-init nezakládá); stav připíná test
`coolify-mutace.test.mjs` („bez profilu prostředí“). Předávat profil
z `vars.AISHA_PROFILE` (bez výchozí hodnoty) = vědomá změna toho testu.
(2) `coolify-sync-envs.sh` se `SEND_ALL=1` vlastnictví NENAČTE (posílá vše, co dostane)
— externí službu tím nerozliší; volající, který SEND_ALL používá, ji musí vynechat sám.
(3) Fáze G studeného startu (DB grant operátorů) s externím Keycloakem
neběží a hlásí se jako nedokončená (operátory v realmu spravuje vlastník). (4) Mesh
(NetBird) s externím Keycloakem: bootstrap potřebuje pověření, která vznikají jen na
cestě vlastního Keycloaku — neřešeno.
(5) Proměnné z `external_domain` musí znát i nástroje spouštěné samostatně: když je
nemají v prostředí ani v souboru prostředí, skončí „nevím“ (kód 2) — bezpečné, ale
obsluha je musí doplnit (soubor domén prostředí do `.env.coolify`, nebo export).

Co převedeno NENÍ (operátorské nástroje mimo konvergenci, běhové služby, zrcadlo
dispatche pro GitHub), je vyjmenováno s důvodem v bráně `nasazeni-drzene-aplikace`
— hledá volání mutace mimo domov a seznam výjimek se smí jen zmenšovat. Chování
cest mimo CI proti falešnému Coolify měří brána `drzeni-plati-mimo-ci`.

### Dráhy runneru, stropy a opakování (od 2026-10-01)

Linuxový runner je sdílený a jeho fronta je FIFO přes všechna repa; job se po
doběhnutí `needs` řadí na konec. Naměřeno 2026-09-29: PR s 59 min práce běžel
121 min, `detect` (0,7 min) čekal na slot až 25 min.

- **Lehká dráha.** Krátké joby (detect, verdikty, skeny) a nasazovací joby (jen
  pollují Coolify) mají `runs-on: ${{ vars.CI_LIGHT_LABEL || 'ubuntu-latest' }}`.
  Zapíná ji proměnná repa `CI_LIGHT_LABEL`; bez ní běží tytéž joby na výchozím
  štítku. Proměnnou nenastavuje člověk — ROZHODUJE MĚŘENÍ: doktor CI kontraktu
  změří, jestli žije runner se štítkem lehké dráhy (`lehka.stitek`
  v `.forgejo/ci-drahy.json`), a `ci-kontrakt.mjs --dopln` ji podle toho doplní.
  Runner bez proměnné i proměnná bez živého runneru jsou nález. Těžké joby (docker,
  throwaway DB, plné sady testů, build) na lehkou dráhu nesmí.
- **Žádný řetěz těžkých jobů.** Těžké joby čekají jen na `detect`; nasazení
  dál čeká na testy, brány i build.
- **DB kontrakt v jedné DB.** Workflow nese JMÉNA sad (`test:db:*`), soubory čte
  `scripts/ci/db-kontrakt-jmenovite.mjs` z `package.json` — seznam se neopisuje.
- **Strop runneru je tvrdý** a přebíjí `timeout-minutes`. Stropy drah deklaruje
  platforma v `.forgejo/ci-drahy.json` (výchozí 180 = výchozí forgejo-runneru,
  lehká 240); instance deklaruje SKUTEČNÉ stropy v overlayi (`ci-drahy.json`
  téhož tvaru). Job, který může vyjít na obě dráhy, se musí vejít pod OBA stropy.
  Job, který instance nespouští, overlay vede v `nespousti_se` a úloha nese
  `if: vars.<PROMENNA> == 'on'` (Android: `ANDROID_BUILD`).
- **Nasazení = jeden pokus v úloze a skript skončí dřív než runner.**
  `deploy-and-verify.sh` uvnitř úlohy neopakuje (`OPAKOVANI=0`): druhý pokus se
  pod strop 1 h sdíleného runneru nevešel nikdy. Úloha pojme fronta Coolify
  (`--fronta-s 1500`) + práce (`TIMEOUT_S` 1800) + `REZERVA_S` 300 = 60 min.
  Rezerva = naměřená režie mimo čekání (max 45 s z 66 úloh jedné instance forku) + ohraničené
  kroky po čekání (dočkání `DOBEH_S` 60 s, sonda zdraví, `--verify-url`). Úlohy
  po vlnách (Kořen, Stacky) mají měkký termín 8 min před stropem.
- **Opakování = pokračovací úloha (od 2026-10-02).** Razítko běhu bere jediná
  úloha `deploy-razitko` (po testech, před Kořenem) a otevře kontext
  `deploy-verdikt` = `pending`. Kořen, Core, Edge i Extranet mají každá právě
  jedno `<úloha>-pokracovani`: spustí se jen po `failure`/`cancelled` své úlohy
  a naváže `--navazat-od <razítko>` — běžící dočká, hotové ověří, spadlé
  nasadí PRÁVĚ JEDNOU znovu (tím se vrací opakování přechodného pádu), cizí
  revize = pád. Třídu pádu (`nasazeni-prechodna-chyba.mjs`) skript jen vypíše;
  spadne-li i opakování, souhrn řekne „pád i po opakování, třída: …“.
  Navazující úlohy přijmou úlohu NEBO její pokračování a `deploy-verdikt` čte
  CELÉ nasazení (přímé úlohy, pokračování i vlny stacků). Hlídá brána
  `nasazeni-pokracovani-uloh`.

⛔ **Job visí ve „waiting“?** Ověř, že běží runner se štítkem z `CI_LIGHT_LABEL`
— doktor to měří (`node scripts/lib/ci-kontrakt.mjs --repo <v/r>`, token správce
instance; řádek „dráha runneru lehka“). Proměnná bez živého runneru = blokující
nález; oprava je spustit runner, nebo proměnnou smazat. Workflow to samo
nezjistí (`github.token` na výpis runnerů dostane 403).

- **Izolovaný runner (od 2026-10-03, NEAKTIVNÍ).** Na GPU uzlu
  běží CI ve vlastní VM (libvirt), joby jako sourozenecké kontejnery bez socketu
  a bez privileged, bez cesty do meshe a LAN, bez GPU a vah. Čisté joby (bez
  `secrets.*`, dockeru, `services`, `container`, throwaway DB: check-web,
  build-web, surface-tests, test-n8n, test-extension, test-mobile, test-cosmos,
  workbench-rail) mají kanonický `runs-on`: pull_request z TOHOTO repa →
  `vars.CI_IZOLOVANY_PR_LABEL`, push do main → `vars.CI_IZOLOVANY_PUSH_LABEL`, jinak
  (a bez proměnné) výchozí štítek. PR z forku NIKDY. Aktivace = nastavit obě
  proměnné repa až po měřeních (declare štítků, práva tokenu jobu, síť z jobu,
  bez GPU/vah) a po revizi; doktor (`ci-kontrakt.mjs`) pak hlídá živý runner pro
  každou dráhu s proměnnou. Hlídá brána `izolovany-runner-nese-jen-ciste-joby`.
  - **Rozsah runnerů:** oba (PR i push) jsou registrované na úrovni organizace
    `aisha`, tedy sdílené všemi jejími repy. Doktor proto runner počítá jen
    z výpisu repa a organizace a z výpisu instance jen runnery instance
    (`owner_id` 0, `repo_id` 0) — runner cizí organizace se stejným štítkem
    joby tohohle repa nikdy nevezme.
  - **Cache:** sdílí se JEN npm cache svazkem (`NPM_CONFIG_CACHE=/ci-cache/npm`
    na runneru push). Je adresovaná obsahem a `npm ci` ověřuje integritu proti
    lockfile; služba vedle runneru dělá à 6 h `npm cache verify`, nad 30 GB
    `npm cache clean`. pip, Playwright, ESLint (`CI_CACHE_DIR` se nenastavuje —
    lint jde do `node_modules/.cache` jobu) ani Go build cache se mezi repy
    nesdílí: jejich záznamy se neověřují a otrávený záznam je cizí kód nebo
    obejitá brána. Cache server mají oba runnery vypnutý (`cache.enabled: false`);
    brána navíc odmítne na izolovaném runneru `actions/cache` i `actions/setup-*` s cache
    (setup-go cachuje i bez `cache:`, proto výslovné `false`).

Hlídají brány `lehka-draha-nese-jen-lehke-joby` (platforma + overlay v lane
overlay-gates), `opakovani-nasazeni-se-vejde-do-ulohy` a `ci-kontrakt`.

### DB Migrace

Migrace běží jako `migrate` service v `docker-compose.coolify-prebuilt.yml`:
- Používá `Dockerfile.migrate` (Node 22 + postgresql-client)
- Připojeno na `aisha-network` → přístup k `aisha-db:5432`
- `restart: "no"` — spustí se jednou a ukončí se
- Web service startuje až po `service_completed_successfully`

## Pipeline Stages

### 1. 🔍 Detect Changes
- Porovná HEAD~1 vs HEAD
- Nastaví output flagy: `code`, `migrations`, `docs_only`, `functions`
- Docs-only změny přeskočí celý pipeline

### 2. 🧪 Check
- TypeScript: `npx tsc --noEmit`
- ESLint: `npm run lint`
- i18n: `npm run i18n:check`

### 3. 🧪 Test
- Unit testy: `npm run test:run` (při `app=true`)
- Gate testy: `npm run test:gates` — celá sada při každé změně (job Web: Brány nemá
  podmínku na `app`; pre-push pouští jen dotčené, viz „Plné sady jen v CI" výš)

### 4. 🏗️ Build
- Production build: `npm run build`
- Ověření, že build projde (Coolify pak builduje znovu z Dockerfile.web)

### 5. 🚀 Deploy
- `curl -X POST "$COOLIFY_WEBHOOK_URL"` s ref + sha
- Coolify obdrží webhook → pulls kód → builds compose → deploys

## Setup (Forgejo Secrets + Coolify env vars)

**Automatický setup (doporučeno):**
```bash
npm run deploy:init        # interaktivně
npm run deploy:init:dry    # dry run
```

Viz [COOLIFY_SETUP.md](COOLIFY_SETUP.md) pro detaily.

### Forgejo Secrets

Nastavit v Forgejo UI: **Settings → Secrets** (nebo automaticky přes `deploy:init`)

| Secret | Popis | Required |
|--------|-------|----------|
| `COOLIFY_WEBHOOK_URL` | Coolify deploy webhook URL | ✅ |
| `VERDACCIO_TOKEN` | NPM auth token pro npm.id3a.cz | ❌ (pro publish) |
| `N8N_API_KEY` | n8n API klíč (pro workflow triggery) | ❌ |

### Coolify env vars (v Coolify UI pro prebuilt compose, nebo přes `deploy:init`)

| Proměnná | Typ | Popis |
|----------|-----|-------|
| `VITE_AISHA_POSTGREST_URL` | Build | Supabase API URL |
| `VITE_AISHA_POSTGREST_ANON_KEY` | Build | Supabase anon key |
| `VITE_PUBLIC_SITE_URL` | Build | Veřejná URL pro auth redirecty |
| `PUBLIC_SITE_URL` | Build | URL pro sitemap/robots (SEO) |
| `VITE_SENTRY_DSN` | Build | Sentry error monitoring |
| `AISHA_DB_URL` | Runtime | DB connection string (pro migrate) |

## Soubory

| Soubor | Účel |
|--------|------|
| `.forgejo/workflows/ci.yml` | CI/CD pipeline (Forgejo Actions) |
| `.forgejo/workflows/test-community-nodes.yml` | n8n community nodes testy |
| `scripts/ci/ci-verdikt.mjs` | Verdikt CI ke commitu: kód, nebo runner (podpisy + fáze proti poslednímu zelenému) |
| `docker-compose.coolify-prebuilt.yml` | Coolify deploy compose (web + migrate) |
| `docker-compose.coolify.yml` | Supabase stack (separátní deploy) |
| `Dockerfile.web` | Standalone web build (3-stage: deps→builder→nginx) |
| `Dockerfile.migrate` | Standalone migrace (2-stage: deps→migrator) |
| `docker/nginx.conf` | Nginx SPA konfigurace |

## Manuální operace

### Trigger deploy

```bash
# Deploy se spouští automaticky při push na main.
# Manuální trigger: Forgejo UI → Actions → Run workflow

# Nebo přímý webhook:
curl -X POST "$COOLIFY_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"ref": "refs/heads/main"}'
```

### Check container status

```bash
docker ps --filter "name=platform-web"
docker logs platform-web --tail 100
```

### Rollback

```bash
# Coolify UI: vybrat předchozí deployment a kliknout "Redeploy"
# Nebo revert commit a push → CI spustí nový deploy
```

## Troubleshooting

### "Argument list too long"

Coolify builduje z `docker-compose.coolify.yml` (35KB) místo prebuilt compose.
**Řešení:** V Coolify UI změnit Docker Compose file na `docker-compose.coolify-prebuilt.yml`.

### Migrace selhávají

```bash
# Check migrate container logs
docker logs <migrate-container-name> --tail 100

# Verify DB connectivity
PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT 1"
```

### CI joby selhávají

0. **Nejdřív verdikt, ne čtení logu ručně:**
   `FORGEJO_URL=… FORGEJO_TOKEN=… npm run ci:verdikt -- <vlastník/repo> <sha>`
   (`scripts/ci/ci-verdikt.mjs`).
   - Najde běhy ke commitu přes `head_sha` a čte závěry JOBŮ. Kombinovaný status commitu je padělatelný tokenem jobu.
   - U padlého jobu stáhne log a porovná ho se známými podpisy, například uklízeč runneru pod `npm ci`, plný disk nebo přetečený strop.
   - Porovná časy fází s posledním zeleným během téhož jobu na předcích commitu.
   - Verdikt: `ZELENÁ` 0, `KÓD` 1, `RUNNER` 2 (zopakovat, neopravovat), `NEZMĚŘENO` 75.
   - Hlídá i zelený job s červenými testy (`continue-on-error`).
   - Na doběhnutí běhu čeká odpojeně: `--odpojit <soubor>`, konec pozná podle řádku `VERDIKT:`.
1. Zkontroluj Forgejo Actions log: `git.id3a.cz` → repo → Actions
2. Ověř, že runner běží: Forgejo admin → Runners
3. Ověř npm.id3a.cz dostupnost (Verdaccio)

### Webhook nefunguje

```bash
# Test webhook manuálně
curl -v -X POST "$COOLIFY_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"ref": "refs/heads/main"}'

# Check Coolify deployment logs v Coolify UI
```

