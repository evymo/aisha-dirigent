# docker-compose.coolify-accel-vstup.yml — vstup lane + hlídač členství (operátor GPU uzlu)

> Prose k [docker-compose.coolify-accel-vstup.yml](../../docker-compose.coolify-accel-vstup.yml).
> Compose soubor se posílá na server jako argument příkazové řádky a soupeří
> s ARG_MAX — vysvětlení proto žijí tady.

## Proč tahle aplikace existuje

Jediný kontejner na sítích nájemců `<vlastník>-lane-<nájemce>` je vstup lane (`svc-accel-vstup`, VB). Enginy
jsou jen na síti jádra. Nasazuje ho Coolify jako aplikaci `accel-vstup` instance vlastníka vrstvy (katalog,
manifest, vlna 1 za firewallem; rozhodnutí majitele 2026-10-06: na GPU uzel jen přes Coolify). Přepínačem
je deklarace uzlu v datech instance (`accel/uzel.json`), env vrstvy z ní odvozuje
`scripts/lib/derive-accel-uzel.mjs` (cold-start i env-doktor). Proměnné lane compose čte HOLÉ a vede je
v `x-aisha-povinne-za-behu` (prázdné za běhu = doktor fáze P), tajemství nikdy s `:?`.

## Raw compose na GPU slotu

Na slotu s `has_gpu` nasazuje Coolify compose RAW (`is_raw_compose_deployment_enabled`, nastavuje a zpětně
čte story-init; `lib/umisteni-sluzeb.mjs nasazujeRaw`). Běžný parser Coolify v4 by každé službě bez
`network_mode` přidal síť aplikace `<uuid>` (bridge s cestou ven), každé přidal `env_file: [.env]` se všemi
proměnnými aplikace a přepsal `container_name`. VB by tak měl cestu ven a seděl na jedné síti se stahovačem
vah, stahovač by dostal klíč jádra a hlídač by nepoznal kontejnery. Raw přidá jen štítky
`coolify.managed`, `coolify.applicationUuid`, `coolify.type`; projekt compose = uuid aplikace.

## Sítě (zakládá je TENHLE compose)

- `<vlastník>-accel-jadro`: VB + enginy, `internal`, bez IPv6, podsíť z deklarace.
- 8 sítí slotů `<vlastník>-lane-<ACCEL_NAJEMCE_n>`: obsazený slot nese jméno nájemce, volný `volny-<n>`
  (nájemce se tak jmenovat nesmí). `internal`, bez IPv6, podsíť a rozsah klientů (`ip_range`) z deklarace;
  volný slot má podsíť z bloku `volne_sloty_blok` a rozsah = horní polovina /28. Compose je proto statický
  a prázdný slot ho neshodí. Jméno je v prostoru VLASTNÍKA: síť zakládá operátor, nájemce (tenký stack,
  `${LANE_VLASTNIK}-lane-${APP_NAME_PREFIX}`) se na ni jen připojuje.
- Nikdo na GPU slotu nemá zapisovací socket Dockeru: dřívější konvergence (`docker network create`)
  zanikla. Tvar existující sítě (internal, podsíť) měří hlídač a nesoulad je incident.
- Síť založenou mimo compose (warmup) compose odmítne („incorrect label“): při přechodu ji smaže obsluha.

## accel-vahy (jednorázový)

Stáhne připnuté revize vah VŠECH enginů do neměnných adresářů ve svazku `<vlastník>-accel-vahy`, změří sha256
a zapíše `aisha-identita.json` (popis v próze compose embed-1). Seznam adresářů dodá generátor deklarace jako
`ACCEL_VAHY_B64`, každý `<repo>@<revize>` jednou, takže nový engine compose kroku nemění. Dva enginy se
stejnými váhami (engine na nájemce, O-4) čtou jeden adresář. Je tady, v projektu hlídače, protože
zapis do svazku operátora smí jen operátorský stack. Engine svazek jen čte. Síť jen `<vlastník>-accel-ven`
(odchozí na Hugging Face). Stahuje z internetu, a proto běží jako uid 1000, ne root (obraz vLLM je jinak
root). `HF_HOME` je v tmpfs. Engine se do doby, než adresář vah nese změřenou identitu, sám nespustí.

`HF_TOKEN` je volitelný. Veřejné modely ho nepotřebují, gated modely a vyšší limity Hugging Face ano. Plní ho
`HF_READ_TOKEN` z trezoru instance (env-doktor, `template-default` za lane accel-vstup), holý `${HF_READ_TOKEN}`.
Díky raw režimu ho nedostane žádná jiná služba aplikace. Compose ho jmenuje jen u `accel-vahy`, takže
engine (offline) ani VB ho nedostanou. Token má být fine-grained jen pro čtení: skončený kontejner `accel-vahy`
ho drží v `Config.Env` a vidí ho každý s přístupem k démonu, tedy root uzlu.

## accel-prava (jednorázový)

