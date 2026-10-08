# docker-compose.coolify-local-ingest.yml — notes

Prose extracted from `docker-compose.coolify-local-ingest.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `start_period: 300s`

Entrypoint PŘED startem serveru seeduje bundle (git clone) a případně GGUF váhy
(MODEL_GGUF_URL, ~2 GB) — server do té doby neposlouchá. 20s grace by první
start s pomalejší linkou shodilo jako unhealthy; 300s pokryje download+load.
Deterministický režim startuje v sekundách — delší grace mu nevadí.

## `drop-init:`

Jednorázová příprava drop cesty: bind /srv/aisha/drop/local-ingest zakládá
Docker jako root:755 a uživatel `ingest` (uid 501) by do něj nezapsal —
engine i příjemce push transportu by padaly na Permission denied, zdravě
a tiše. Root kontext je tu JEN v kontejneru a JEN nad bindem; na hosta se
nesahá (žádný sudo). Idempotentní: chown na už správném adresáři nic nemění.

## `command: ["sh", "-c", "chmod 1777 /drop && echo 'drop-init: /drop je sdileny zapisovy bod, 1777 sticky'"]`

1777 (sticky) místo chown na konkrétní uid: drop je VÍCEGENERAČNÍ sdílený
adresář — psaly do něj uid 501 (stará generace) i 10001 (dnešní ingest)
a hádat „to pravé" uid znamená rozbít se při příští změně obrazu
(naměřeno 2026-08-01: chown 501 → ingest 10001 → Permission denied).
Sticky bit drží mazání u vlastníka, balíčky jsou immutable.
Hláška v JEDNODUCHÝCH uvozovkách: závorky jsou v sh metaznaky a neuvozený
`echo … (1777, sticky)` shodí CELÝ příkaz na syntaxi JEŠTĚ PŘED chmodem
(naměřeno 2026-08-02: exit 2, chmod nikdy neproběhl, a protože na tuhle
službu visí depends_on: service_completed_successfully, nenaběhl ani ingest).

## `- BUNDLE_GIT_SYNC=${INGEST_BUNDLE_GIT_SYNC:-1}`

Srovnat /bundle s gitem při KAŽDÉM startu, ne jen do prázdného volume.
Bez toho se konfigurace v gitu a ta běžící tiše rozejdou: naměřeno
2026-07-31 — oprava mapy faktur byla v mainu, ale ingest jel s bundlem
dva dny starým a položky dokladů dál zahazoval. Vypadalo to jako vada
ingestu, ne jako drift konfigurace, což je horší než hlasitá chyba.
Nic se nezahodí: předchozí stav se odkládá do /bundle/.pre-sync/<čas>/.

## `- "/srv/aisha/drop/local-ingest:/data/out/export"`

Export balíčky rovnou do PEVNÉ drop cesty, kterou source-broker bindne
:ro. Bind PŘES svazek ingest-out nefunguje: Coolify pojmenované svazky
přepisuje per-stack (naměřeno 2026-07-30 a 2026-08-01), takže broker
nikdy nevidí náš. Engine píše do $OUT/export — tenhle bind tomu podloží
sdílený adresář; příjemce push transportu (/api/export/receive) tím
pádem ukládá přímo tam, odkud broker čte.

## `expose:`

Export balíčky pro source-broker jdou do SPOLEČNÉ pevné cesty, kterou
broker bindne jen pro čtení. Přes svazek to nešlo: Coolify definice
volumes přepisuje (2026-07-30), takže si každý stack založil vlastní.

## `ingest-out:`

Svazek drop lane. Jméno je INSTANČNÍ, takže v generickém compose stát nesmí —
`aisha_local-ingest-out` tu bylo natvrdo jméno CIZÍ instance. Coolify přitom
${...} ve ZDROJI mountu odmítá (viz coolify-compose-compliance), ale v `name:`
pojmenovaného svazku ho přijme — proto se parametrizuje tady, ne u mountu.

## `name: ${LOCAL_INGEST_OUT_VOLUME:?doručuje cold-start (env-doctor CONTRACT z APP_NAME_PREFIX = identita instance) — bez něj se drop lane nesmí tiše rozejít s druhou stranou}`

ZŮSTÁVÁ POVINNÉ (`:?`) — jméno se NEDOSAZUJE tady. Hodnotu DORUČUJE
cold-start: env-doctor ji odvodí ze SERVICE_ALIAS_PREFIX (viz CONTRACT),
takže platí „vše přes cold-start", ne vestavěný literál v compose.

Původní hláška slibovala doručení z coolify-deploy-init podle uuid apky —
jenže ten to od přechodu drop lane na PEVNOU cestu záměrně nedělá
(„doručoval jméno svazku — zbytečné, protože Coolify definice volumes
stejně přepisuje"). Kontrakt si tak protiřečil: povinná proměnná, kterou
nikdo nedodá. Projevilo se to až při ZAPNUTÍ local-ingestu (2026-08-08) —
dokud byla schopnost vypnutá, vada byla neviditelná.

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

## `money-sync` — pravidelná aktualizace dokladů z ERP

Přeneseno 2026-09-06 z větve `fix/coolify-tvar-odpovedi`, kde ta lane ležela
necommitnutá do upstreamu. Próza sem, ne do compose: soubor se posílá na server
JAKO ARGUMENT PŘÍKAZU a soutěží s `ARG_MAX` — jeho vlastní hlavička říká, že má
nést KONFIGURACI ONLY, a brána `compose-nese-konfiguraci-ne-prozu` to vymáhá
rohatkou.

```
PRAVIDELNÁ AKTUALIZACE DOKLADŮ Z ERP (Money přes svc-money) → vstup ingestu.

