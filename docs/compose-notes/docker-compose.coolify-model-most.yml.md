# docker-compose.coolify-model-most.yml — most modelového meshe forku (C4)

> Próza k [docker-compose.coolify-model-most.yml](../../docker-compose.coolify-model-most.yml).
> Compose soubor se posílá na server jako argument příkazové řádky a soupeří
> s ARG_MAX — vysvětlení proto žijí tady.

## Proč tahle aplikace existuje

Model forku, který stojí na GPU uzlu (slot s `has_gpu`), do HLAVNÍHO meshe forku
nepatří: GPU uzel je sdílený a do sítí forku nesmí vidět (varianta C, kontrakt 0c).
Fork s ním mluví vlastním **modelovým meshem** (řídicí rovina `netbird-model`).
Most je JEDINÉ místo, kde se ty dva meshe potkají:

1. V hlavním meshi drží **jméno modelu** (katalog `mesh_most_pro: "model"`) — trasy
   mesh-ingressu i záznam mesh DNS jména modelu míří na peer mostu, takže dispatch
   a Omni volají `SVC_MODEL_URL` / `VLLM_GENERATION_URL` beze změny.
2. Ve druhém jmenném prostoru je **peerem modelového meshe** (skupina `model-most`)
   a `most-proxy` předává požadavky na uzel na GPU slotu.

Směr je jediný: hlavní → modelový. Politika modelového meshe pustí jen `model-most →
model-gpu` na portu modelu, jednosměrně (bootstrap modelového meshe ji ověřuje
zpětným čtením). Uzel na GPU slotu do mostu nezahajuje nic.

## Dva jmenné prostory, mezi nimi jen L7

- **Hlavní mesh** — `netbird-agent` + `model-most-mesh-ingress` (kanonický tvar
  z `docker-compose.coolify-model.yml`, doplňuje `scripts/mesh-conformance-apply.mjs`).
  Ingress rozvádí podle `MODEL_MOST_MESH_INGRESS_ROUTES` z derivace na síťový
  koncový bod `model-mesh-agent` (síť `<prefix>-model-most`, `internal`).
- **Modelový mesh** — `model-mesh-agent` + `most-proxy` v jeho netns.

`ip_forward=0` v netns modelového meshe: mezi `wt0` modelového meshe a sítí mostu
nic nesměruje, předává jen `most-proxy` (HTTP). Hlavní mesh a modelový mesh tak
nikdy nesdílejí trasu ani rozhraní.

## model-mesh-agent

- Tvar agenta tenkého stacku infra (`docker-compose.coolify-model-gpu.yml`):
  `--disable-dns --disable-client-routes --disable-server-routes --block-lan-access`,
  `ip_forward=0`, bez SSH serveru.
- `NB_SETUP_KEY: ${MODEL_MESH_MOST_SETUP_KEY:-}` — **jednorázový** klíč z bootstrapu
  modelového meshe (skupina `model-most`, P7). Po zápisu ho agent nepotřebuje;
  bez konfigurace i klíče stav `PENDING_BOOTSTRAP`.
- `NB_HOSTNAME: ${MODEL_MESH_MOST_PEER}` — odvozuje topologie (`<prefix>-model-most`);
  bootstrap pustí do skupiny mostu PRÁVĚ JEDEN peer s tímto jménem a připne jeho id.
- `extra_hosts` mapuje veřejné jméno řídicí roviny (`NETBIRD_MODEL_DOMAIN`) na
  `MODEL_MESH_VSTUP_ADDR` — uzel edge (slot s `has_traefik`, `PUBLIC_EDGE_HOST_ADDR`
  z discovery; jednouzlová instalace = `host-gateway`). Management, Signal i Relay
  modelového meshe jsou inzerované pod tím jménem na TCP 443 (D2); bez mapy by agent
  šel přes veřejnou adresu routeru a spoléhal na hairpin NAT.
- Zdraví: `netbird status --check ready`; ve stavu `PENDING_BOOTSTRAP` zdravý,
  aby Coolify nerestartoval kontejner, který na klíč teprve čeká.
- Na síti mostu nese alias `<prefix>-model-most--model-mesh` — na něj míří trasa
  ingressu hlavního meshe (`container_name` Coolify přepisuje, trasa smí mířit jen
  na alias; brána cil-mesh-trasy-ma-alias-s-identitou).

## Proč klíče modelového meshe nejsou `:?`

`MODEL_MESH_MANAGEMENT_URL`, `MODEL_MESH_MOST_PEER`, `MODEL_MESH_PORT` a
`NETBIRD_MODEL_DOMAIN` vydává derivace JEN s lane `MODEL_MESH` (model na slotu
s GPU). Brány zapisovatelů měří doktora v základním tvaru instance, kde lane
zavřená — `:?` by tam neměl plniče (týž precedens jako `netbird-model`). Zapisuje
je heredoc cold-startu (`:-`) a na cestě redeploye heal pass env-doktora (klíče
topologie). Prázdná hodnota se nespolkne: entrypoint agenta modelového meshe
i most-proxy skončí nahlas, prázdné jméno v `extra_hosts` shodí už compose.

## most-proxy

- `network_mode: service:model-mesh-agent`: proxy vidí `wt0` modelového meshe i síť
  mostu. Na síti mostu ji zastupuje jméno agenta (`internal_url.service` v katalogu).
- `:${MODEL_MESH_PORT}` (port modelu) → `http://${MODEL_MESH_GPU_PEER_IP}:${MODEL_MESH_PORT}`
  (tenký klient na uzlu, `wt0`). IP uzlu zapisuje bootstrap modelového meshe spolu
  s připnutím id peeru — DNS modelového meshe most nepoužívá (`--disable-dns`).
- `flush_interval -1` (proudové odpovědi chatu), `dial_timeout 3s` (R5a).
- Uzel nedostupný → `handle_errors` vrátí 503 `{"duvod":"LANE_NEDOSTUPNA", …}`
  s `x-aisha-odmitl: most` — kód ze slovníku `@aisha/accel-protokol`, žádný návrat
  na jiný cíl ani CPU model (MM8). IP nedoručena → týž kód hned, nahlas v logu.
  Vadná IP nebo port → kontejner spadne (doručení je vada, ne stav).
- Spojení z rozsahu meshe (`100.64.0.0/10`, tedy z `wt0` modelového meshe) → `abort`:
  do mostu se z modelového meshe nesmí, i kdyby politika selhala.
- Přijímá JEN ze sítě mostu (a `127.0.0.1` kvůli zdraví): síť se zjistí při startu jako
  jediná síť netns, která není `lo`, `wt*` ani síť výchozí trasy (`ven`); cokoli jiného
  (hostitel, `ven`) → `abort`. Nejde-li síť mostu určit jednoznačně, kontejner spadne.
- IP uzlu musí ležet v rozsahu modelového meshe (`100.64.0.0/10`, výchozí rozsah NetBirdu;
  vlastní rozsah modelový mesh nedeklaruje) — jinak kontejner spadne. Most tak nejde
  nasměrovat mimo modelový mesh ani vadným doručením.
- `Authorization` jen propouští — klíč lane drží dispatch forku (K1).
- `cap_drop: ALL`, `no-new-privileges`.

## Sítě

- `ven` (`<prefix>-model-most-ven`) — odchozí cesta agenta k řídicí rovině (TCP 443).
- `most` (`<prefix>-model-most`, `internal`) — jediná cesta mezi hlavním meshem
  (ingress) a most-proxy.
- `coolify`, `<prefix>-shared-net` ani `mesh-dns` agent modelového meshe nemá.
