# Modely na sdíleném GPU uzlu — co udělá fork

Návod pro instanci (fork), která chce používat modely na sdíleném GPU uzlu místo
modelu na vlastním CPU. Platí pro varianta C: uzel provozuje operátor, fork na něm
má vlastní izolovaný tenký stack a do modelu se dostane jen přes svůj modelový mesh.

## Jak to drží pohromadě

- **Uzel provozuje operátor.** Společnou lane (vstup nájemců a enginy) nasazuje a hlídá
  operátor uzlu. Fork na uzel nasazuje jen svůj tenký stack
  (`docker-compose.coolify-model-gpu.yml`, katalog `model.compose_gpu`).
- **Modelový mesh forku.** Řídicí rovina `netbird-model` běží u forku; uzel se do ní
  zapisuje přes veřejný vstup forku (edge, TCP 443), do hlavního meshe nepatří.
- **Most.** Služba `model-most` drží v hlavním meshi jméno modelu (`mesh_most_pro: "model"`),
  takže konzumenti (`SVC_MODEL_URL`, `VLLM_GENERATION_URL`) zůstávají beze změny.
- **Nikdy přímo.** Model volá jen dispatch forku nad `@aisha/accel-protokol`: povinná třída
  požadavku (`dotaz` | `davka`), klíč nájemce, typované odmítnutí, identita vah v odpovědi.
  Když lane nejede, přijde `503 LANE_NEDOSTUPNA` — žádná tichá náhrada jiným modelem.

## Předpoklady

1. Upstream s dávkami: protokol lane (`packages/accel-protokol`), podmínky a firewall GPU
   slotu (krok 0 doktora), modelový mesh a most, dispatch forku, jádro lane a výběr compose
   podle slotu.
2. Operátor přijal **deklaraci nájemce**: alias modelu (jméno, pod kterým fork model zná),
   identitu vah, hranici tokenů, rozpočet VRAM a kvóty. Nájemce začíná `vypnuto`, dokud
   nejsou kvóty změřené. Operátor sdělí **vstup lane nájemce** — privátní `IP:port` na síti
   `<prefix>-lane`.
3. GPU uzel je v Coolify forku jako server.
4. Veřejná adresa GPU uzlu je v **povolených sítích** instance (administrace; zapisuje
   vlastník instance, ne nasazení).

## 1. Profil instance

```json
{
  "server_bindings": { "gpu": "<jméno GPU uzlu v Coolify forku>" },
  "service_overrides": { "model": { "placement": "gpu" } },
  "lane_gpu": { "vstup_url": "http://<privátní IP vstupu lane>:<port>" }
}
```

- Slot `gpu` (`has_gpu: true` v `coolify/servers.json`) se nehádá — chce výslovnou vazbu.
- **Umístění je samo deklarací modelového meshe.** Derivace z něj vydá `MODEL_MESH=<slot>`,
  `NETBIRD_MODEL_DNS_DOMAIN`, `MODEL_MESH_MANAGEMENT_URL`, jména peerů
  (`MODEL_MESH_GPU_PEER`, `MODEL_MESH_MOST_PEER`), `MODEL_MESH_PORT` a `LANE_VSTUP_URL`;
  cold-start nasadí `netbird-model`, `model-most` a na slot `gpu` tenký stack. Nic z toho
  se nepíše ručně do env.
- Derivace selže nahlas, když profil vyřadí `netbird-model` nebo `model-most`, když chybí
  nebo není privátní `lane_gpu.vstup_url`, nebo když chybí identita instance
  (`APP_NAME_PREFIX`). Na slotu `gpu` smí model nasazovat jen tenký compose — jinak krok 0
  doktora zastaví.
- **Manifest instance** vydá generátor (`node scripts/gen-instance-manifest.mjs`) z profilu
  (`AISHA_PROFILE`): pro model řádek `app: model:gpu:docker-compose.coolify-model-gpu.yml`
  (na slotu `has_gpu` varianta `compose_gpu`). Nasazení bere slot a compose z řádku manifestu
  a kontrola umístění (`umisteni-souhlasi.sh`) ho srovná s profilem — ručně se nepíše.