Sesterská lane k `docs-sync`, ale opačná povaha zdroje: dokumenty na Nextcloudu
UŽ EXISTUJÍ jako soubory a jen se připojí; doklad z API nikde neleží — vzniká
dotazem, takže se musí zapsat. Proto `:rw` na vstupní svazek (ingest ho má `:ro`).

⭐ INKREMENTÁLNĚ přes `ChangeFrom`, které Money v dotazu podporuje: stahují se
jen doklady změněné od posledního běhu. Kurzor per agenda leží ve svazku vedle
dat, takže přežije přestavbu kontejneru — na rozdíl od `/tmp`, kde jsem
2026-08-30 o 3 831 stažených dokladů přišel při redeploy.

⭐ SYROVÝ ZÁZNAM + `_marker` deklarované mapy. Žádný překlad: mapy v instančním
bundlu adresují vendor jména, a lopata, která překládá, obírá engine o vstup.

Prázdné `MONEY_SYNC_ZDROJE` = lane VYPNUTÁ (ne chyba) — instalace bez ERP tím
nespadne. Tvar: JSON pole [{agenda, entita, marker}].
```

### `init: true` u `local-ingest` (2026-09-08)

Próza přesunutá z compose — v souboru zůstal ukazatel.

⛔ NAMĚŘENO. Kontejner měl **16 restartů** a v procesech se hromadily zombie
`curl`: 13 při prvním měření, 15 po 45 sekundách. Přírůstek 2 za 45 s přesně
sedí na healthcheck s `interval: 30s`.

Příčina: PID 1 je holý `python -m src.webapp.server`, který potomky NESKLÍZÍ.
Po každé kontrole tedy zůstane zombie — zhruba 120 za hodinu.

Následek nebyl jen kosmetický. Restart zabil rozdělaný běh: `.run.lock` byl
z 10:11, ale artefakty ze VČEREJŠKA (10:26). Zpracování se tak nikdy nedostalo
do konce, přestože hlídač kontroluje vstup po 60 s a při změně přepočítává.
Vypadalo to jako „ingest nestíhá", ve skutečnosti nedoběhl.

⛔ NEBYLA TO PAMĚŤ. `OOMKilled: false`, exit předchozího běhu 0. Kontejner sedí
na ~1,5 GiB z 2 GiB, takže limit nebyl to, co ho zabíjelo. Zvednutí na 4 GiB je
rezerva (na stroji je 14 GB volných), ne oprava.

⛔ CPU SE NEZVEDALO ZÁMĚRNĚ. Load stroje byl 36 na osmi jádrech — procesor je
tam vzácnější než paměť. `INGEST_WORKERS=4` při `cpus: 2.0` je nicméně
předimenzované; to je knoflík v prostředí, ne v compose.

⭐ NENÍ TO OBECNÉ PRAVIDLO, a proto k tomu NENÍ brána. Změřeno: z 69 služeb
s `curl`/`wget` healthcheckem má `init: true` JEDNA. Ostatní mají PID 1, který
potomky sklízí sám (nginx, node). Vada je v tomhle obrazu, ne v idiomu
healthchecku — plošná brána by červenala nad 68 službami, které problém nemají.

## `input-init:`

⛔ NAMĚŘENO 2026-08-29 pokusem na hostiteli: bind mount DO `:ro` svazku
NENASTARTUJE, pokud v něm přípojný bod neexistuje —
  error mounting … create mountpoint … read-only file system
Kontejner by nespadl za běhu, on by vůbec nevznikl. Proto se `dokumenty/`
vyrobí PŘEDEM z kontejneru, který týž svazek drží zapisovatelně; ingest ho
pak dostane `:ro` a jeho vstup zůstává faktem, který sám nepřepíše.

## `docs-sync:`

SYNCHRONIZACE DOKUMENTOVÝCH ZDROJŮ (WebDAV → hostitelský adresář, odkud si je
ingest bere `:ro`). Prázdné `NEXTCLOUD_URL` = lane VYPNUTÁ (kontejner doběhne
a skončí) — instalace bez Nextcloudu tím nasazení neshodí.

⭐ NAMĚŘENO 2026-08-29 na živé instanci: `PROPFIND Depth: infinity` vrátí CELÝ
strom jedním dotazem — 592 souborů / 341 kB / 2,38 s. Procházení po složkách
stálo ~0,9 s × 165 složek ≈ 150 s, tedy 60×. Při 2,4 s na strom je pětiminutový
interval zátěž 0,8 % času, takže se nic nemusí ředit.

⭐ `copy`, NE `sync`: copy umí jen PŘIDAT. Smazání dokumentu na Nextcloudu je
rozhodnutí, které nemá tiše vyprázdnit vstup ingestu — a KB položka z něj
stejně nezmizí. Mazání ať je vědomý úkon, ne vedlejší účinek zrcadlení.

⭐ SMĚR JE DOVNITŘ, NE VEN. Smlouvy jsou `confidential` a instance zakazuje
posílat jejich obsah na EXTERNÍ API (`external_extractor.adapter: null`,
allowed_sensitivities: internal|public). Tenhle sidecar táhne z vlastního
úložiště RIQ do vlastního stacku — zákaz míří na odchozí tok, ne na příchozí.

⭐ `--checksum` ne, `--update` ano: hlídač enginu porovnává (velikost, mtime),
takže stažený soubor MUSÍ nést čas zdroje — jinak by se změna neprojevila.

⛔ OD 2026-10-03 PÍŠE JEN DO KARANTÉNY (`/karantena`), ne do vstupu enginu. Do té doby
stahoval rovnou do svazku, který engine čte — bez antiviru (skenovaly se jen nahrávky
přes storage-auth). Vstup plní až `docs-scan` po čistém skenu, viz níž.
`--compare-dest /docs` = co ve vstupu už leží beze změny (velikost + čas), se znovu
nestahuje; do karantény jde jen nové a změněné. `--no-update-dir-modtime` k tomu patří:
bez něj rclone (≥ 1.66) nastavuje čas i adresářům, které v karanténě nevznikly, protože
z nich nic stahovat nebylo — a končí chybou „chtimes … no such file or directory"
(změřeno 2026-10-03 na pinu 1.68; s přepínačem rc=0 a druhý běh nepřenese nic).
Vstup má tenhle sidecar jen ke čtení (`:ro`) — zapsat do něj smí jediný proces, a to ten,
který skenuje.

## `docs-scan:`

ANTIVIROVÁ BRÁNA DOKUMENTŮ (2026-10-03). `docs-sync → /karantena → clamd → /docs → engine`.
Soubor ze synchronizace se pošle clamd (INSTREAM) a do vstupu enginu se přesune až po
verdiktu „clean" — dočasné jméno s tečkou + rename, engine tečkové soubory nečte, takže
rozepsaný soubor nikdy nevidí; čas souboru se zachovává (dohoda se synchronizací i s
hlídačem enginu). Nález zůstane v karanténě a pamatuje se (`/stav/stav.json`); zadržený soubor
se zkouší znovu S ODSTUPEM (nález a „nad limit" za den, ostatní 15 min → dvojnásobek → den).
Co ve vstupu leželo z doby před branou, se doskenuje na místě a nález se ze vstupu stáhne —
do té doby je engine čte dál (vyprázdnit vstup by četl jako „dokumenty zmizely"); kolik jich
na posouzení čeká, brána hlásí v logu.

⭐ STAV A TEP VE VLASTNÍM SVAZKU (`ingest-scan-state:/stav`), který má připojený JEN brána.
Dřív ležely v karanténě, kam píše synchronizace: soubor `.docs-scan/tep` z úložiště by
zfalšoval zdraví a `stav.json` přehled ověřených (nález nezávislého čtení 2026-10-03).
Skript: `infra/docs-scan/docs-scan.ts` (tam je celé zdůvodnění), obraz `Dockerfile.docs-scan`,
testy `src/tests/security/docs-scan-karantena.test.ts`.

⭐ FAIL-CLOSED: nedostupný clamd = do vstupu nejde nic. Rozdíl proti tichému zastavení je
healthcheck níž. KDO JE VADNÝ — soubor, nebo platforma — brána rozlišuje: nález, „nad limit"
a nečitelný soubor jsou vada souboru (zadržet, fronta jede dál); clamd bez odpovědi, clamd,
který neposoudí ani kontrolní vzorek, a vstup, do kterého nejde zapsat, jsou stav platformy
(nic se nezadržuje, kolo končí překážkou).

⭐ SÍŤ = netns držitele `ingest-drop-push-netns` (`network_mode: service:…`), ne vlastní
sítě. NAMĚŘENO 2026-10-03 na instanci s ingestem a antivirem na RŮZNÝCH strojích: z toho
netns jméno `<prefix>-clamav` přeloží mesh resolver (search doména) a clamd odpoví přes
routu do meshe (`PONG`, verze i datum signatur). Na instanci, kde vše běží na jednom
stroji, totéž jméno přeloží Docker jako alias na sdílené síti instance — držitel je na obou.
Adresa je TÁŽ proměnná, kterou dostává storage-auth (`CLAMD_HOST`, env-doctor CONTRACT);
vlastní se tu neskládá (brána `adresa-ma-jeden-domov`).
Port a interval jsou literály (`CLAMD_PORT: "3310"`, `DOCS_SCAN_INTERVAL: "60"`), ne proměnné
s výchozí hodnotou: port patří kontraktu stacku antiviru (`TCPSocket 3310`), interval je vlastnost
sidecaru — ani jedno nepopisuje instanci, takže není co doručovat a není nad čím hádat.

`user: "0:0"`: svazky zakládá `docs-sync` jako root; brána do nich musí psát. Práva
navíc nemá žádná (`cap_drop: ALL`, `read_only`, `no-new-privileges`).

## `test: ["CMD-SHELL", "[ $$(( $$(date +%s) - $$(cat /stav/tep) )) -lt 900 ]"]`

Zdraví = KDY naposledy kolo doběhlo, aniž nechalo práci stát kvůli platformě (clamd
neodpovídá nebo neskenuje, do vstupu nejde zapsat).
Tep se zapisuje i v kole, kdy není co skenovat — instance bez dokumentové lane (prázdné
`NEXTCLOUD_URL`) je tedy zdravá i bez antiviru a nasazení neshodí. Nezdravý je kontejner
teprve tehdy, když dokumenty ČEKAJÍ a brána je nemá jak posoudit nebo propustit (nebo nemá
konfiguraci):
příjem dokumentů stojí a má to být vidět, ne se dozvědět za týden z prázdné fronty.
Práh 900 s = 15 kol; krátký výpadek antiviru (restart, aktualizace signatur) stack neshodí.

## `NEXTCLOUD_APP_PASSWORD: ${NEXTCLOUD_APP_PASSWORD:-}`

⛔ NAMĚŘENO 2026-08-29: rclone bere heslo JEN ve svém obfuskovaném tvaru a
na čitelné spadne (`couldn't decrypt password: base64 decode failed`).
Vyžadovat po člověku `rclone obscure` je zbytečně křehké — sidecar si ho
obfuskuje SÁM. Přijímají se obě podoby: kdo už obfuskované má, vloží ho.

