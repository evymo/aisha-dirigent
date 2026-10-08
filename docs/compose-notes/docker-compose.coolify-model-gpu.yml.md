# docker-compose.coolify-model-gpu.yml — tenký stack forku na sdíleném GPU uzlu

> Prose k [docker-compose.coolify-model-gpu.yml](../../docker-compose.coolify-model-gpu.yml).
> Compose soubor se posílá na server jako argument příkazové řádky a soupeří
> s ARG_MAX — vysvětlení proto žijí tady.

## Proč tahle aplikace existuje

Na GPU uzlu (slot `gpu`) neběží model forku. Modely servíruje **společná lane**
operátora (vynucovací bod `svc-accel-vstup` + enginy vLLM). Fork tam má jen tenký
stack `<prefix>-model`, který dělá dvě věci:

1. **`model-mesh-agent`** připojí uzel do **modelového meshe forku** (varianta C):
   řídicí rovina běží u forku, GPU uzel je jen odchozí peer a nic nevystavuje.
2. **`svc-model`** (`services/svc-lane-klient`) přijme požadavek z dispatch forku
   a přepošle ho na vstup lane. Má jediný upstream a nenese žádný klíč.

Dispatch forku tak volá `svc-model` stejně jako dřív, jen modelovým meshem.
Hlavního meshe forku se uzel nedotkne (krok 0 doktoru, `lib/umisteni-slotu.mjs`).

## model-mesh-agent

- `--disable-dns --disable-client-routes --disable-server-routes --block-lan-access`
  (ověřeno na `netbirdio/netbird:0.70.0`, `netbird up --help`): agent nepřepisuje DNS,
  nepřijme trasy z managementu a sám nikam nesměruje. Uzel tedy nevidí sítě forku
  a fork přes uzel nevidí LAN (podmínka Aishy 1). SSH server se nespouští, protože
  chybí `--allow-server-ssh`.
- Na uzlu se ještě musí změřit, že tohle management nepřebije. Kontrakt je
  `src/tests/accel-uzel/site.uzel.test.ts` (`netbird status -d`, `ip route`).
- `sysctls ip_forward=0`: jmenný prostor agenta není router mezi meshem a lane.
- `cap_add` jen `NET_ADMIN` (rozhraní WireGuardu). Bez `SYS_RESOURCE`: na sdíleném GPU uzlu
  povoluje krok 0 jen NET_ADMIN a většina agentů meshe v repu bez ní běží.
- `NB_SETUP_KEY: ${MODEL_MESH_SETUP_KEY:-}` je **jednorázový** klíč z bootstrapu
  modelového meshe (`scripts/netbird-bootstrap.sh`). Po zápisu do konfigurace ho
  agent nepotřebuje. Proto `:-` a stav `PENDING_BOOTSTRAP`, když není ani konfigurace,
  ani klíč. Klíč se nesmí jmenovat `NETBIRD_STACK_KEY_*`, to je stopa hlavního meshe
  a krok 0 by ho na slotu gpu zastavil.
- `NB_MANAGEMENT_URL` odvozuje topologie forku (`NETBIRD_MODEL_DOMAIN`).
- `NB_HOSTNAME: ${MODEL_MESH_GPU_PEER}` (odvozuje topologie forku, typicky `<prefix>-model`): bootstrap
  modelového meshe pustí do skupiny uzlu PRÁVĚ JEDEN peer s tímto jménem, jinak STOP (rada cb, P1).
  Jméno peeru se proto nesmí skládat tady, jinak by se mohlo rozejít se jménem, které čeká bootstrap.
- Oba klíče jsou `:-`, ne `:?`, a prázdnou hodnotu odmítne entrypoint (FATAL, exit 1). Odvozuje je
  lane z topologie forku a základní tvar instance je nezná. `:?` by shodil interpolaci každého
  compose instance, i bez slotu gpu. Je to precedens `netbird-model` z kroku 2 modelového meshe.
- Stav zápisu: stačí KTERÝKOLI ze souborů `config.json` (starší agenti), `/etc/netbird/default.json`
  a `/var/lib/netbird/default.json`. NetBird 0.70 legacy `config.json` nepíše, takže bez nich by
  se agent při každém startu zapsal jako nový peer. Svazek je proto připojený na obě cesty.
- Zdraví: `netbird status --check ready`.

## svc-model (tenký klient)