Docker zakládá pojmenované svazky jako root, ale váhy, deklarace a hlídač běží jako uid 1000 (`node` obrazu
svc-accel-vstup; `accel-vahy` z obrazu vLLM má uid nastavené číslem). Tenhle krok jen předá svazky `vahy`,
`deklarace`, `clenstvi` a `hlidac` uid 1000 (`chown -R`) a skončí. Kromě proxy socketu je jediný, kdo běží
jako root. Má jen `CHOWN`, je bez sítě, s kořenem jen pro čtení a s pevným příkazem bez vstupu zvenku.
Váhy, deklarace a hlídač na něj čekají (`service_completed_successfully`).

## accel-deklarace (jednorázový)

Zapíše deklaraci pro VB (`ACCEL_DEKLARACE_B64` = `vbDeklarace()` z `accel-uzel.mjs`, vydává ji odvození
vrstvy) atomicky do svazku `<vlastník>-accel-deklarace` (dočasný soubor + přejmenování). Bez sítě,
`read_only`, `cap_drop: ALL`. Ověření obsahu dělají dva nezávislé výklady: odvození před nasazením
(`overUzel`, vadná deklarace = cold-start STOP) a VB za běhu (zod, `tabulka.ts`). Nečitelná deklarace =
VB neobslouží nikoho.

## accel-vstup (VB)

- Pevná adresa na jádře (`ACCEL_JADRO_VSTUP_IP`) a na každém z 8 slotů (`ACCEL_NAJEMCE_<n>_IP`).
  Volné sloty mají vlastní podsíť z vyhrazeného bloku (viz Sítě).
- `sysctls`: `ip_forward=0`, `rp_filter=1`, `arp_ignore=1`, `arp_announce=2`, IPv6 vypnuté
  (NAVRH-LANE-JADRO §1.4). VB je měří za běhu.
- Bez portů na hostiteli. Zdraví jen na `127.0.0.1:8081/__vb/zdravi`.
- Proces je `dist/server.js` (OTel, metriky na správě 127.0.0.1:8081), aplikaci staví `vstup.ts`. Export OTel vypíná
  `OTEL_SDK_DISABLED`, protože sítě lane i jádra jsou `internal` a kolektor z uzlu dosažitelný není.
- `max_tokenu` aliasu (obsah bez speciálních tokenů) VB vynucuje. Vstup do (max_tokenu − 1) / 6 bajtů UTF-8 se
  vejde vždy (tokenizér udělá nejvýš ~6 tokenů z bajtu: NFKC rozšíří až 18 znaků ze 3 bajtů) a neměří se. Delší
  změří tokenizér enginu (`/tokenize`, `add_special_tokens: false`) pod kvótou nájemce. Nad limit dostane
  `400 POZADAVEK_NEPLATNY` (pole `input`) a embeddings se nevolá.
- Engine na nájemce (O-4): deklarace se dvěma nájemci na jednom enginu je nečitelná. Výjimkou je jen
  `diagnostika: true` (sonda operátora).
- Režim kvót nájemce je v deklaraci výslovně (`kvoty.rezim`, majitel 2026-10-06: limity zatím jako varování):
  `varovani` = požadavek nad kvótou (okno `gpu_ms`, souběh, počet vstupů v dávce) PROJDE, VB zapíše
  `kvota_varovani` a vrátí hlavičku `x-aisha-kvota` se seznamem překročených kvót; počítá se stejně jako
  v ostrém režimu, takže varování ukazují, kde se nájemci potkávají. `vynucovat` = `429 KVOTA_PREKROCENA`
  s `Retry-After` (u okna `gpu_ms` sekundy do hranice pevného okna, nahoru, aspoň 1; u souběhu 1 s).
  Nedostupná kniha spotřeby je tvrdá v obou režimech (účetnictví, ne mez).
- Svazek vah jen pro čtení na `/vahy`, tedy na stejné cestě jako v enginu. VB z něj čte `aisha-identita.json`
  z adresáře, který engine hlásí jako `root` modelu, do hlavičky `x-aisha-identita`. Čte jen z neměnného tvaru
  `/vahy/<repo>@<40hex>` a revize v identitě musí sedět se jménem adresáře. Bez svazku zahřátí končí `ENOENT`
  a VB vrací `503 LANE_STARTUJE` (naměřeno při F4, 2026-10-06).
- `ACCEL_JADRO_KLIC` (v kontejneru) je interní klíč operátora mezi VB a enginy. Plní ho tajemství vrstvy
  `ACCEL_JADRO_API_KEY`: vyrábí ho env-doktor se zapnutou lane accel-vstup a cold-start ho zachová (nový
  klíč by rozpojil VB a enginy do příštího nasazení obou). Nikdy není v deklaraci ani v repu. Compose ho nese
  holý (`${ACCEL_JADRO_API_KEY}`, tajemství bez `:?`, brána accel-tajemstvi-hola-v-compose) a prázdný odmítne VB
  při startu (`konfigurace_vadna`).

## accel-hlidac (hlídač členství)