## `DOCS_SYNC_INCLUDE_SMLOUVY: ${DOCS_SYNC_INCLUDE_SMLOUVY:-}`

Vzory (čárkou oddělené) — GENEROVANÉ z deklarací zdrojů, ne psané ručně:
<fork>-instance-data/sources/nextcloud-{contracts,docs}.json → include_paths.

## `money-sync:`

Próza: docs/compose-notes/docker-compose.coolify-local-ingest.yml.md

## `input-init:`

Bez hotového přípojného bodu by se kontejner ani nevytvořil (viz input-init).

## `- ingest-input:/data/input`

⛔ SPOR DVOU ZÁMĚRŮ, vyřešený tak, že PLATÍ OBA (2026-09-01).

Větev tvrdila: `:ro` je ZÁMĚR — vstup je pro engine fakt, dokumenty
chodí mountem z Nextcloudu, ne uploadem.
main tvrdil:   `:ro` PRYČ — cesta neměla žádného zapisovatele
               (`documents: 0`), upload vracel 403, a rozhodnutí
               majitele 2026-08-29 zní „doklady tlačí broker přes API
               ingestu, jen v rámci stacku, meshe".

Neodporují si: broker zapisuje do `/data/input`, Nextcloud se připojuje
do PODADRESÁŘE `/data/input/dokumenty` a tam `:ro` zůstává. Auditovatelnost
vstupu tím neztrácíme — co přinesl mount, engine přepsat nemůže; co
přinesl broker, má původ v registru.