- **Aplikace modelu už stojí na CPU slotu:** kontrola přesunu (U3) cold-start zastaví. Přesun
  je vědomý krok `--rewarmup=<prefix>-model` (starou aplikaci smaže i se svazky a založí ji na
  slotu `gpu`); model v deklaraci držení (`nasazeni-drzene.json`) se nepřesouvá ani nenasazuje.

## 2. Tajemství a klíče

- `NETBIRD_MODEL_*` vytvoří generátor tajemství, `VLLM_API_KEY` env-doctor (32 B; jednou
  zapsaný se nepřepisuje, rotace = vědomý krok).
- `MODEL_MESH_MOST_SETUP_KEY` a `MODEL_MESH_GPU_PEER_IP` zapisuje `scripts/netbird-bootstrap.sh`
  (`NETBIRD_INSTANCE=model`) — nikdy ručně.
- `MODEL_MESH_SETUP_KEY` = klíč, kterým se GPU uzel zapíše do modelového meshe forku
  (tenký stack: `NB_SETUP_KEY`). Vydává ho týž bootstrap: **jednorázový** (`one-off`,
  `usage_limit: 1`, jen skupina uzlu, ověřeno zpětným čtením). Dokud peer uzlu v meshi
  není, vydá každý běh bootstrapu nový a předchozí odvolá — platí jen poslední. Jakmile se
  uzel zapíše, zbylé platné klíče skupiny bootstrap odvolá. Klíč se nikdy neposílá zprávou;
  do tenkého stacku ho předá vlastník instance.
- Operátorovi jde **jen otisk** klíče, nikdy klíč:
  `printf %s "$VLLM_API_KEY" | sha256sum`.

## 3. Data instance — identita embedderu

Vektory prostoru v1 jsou „živé“, jen když je spočítal týž soubor vah, kterým se kódují dotazy.
Platforma váhy nevidí, identitu proto deklarují data instance v
`ai_model_registry.provider_metadata.declared` u embedding modelu (discovery jmenný prostor
`declared` zachovává):

```sql
update public.ai_model_registry
   set provider_metadata = jsonb_set(
         coalesce(provider_metadata, '{}'::jsonb), '{declared}',
         coalesce(provider_metadata->'declared', '{}'::jsonb) || jsonb_build_object(
           'weights_format', '<formát souboru vah: pytorch | safetensors | gguf …>',
           'weights_sha256', '<sha256 souboru vah od operátora>',
           'weights_url',    '<URL souboru na pevné revizi>',
           'max_tokens',     <hranice obsahu bez speciálních tokenů>))
 where provider = 'vllm' and model_id = '<alias embedderu>';
```

- Živá identita = `<weights_format>:<weights_sha256>` (`public.fn_ziva_identita_v1()`), jediný
  domov pro dopočet i měření pokrytí. **Nic se nedosazuje:** bez formátu dopočet i měření
  selžou s návodem (`22023`).
- Hodnoty dodává operátor z měření uzlu (sha256 skutečného souboru, ne jména).
- Kóduje-li vektory i ingest engine instance, smí jen pod **toutéž** identitou — jinak by jeho
  vektory dopočet přepisoval dokola. Doporučení: kódování v enginu vypnout a korpus nechat
  spočítat server.

## Pojmenované riziko (varianta C, rozhodnutí O-2 (a))

Fork, který má GPU uzel jako **server ve vlastním Coolify**, tam má Docker, tedy **root**.
Přečte proto i svazky ostatních nájemců uzlu — mimo jiné `model-mesh-data` s **soukromým
klíčem WireGuard** jejich agenta modelového meshe — a mohl by se vydávat za jejich uzel.
Izolace nájemců na uzlu (sítě `--internal`, vstup lane, klíč nájemce) proti rootovi na
hostiteli nechrání. Dnes jsou všichni nájemci uzlu instance téhož operátora; přijetí
dalšího nájemce s vlastním Coolify serverem na uzlu je rozhodnutí operátora (rada/majitel),
ne konfigurace. Bez Coolify serveru na uzlu (tenký stack nasazuje operátor) riziko odpadá.