- `network_mode: service:model-mesh-agent`: klient je ve jmenném prostoru agenta, takže
  vidí rozhraní meshe `wt0` i síť `<vlastník>-lane-<prefix>`. Přijímá jen spojení **na** adresu
  `wt0` **z** jejího rozsahu (pojistka M6/O8). Spojení z lane zavře bez odpovědi.
- `LANE_KLIENT_UPSTREAM: ${LANE_VSTUP_URL:-}` je jediný počátek: `http://<IP vstupu>:8000`
  na deklarované podsíti nájemce (VB má na síti nájemce pevnou adresu z deklarace uzlu). Odvozuje ji
  topologie forku. Proč IP, a ne jméno: jméno by řešil vestavěný DNS Dockeru napříč VŠEMI sítěmi
  jmenného prostoru agenta, takže kdo by se připojil k `ven` s týmž aliasem, dostal by požadavky
  i s klíčem. IP na interní síti lane hlídač hlídá. Prázdnou nebo jinou hodnotu (seznam, cesta,
  https) klient odmítne už při startu.
- `LANE_KLIENT_PORT: ${MODEL_MESH_PORT}` = port pro peery meshe. Jeden domov s mostem: most
  (`model-most`) míří na `MODEL_MESH_PORT` z topologie (port modelu z katalogu), klient na tentýž.
  Natvrdo zapsaný port by byl skrytá vazba, která se rozejde, jakmile se port modelu změní.
  Bez `:?` stejně jako u mostu: na cestě redeploye klíč nezapisuje env-doktor, prázdná hodnota
  proto nezastaví interpolaci compose, ale klienta (`LANE_KLIENT_PORT chybí`) — nahlas.
- `LANE_KLIENT_SPRAVA_PORT: "8081"` = správa jen na `127.0.0.1` (zdraví pro sondu kontejneru
  a `/metrics`); sonda v témže bloku míří na 8081. Obraz deklaruje oba porty (`EXPOSE 8000 8081`),
  ven se nepublikuje nic. Metriky na portu pro peery NEJSOU: mesh peer nemá co číst.
- Klient nemá výchozí hodnoty: chybějící nebo vadná proměnná (port mimo 1–65535, upstream se
  jménem místo IPv4, adresa vstupu mimo podsíť rozhraní lane) = klient nenastartuje.
- `OTEL_SDK_DISABLED: "true"` je deklarovaný stav, ne náhradní hodnota: lane je `--internal`
  a jmenný prostor agenta má jen mesh modelu, cesta ke kolektoru odtud nevede, takže zapnutý
  export by jen tiše selhával. ⏳ Otevřená položka: export zapnout, až bude kolektor
  z jmenného prostoru agenta dosažitelný.
- Bezpečnostní hlavičky odpovědi (helmet) klient přidává; tělo ani hlavičky protokolu
  (`x-aisha-*`) nemění. Omezení rychlosti NE: kvóty a souběh vynucuje vstup lane, 429 od
  klienta by porušilo uzavřený slovník odmítnutí (`LANE_*`).
- Bez klíče: `Authorization` z dispatch jen propouští (K1, podmínka Aishy 6).
- R5a: lane stojí → `LANE_NEDOSTUPNA` do 3 s, nikdy timeout dispatch ani jiný cíl.
- `read_only`, `cap_drop: ALL`, uživatel `node` z Dockerfile, `core: 0`.
- `container_name` Coolify PŘEPISUJE na `<služba>-<uuid aplikace>-<čas>` (změřeno 10-05 na serveru
  instance: `netbird-agent-<uuid>-…`). Hlídač členství proto nájemce pozná podle štítků compose,
  které nastavuje compose sám: projekt (= uuid aplikace) a služba (`model-mesh-agent`, `svc-model`).
  Do sítě agenta smí jen `svc-model` téhož projektu, a to přímo.

## Sítě

- `ven` (`<prefix>-model-ven`) je vlastní most stacku, odkud agent odchází k managementu
  a relay forku (TCP 443).
- `lane` (`<vlastník>-lane-<prefix>`, `LANE_VLASTNIK` z profilu `lane_gpu.vlastnik`) je `external`.
  Je ve jmenném prostoru vlastníka uzlu: zakládá ji compose vstupu lane **operátora** (`internal`,
  podsíť a rozsah klientů z deklarace uzlu) a fork ji oslabit nemůže. Chybí-li, operátor nájemce
  nezaregistroval a nasazení selže nahlas.
- `coolify`, `<prefix>-shared-net`, `mesh-dns` ani `ports` tu nejsou.