## `- ingest-docs:/data/input/dokumenty:ro` (a `- ingest-docs:/docs` v docs-sync)

DOKUMENTOVÉ ZDROJE (Nextcloud: smlouvy, firemní dokumenty). Plní je docs-sync
(`rclone copy --update` z Nextcloudu do `/docs`), local-ingest je čte týmž
POJMENOVANÝM svazkem `${APP_NAME_PREFIX}_local-ingest-docs` — obě služby jsou
v tomto compose, svazek tedy sdílet jde; jméno nese identitu instance, takže se
dvě instance na jednom stroji nepotkají. Podadresář `/data/input` proto, aby je
engine viděl týmž watchem jako zbytek vstupu. `:ro` zde ZŮSTÁVÁ — cizí zdroj se
nepřepisuje. Bez Nextcloudu (prázdné NEXTCLOUD_URL) zůstane svazek prázdný =
lane vypnutá, ne chyba.

⛔ Proč už ne `${INGEST_DOCS_MOUNT}` (hostitelská cesta): Coolify 4.3.16 rozhoduje
bind vs. pojmenovaný svazek jen podle TEXTU zdroje (`sourceIsLocal()`, naměřeno
živě 2026-09-28) — holé `${VAR}` tiše převede na svazek `<uuid>_<slug>` bez ohledu
na hodnotu, `${VAR:-x}` rozvine vždy na doslovné `x`. Proměnná nikdy nefungovala.

