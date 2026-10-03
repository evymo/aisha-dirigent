# docker-compose.coolify-netinit.yml — warmup hostitelských sítí (vlna 0)

> Prose k [docker-compose.coolify-netinit.yml](../../docker-compose.coolify-netinit.yml).
> Compose soubor se posílá na server jako argument příkazové řádky a soupeří
> s ARG_MAX — vysvětlení proto žijí tady, kotvená k řádkům, které vysvětlují.

## Proč tahle aplikace existuje

Sítě instance (`<prefix>-shared-net`, `<prefix>-mesh-dns`) jsou zdroj
**hostitele**, ne aplikace. Všechny ostatní stacky je deklarují `external:
true` — tedy jako slib, že už existují. Nikdo ze stacků si je založit nemůže:

- compose ověřuje externí sítě **před spuštěním prvního kontejneru** (změřeno
  2026-08-11: s neexistující sítí nevznikl ani init kontejner s
  `network_mode: none`),
- a kdyby síť stack **vlastnil** (ne-external), mazal by ji při teardownu —
  nasazení pak spadne, jakmile na síti visí kontejner jiného projektu, přesně
  tak umřel `aisha-clamav` („network … has active endpoints").

Warmup je proto samostatná aplikace na každém placementu (Coolify aplikace
běží na jednom serveru): přes docker.sock sítě idempotentně založí a pak drží
hlídku. Nasazuje ji vlna 0 v `scripts/aisha-redeploy.mjs`; po dokončení
rolloutu ji `scripts/aisha-cold-start.sh` (remove_warmup_apps) smaže.

## Proč kontejner po práci NEskončí (hlídka)

První verze byla one-shot (`restart: "no"`, doběhne a skončí). Ukázalo se, že
úspěch takové práce **nejde změřit**:

- „deployment finished" od Coolify znamená jen „`compose up -d` vrátil nulu",
  tedy že se kontejner *spustil* — ne že práci odvedl;
- logy ukončené aplikace Coolify API odmítá (změřeno 2026-08-11:
  `GET /applications/{uuid}/logs` na exited app → HTTP 400 „Application is
  not running"), takže ani sentinel v logu není dosažitelný důkaz.

Selhání warmupu by tak prošlo jako úspěch a projevilo se až o vlnu později
jako „declared as external, but could not be found" — příznak daleko od
příčiny. Řešení: kontejner po založení sítí zůstane běžet a jeho
**healthcheck je `docker network inspect` obou sítí na hostiteli**. Zdraví
aplikace pak přímo znamená „sítě existují" — měří se výsledný stav, ne
vyprávění o běhu. Vlna 0 díky tomu nepotřebuje žádnou speciální větev: čeká
na `running:healthy` jako každá jiná vlna.

Kdyby sítě kdokoli za běhu rolloutu smazal, hlídka zčervená — zdraví není
jednorázový zápis, ale průběžné měření.

## Bezpečnostní rámec socketu

`/var/run/docker.sock` je root-ekvivalentní přístup k hostiteli. Rámec:

1. drží ho jen tahle aplikace, jen po dobu rolloutu,
2. po rolloutu ji cold-start smaže a **ověří, že smazaná je**
   (remove_warmup_apps čte aplikace zpět — odeslaný DELETE není smazaná
   aplikace),
3. restart validace (krok 6zz cold-startu) běží až po smazání — tím se
   prokazuje, že za běhu na netinit nic nezávisí a sítě přežily smazání
   svého tvůrce (sítě založené přes CLI compose nevlastní).

## Invarianty hlídané branami

- `warmup-hlidka-zdravi-je-dukaz.gate.test.ts` — healthcheck není `disable`,
  měří `$$SHARED_NET` + podmíněně `$$MESH_NET`, command drží smyčku,
  `restart: "no"` (pád hlídky = viditelný exited), socket je namountovaný.
- `registry-proxy-obraz-ma-repozitar.gate.test.ts` — obraz přes
  `${REGISTRY_PROXY}` nese plné jméno repozitáře (`library/docker:27-cli`);
  krátké jméno pull-through cache nezná (změřeno 2026-08-11 na varra).
- `compose-external-network-exists` + `coldstart-mesh-dns-activation` —
  soulad jmen sítí mezi warmupem, generate-secrets a konzumenty.

## Pasti, na které se tu už narazilo

- **`$` v `command:`** — compose interpoluje při parsování; jednoduché
  `$SHARED_NET` by nahradil prázdnem a warmup by tiše zakládal síť `""`
  (změřeno 2026-08-11). Všechny shellové proměnné musí být `$$`.
- **`docker:27-cli` bez `library/`** — proti pull-through cache „not found",
  deploy spadne dřív, než se cokoli spustí.
- **Subnet sdílené sítě se neurčuje** — nikdo si na ní nepinuje IP; ať ho
  vybere Docker, dvě instance na jednom hostu se nepotkají na „Pool
  overlaps". Mesh-DNS subnet naopak povinný je (mesh-router si pinuje
  `ipv4_address`).

## `image: library/docker:27-cli`

`library/` je POVINNÉ. Přes pull-through cache se oficiální obrazy adresují
plným jménem repozitáře; bez prefixu vrátí registry "not found" a deploy
padne dřív, než se cokoli spustí. Změřeno 2026-08-11 na varra:
  docker pull cache.aisha.guru/docker:27-cli         → not found
  docker pull cache.aisha.guru/library/docker:27-cli → OK
Táž konvence jako u ostatních stacků (library/alpine, library/caddy).

⛔ ALE BEZ ${REGISTRY_PROXY} — a to je load-bearing. Cache obsluhuje
`<instance>-registry`, tedy aplikace z VLNY 1; tenhle warmup je VLNA 0 a
teprve zakládá síť, na které registry běží. Tahat obraz přes cache, kterou
sám bootstrapuje, je kruh — a zavře se při prvním nasazení po výpadku
registry, kdy už cache neodpovídá:
  netinit Error: failed to resolve reference
    "cache.<host>/library/docker:27-cli" — unexpected status from HEAD
Naměřeno 2026-08-12: registry spadlo → warmup neprošel → síť nevznikla →
registry se nemělo kam nasadit. Z kruhu není cesta ven bez ručního zásahu
na hostiteli, a to je přesně to, čemu se cold-start vyhýbá.
Vlna 0 proto tahá PŘÍMO z Docker Hubu. Je to jediný obraz v celé platformě,
který cache obejít MUSÍ.

## `network_mode: none`

Bez sítě: tenhle kontejner nic nekonzumuje, jen mluví se socketem.

## `- /var/run/docker.sock:/var/run/docker.sock`

ZÁMĚRNĚ zapisovatelný socket — vytvořit síť na hostiteli jinak nelze.
Je to root-ekvivalentní přístup, proto tahle aplikace po dokončení
rolloutu MIZÍ (aisha-cold-start.sh ji smaže). Stálé oprávnění to není.
Po dobu rolloutu kontejner BĚŽÍ jako hlídka (viz healthcheck níže) —
držení socketu je tedy omezené na okno rolloutu, ne na vteřiny, ale
pořád končí smazáním aplikace.

## `DRY_RUN: ${DRY_RUN:-0}`

Náhled nasazení nesmí sáhnout na sítě hostitele. Výchozí 0 = ostrý běh;
cold-start v dry-run režimu tuhle aplikaci vůbec nenasazuje, ale kontrakt
„destruktivní operace je DRY_RUN-gated" platí pro celý strom bez výjimky.

## `command:`

POZOR NA `$$`: všechny shellové proměnné tady MUSÍ být zdvojené. Compose
interpoluje `command:` při parsování a `$SHARED_NET` by nahradil prázdnem
(naměřeno 2026-08-11: `The "SHARED_NET" variable is not set`), takže by
warmup zakládal síť se jménem "" a tiše nic neudělal. Hodnoty přicházejí
přes `environment:` výše a čte je až shell v kontejneru.

## `test:`

Měří TÝŽ zdroj, který command zakládá: sítě na HOSTITELI (přes socket).
Kdyby je kdokoli smazal, hlídka zčervená — zdraví není jednorázový zápis.
POZOR na odsazení: ve skládaném skaláru (`>-`) se slepují jen řádky se
STEJNÝM odsazením jako první. Řádek odsazený VÍC se bere doslovně a nový
řádek před ním zůstane — shell pak dostane řádek začínající `||` a padne
na „syntax error: unexpected ||". Naměřeno 2026-08-13: hlídka vlny 0
takhle selhala 170× po sobě, takže se vlna nikdy neprokázala zdravím.

## `start_period: 20s`

Založení sítí trvá vteřiny; 20 s kryje pomalý docker daemon po bootu.