- Týž obraz jako VB, jiný příkaz (`hlidac-main.js`), běží jako `node`. Měří přes Docker API, kdo je na sítích
  lane a jádra, a zapisuje `clenstvi.json`. Bez měření VB neobslouží nikoho (fail-closed). Hlídač zpracovává
  data o cizích kontejnerech, a proto nesmí běžet jako root.
- Kontejnery poznává podle jména (na hostiteli jedinečné) a štítku projektu compose. Na GPU slotu
  nasazuje Coolify raw, takže `container_name` z compose platí. Identitu podle štítků compose a služby
  zpevňuje hlídač v5 (RIQi, 2026-10-06).
- Služby operátorského stacku mají v hlídači výjimku jen pro zápis do VLASTNÍHO svazku (jméno A projekt
  compose hlídače): deklarace → `-accel-deklarace`, váhy → `-accel-vahy`, proxy → `-accel-docker-proxy`,
  hlídač → `-accel-clenstvi` a `-accel-hlidac`, VB nic. Zápis do cizího svazku operátora nebo bind kořene
  a svazků Dockeru je incident i u operátora. Socket démona bez varování smí držet jen proxy.
- Compose (v5.4.0, `planRecreateContainer`) při znovuvytvoření nejdřív VYTVOŘÍ nový kontejner pod dočasným
  jménem `<12 hex ID STARÉHO>_<jméno>`. Pak starý zastaví a smaže, nový přejmenuje a spustí až pod pravým jménem.
  Hlídač dočasný tvar pozná jako tutéž službu operátora, ale JEN u neběžícího kontejneru z projektu hlídače.
  Takový kontejner nic nevykonává, a jakmile běží, musí nést pravé (unikátní) jméno. Běžící kontejner v dočasném
  tvaru je incident. Bez toho hlídač při každém znovunasazení držel incident na jádře (naměřeno 2026-10-06:
  dočasné jméno `<12 hex>_<vlastník>-accel-hlidac` neslo ID předchozího hlídače, ne vlastní).
- Přechodný člen (připojil se a mezi měřeními odešel) se posuzuje stejně jako živý, včetně projektu operátora
  u jména vstupu. Kontejner, který už neexistuje, je cizí.
- Docker API volá BEZ verze v cestě (démon odpoví svou aktuální verzí). Pevná verze by po upgradu Dockeru
  padala, měření by zestárlo a VB by neobsloužil nikoho.
- **Potvrzení incidentu** (`--potvrd <síť> --kdo <kdo> --duvod <proč>`) se nejdřív zapíše do
  `/hlidac/potvrzeni.jsonl` a teprve potom se incident uvolní. Hlavní proces záznam vypíše do `docker logs`
  (`incident_potvrzen`), protože výstup `docker exec` vidí jen volající. „kdo“ je deklarované: identitu
  uživatele SSH na hostiteli kontejner ověřit neumí.
- Healthcheck hlídače = čerstvost `clenstvi.json` (< 60 s, hlídač měří každých 10 s). Hlídač, který neměří,
  je nezdravý.
- **Bez docker.sock (N3 revize 0c, majitel 2026-10-06 „opravit před testem“).** Hlídač vidí jen
  filtrovaný unixový socket `/proxy/docker.sock` ze svazku `<vlastník>-accel-docker-proxy`, který
  sdílí výhradně s proxy. Sám běží bez sítě (`network_mode: none`).

## accel-docker-proxy (proxy socketu jen pro čtení)

- `wollomatic/socket-proxy` připnutý digestem (`IMAGE_DOCKER_SOCKET_PROXY`, jediný domov pinů).
  Jako jediný drží docker.sock. Bez sítě, `read_only`, `cap_drop: ALL`, root kvůli právům k socketu.
- Povoluje JEN `GET` na `/containers/json`, `/containers/<ref>/json`, `/networks/<jméno>`, `/events` a `/info`,
  s verzí v cestě (`/v1.N/…`) i bez ní (hlídač volá bez verze). Přesně tyhle cesty hlídač volá: kontejnery, sítě, události a DockerRootDir
  pro cesty svazků. POST, DELETE, PUT a ostatní metody nejsou nastavené, a proto zakázané. Hlídač tak nic nezaloží,
  nespustí ani nesmaže.
- Socket pro hlídač má režim 0666 (hlídač běží jako `node`). Svazek nevidí žádný jiný kontejner.
- `GET /containers/<id>/json` vrací i `Env` ostatních kontejnerů. Hlídač z odpovědi bere jen jméno,
  projekt, režimy jmenných prostorů a připojení. Env nikam nezapisuje (ani do logu, ani do `clenstvi.json`).
- Healthcheck: vestavěné `/healthcheck` obrazu. S `-allowhealthcheck` proxy spouští kontrolní server na
  `127.0.0.1:55555/health` i v režimu unix socketu (smyčka `lo` existuje i v `network_mode: none`) a ten ověřuje
  dostupnost socketu démona.
- `-watchdoginterval=30 -stoponwatchdog`: proxy se ukončí, když socket démona zmizí. Restart ji
  vrátí, hlídač mezitím neměří a VB po zestárnutí měření nájemce neobslouží (fail-closed).