Přechod existující instance: prázdný vstup NIC nesmaže (engine je aditivní:
`_iter_inputs` jde jen přes přítomné soubory, broker volá jen `li_upsert_*`;
ověřeno RIQi 2026-09-28 i na produkci). Svazek naplní docs-sync při dalším cyklu.
Kdo chce ušetřit opakované čtení, předkopíruje dosavadní hostitelský adresář
se zachovaným mtime (`docker run --rm -v <stará cesta>:/z -v <prefix>_local-ingest-docs:/do
alpine cp -a /z/. /do/`) — přírůstková brána enginu je cesta+velikost+mtime.
Deklarace zdrojů: <fork>-instance-data/sources/nextcloud-{docs,contracts}.json

## `init: true`

PID 1 je holý `python` a nesklízí potomky — zombie z healthchecku
kontejner restartovaly. Viz compose-notes.

## `profiles: ["mesh"]`

Mesh komponenta — bez meshe nemá co dělat. Profil "mesh" zapíná
coolify-deploy-init.sh podle MESH_ENABLED; hlídá brána mesh-profil-drzi.

## `profiles: ["mesh"]`

Mesh komponenta — bez meshe nemá co dělat. Profil "mesh" zapíná
coolify-deploy-init.sh podle MESH_ENABLED; hlídá brána mesh-profil-drzi.

## `GATEWAY_TRUSTED_PROXIES: ${GATEWAY_TRUSTED_PROXIES:-}`

TÝŽ seznam, jaký dostává gateway — jeden zdroj (`lib/derive-subnets.mjs`).
Bez něj Caddy `x-forwarded-for` PŘEPÍŠE a klientská adresa se ztratí.

## `ingest-drop-route:`