## 4. Nasazení a ověření

1. Cold-start / redeploy instance.
2. Doktor fáze N: `node scripts/modelovy-mesh-doktor.mjs` → rc 0 (uzel i most připojené
   a připnuté, most míří na IP uzlu, jediná politika meshe).
3. Provider `vllm-local` zapne **migrace sama** (`scripts/deploy/reconcile-local-model-provider.sql`
   z `VLLM_GENERATION_URL`). Ověřit `is_enabled = true` a endpoint = jméno modelu v meshi;
   ručně v administraci nezapínat.
4. Discovery uvidí model v `/v1/models` lane (alias z deklarace nájemce) → `is_available`.
5. Dotaz: embedding přes `svc-mcp-knowledge` (třída `dotaz`) — hlavička `x-aisha-identita`
   odpovědi = deklarace.
6. Přepočet: `POST /embeddings/v1-backfill` (třída `davka`) přepíše vektory na místě,
   `model_version = <identita>;recipe=chunk_text_v1`; postup ukazuje měření pokrytí
   (`audience_broker_sync_state.metadata.pokryti_vektoru`). Jedno volání bere dávky ve smyčce,
   dokud fronta nevyschne nebo nevyprší `max_ms`; zastaví ho kvóta lane (`konec: kvota`),
   ústup při souběhu s dotazy, změna identity během běhu a dávka bez postupu (`bez_postupu`).
   Starý vektor se předem nemaže — přepíše se až vektorem ověřené identity.
7. Hledání (`search_knowledge_v2` → `mcp_search_knowledge_v3`) srovnává dotaz JEN s vektory,
   jejichž identita vah (`model_version` před středníkem) = deklarace modelu. Po změně deklarace
   proto hledání vrací jen už přepočítanou část korpusu (generace se nemíchají), dokud přepočet
   nedoběhne. Ask extranetu hledá ve znalostech, deklaruje-li kanál `ai-chat`
   `vector_store_config.knowledge_search.enabled: true` (data instance).

## Chování při chybách

| Situace | Co se stane |
|---|---|
| Lane nejede / uzel nedostupný | most vrátí `503 LANE_NEDOSTUPNA` (`x-aisha-odmitl: most`), žádná náhrada |
| Identita v odpovědi ≠ deklarace | dávka dopočtu končí (`identita_nesouhlasi`), nic se nezapíše |
| Vstup nad hranici tokenů | engine ho odmítne → úsek se zapíše jako `nad_limitem`, fronta jede dál |
| Deklarace bez formátu nebo sha | dopočet `502` s návodem, měření pokrytí NEZMĚŘENO (ne nuly) |
| Chybí klíč nájemce | lane `401 KLIC_CHYBI`; dispatch nespustí volání bez klíče |
| Hledání: embedding nejde (resolver, lane, kvóta) | nástroj `isError` `embedding_unavailable` (důvod, kód lane, `incident`); žádná textová náhrada; Ask ukáže „vyhledávání nedostupné“ (`/chat` 503 `KNOWLEDGE_SEARCH_UNAVAILABLE`). Text chyby jen v logu služby pod `incident` |
| Hledání: model bez deklarace vah | `embedding_identity_undeclared` (22023, jednotná zpráva bez hodnot) — výjimka, ne prázdný výsledek |
| Hledání: lane ohlásí k dotazu jinou identitu než deklarace | služba hledání nespustí: `embedding_unavailable`, důvod `identita_nesouhlasi` (kontrola na služební rovině; v3 identitu od volajícího nebere) |

## Související

- `docs/compose-notes/docker-compose.coolify-model-gpu.yml.md` — tenký stack na GPU slotu.
- `docs/compose-notes/docker-compose.coolify-model-most.yml.md` — most modelového meshe.
- `packages/accel-protokol` — důvody odmítnutí, hlavičky, třídy požadavků.