⛔ NAMĚŘENO 2026-09-15: `ingest-drop-push` stavěl trasu do mesh sám, jenže obraz
`mc` nemá `ip` („ip: command not found", exit 64). Po nasazení s profilem `mesh`
skončil v restart smyčce a stack local-ingest se zastavil. Balíky proto od
09-07 k brokerovi nedorazily.

Trasu teď staví a drží busybox, který síťový jmenný prostor VLASTNÍ. Blok
`_mesh=…esac` je doslova z `infra/mesh/mesh-client-route.sh`. Smyčka pak
každou minutu trasu obnoví, takže výpadek sítě nevyžaduje restart.
`ingest-drop-push` do jmenného prostoru jen vstoupí
(`network_mode: "service:ingest-drop-route"`) a dědí síť, DNS i trasu. Proto
nepotřebuje `cap_add`, `dns` ani `networks` — Docker je u `network_mode` ani
nedovolí.

Healthcheck měří VLASTNOST: trasa do rozsahu peerů v tabulce je. Bez meshe
(veřejná lane) se nic nestaví a zdraví je triviálně pravda.

## `ingest-drop-push:`

── Doprava balíků: bucket ↔ drop ────────────────────────────────────────────
⛔ NAMĚŘENO 2026-09-06: drop byl `bind mount` hostitelské cesty v OBOU stacích,
jenže engine (placement experimental) a broker (backend) běží na RŮZNÝCH
strojích — balík vyrobený enginem k brokerovi nikdy nedoletěl. Bind mount je
vnitřek stacku, ne přenosová cesta; přenos mezi stroji je OBJEKTOVÉ ÚLOŽIŠTĚ.

Sidecar zrcadlí jedním směrem PRAVIDELNÝM ÚPLNÝM PRŮCHODEM (`rclone copy`, do
2026-09-25 `mc mirror` bez `--watch`, každých 60 s), takže balík je
u konzumenta bez ohledu na to, kde vznikl. `copy`, ne `sync`: jako `mc mirror`
bez `--remove` nahraje nové a změněné, v bucketu nic nemaže.

⛔ NAMĚŘENO 2026-09-16 v produkci instance: s `--watch` se nepřeneslo NIC.
Balíček vzniká přesunem hotového adresáře (staging → export, aby doprava nikdy
neviděla rozepsaný balíček) a inotify do přesunutého adresáře NEZANOŘÍ — o souborech
uvnitř se hlídání událostí nikdy nedozví. Balíček ležel v `/drop/export`, bucket měl
0 objektů, a po restartu sidecaru ho úvodní úplný průchod nahrál (40 objektů za 10 s).
Průchod navíc řeší i tiché ukončení `--watch` při restartu MinIO.

Klíč je SCOPED na jediný bucket (politika `ingest-drop-rw`, storage-init v jádru) —
root pověření se do dalších stacků nešíří.

## `profiles: ["mesh"]`

⛔ MESH JE PODMÍNKA SPUŠTĚNÍ, NE JEN CHOVÁNÍ. Skript sám umí `MESH_ENABLED=false`
(„veřejná lane"), ale compose to nedovolí: `dns: ${NETBIRD_DNS_IP:?}` a
`NETBIRD_PEER_CIDR:?` se interpolují PŘED během, takže instalace bez meshe by
stack vůbec nerozjela — a „náš provozní tvar není podmínka platformy". Profil je
táž léčba, jakou dostaly `netbird-agent` a `local-ingest-mesh-ingress`.
Aby sidecar běžel i bez meshe, musel by přijít o `dns:` a mít `:-` místo `:?` —
to je samostatná změna, ne vedlejší účinek slití forku.

## `environment:`

⛔ Na APLIKAČNÍ služby sidecar nečeká: mluví jen s bucketem. Čekat na jejich
zdraví by dopravu zbytečně svázalo s cizím životním cyklem.
Pravidelný průchod si na obsah počká sám.
Jediné `depends_on` je na `ingest-drop-route` (`service_healthy`). Ten
sidecaru dává síť: bez trasy by se mesh jméno MinIO přeložilo, ale spojení by
nenavázalo.

## `RCLONE_CONFIG_DROP_TYPE: s3`

S3 remote `drop:` si rclone skládá z proměnných `RCLONE_CONFIG_DROP_*` — žádný
konfigurační soubor s tajemstvím (týž tvar jako `docs-sync` výš s remotem `nc:`).
`PROVIDER: Minio` + `FORCE_PATH_STYLE` = adresa `http://host:9000/<bucket>`
(MinIO za jménem v meshi nemá virtuální hostitele). `NO_CHECK_BUCKET`: bucket
zakládá `storage-init` jádra a omezený klíč `CreateBucket` nesmí — rclone se
ho jinak pokusí založit při prvním zápisu.

## `RCLONE_CONFIG_DROP_ACCESS_KEY_ID: ${INGEST_DROP_ACCESS_KEY}`

⛔ BEZ `:?`: fail-closed v `environment:` vynutí tajemství DO BUILDU
(Coolify posílá env i jako --build-arg → `docker history`). Stráž je za běhu
(exit 64 v entrypointu).

## `- ingest-out:/drop:ro`

⛔ SVAZEK STACKU, NE HOSTITELSKÁ CESTA. Bind mount `/srv/<instance>/…` byl
dvakrát špatně: nesl jméno CIZÍ instance a parametrizovat ho nelze —
brána `coolify-compose-compliance` zakazuje ${VAR} ve zdroji svazku
(ochrana proti injekci příkazu v Coolify). Když je dopravou mezi stroji
bucket, drop patří DOVNITŘ stacku: engine sem píše, sidecar odsud čte.

## `test: ["CMD-SHELL", "[ $$(( $$(date +%s) - $$(cat /tmp/last-sync) )) -lt 300 ]"]`

Levný: zrcadlení běží, když běží proces. Na otázku „došel balík?"
odpovídá kurzor brokera, ne healthcheck.

## `image: ${IMAGE_RCLONE:?pin z config/image-versions.env}`

rclone, ne `mc` (2026-09-25). MinIO obrazy nikdo nevydává: `minio/mc` na Docker
Hubu přestal existovat 2026-09-11, `quay.io/minio/mc` vrací od 2026-09-24 `401`.
Nestažitelný obraz zastaví nasazení CELÉHO stacku, ne jen tohoto kontejneru.
`mc` zůstal jen ve `storage-init` jádra (správa politik/uživatelů), který se staví
ze zdroje; dopravě stačí obecný S3 klient, pinovaný v `config/image-versions.env`
jako `docs-sync` (přes `REGISTRY_PROXY`).

`:?` místo `:-` schválně: povinnou referenci měří `scripts/lib/povinne-promenne.mjs`
před nasazením — chybějící pin se nesmí tiše nahradit.

Obraz rclone má BusyBox (`ip`, `date`, `cat`, `timeout`); `curl` ani `bash` ne —
sonda proto jen čte otisk času (brána `sonda-vola-jen-co-obraz-ma`).

## `ingest-drop-push-netns:`

⭐ BEZ `profiles: ["mesh"]` (od 2026-10-03): netns sdílí i `docs-scan`, a ta musí běžet
VŽDY — jinak by na instanci bez meshe dokumenty zůstaly v karanténě a nikdo by neviděl
proč (žádný kontejner, žádné zdraví). Držitel si s vypnutým meshem poradí sám: routu
nestaví a je zdravý (`MESH_ENABLED` čte už dnes). `ingest-drop-push` profil `mesh` má dál.

⛔ NAMĚŘENO 2026-09-16 na guru: `ingest-drop-push` padal smyčkou s `ip: command not found`
(exit 64). Obraz `minio/mc` nemá `ip`, takže inline routa do mesh v jeho entrypointu nikdy
nemohla uspět — a spolu s ním byl nezdravý celý stack `local-ingest`. Routu teď staví
DRŽITEL netns (týž tvar jako `svc-knock-netns` v edge: `caddy:alpine` s BusyBox `ip`,
`cap_drop: ALL` + jen `NET_ADMIN`, `read_only`, `no-new-privileges`). `ingest-drop-push`
sdílí jeho síťový stack (`network_mode: service:ingest-drop-push-netns`) a sám žádná práva
ani síť nedeklaruje. Zdraví držitele = routa v tabulce.
Zdraví = KDY naposledy průchod DOBĚHL, ne že proces existuje. Zaseknuté zrcadlení
má živý pid a nepřenese nic; otisk času je jediné, co odliší „běží" od „veze".
Práh 300 s = pětinásobek intervalu průchodu, takže jeden pomalejší průchod
(velké kb_artifact) kontejner neshodí. Na otázku „došel balík?" dál odpovídá
kurzor brokeru, ne healthcheck.

⛔ 2026-09-16: dřív to bylo `pgrep`/`kill -0` nad `mirror.pid`. Sidecar byl tedy
celou dobu „healthy", zatímco bucket zůstal prázdný — viz poznámka u `mc mirror` výš.
