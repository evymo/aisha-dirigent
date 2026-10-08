# docker-compose.coolify-accel-chat-1.yml — chatový engine společné lane (operátor GPU uzlu)

> Prose k [docker-compose.coolify-accel-chat-1.yml](../../docker-compose.coolify-accel-chat-1.yml).
> Compose soubor se posílá na server jako argument příkazové řádky a soupeří
> s ARG_MAX — vysvětlení proto žijí tady.

## Proč tahle aplikace existuje

Chatový slot lane: vLLM `generate` nad základním modelem a **LoRA adaptéry nájemců** (lens forku).
Engine je jen na `<vlastník>-accel-jadro` (`internal`, zakládá ji compose `accel-vstup`, vlna 1;
chat je ve vlně 2). Nájemce ho nevidí: volá vstup lane (`POST /v1/chat/completions`), a ten dosadí
model (`<nájemce>.<adaptér>` nebo základ `chat-1`), sůl cache nájemce (`cache_salt`) a strop
`max_tokens` aliasu. Na GPU slotu nasazuje Coolify raw (síť aplikace ani `env_file` engine nedostane).

## Váhy a adaptéry

- Základ: `/vahy/<repo>@<revize>` (stáhne a změří `accel-vahy`). Chatový model má `soubor_vah:
  "@vse"` = identita CELÉHO adresáře revize (sha256 seřazeného seznamu `relativní/cesta:sha256` všech
  souborů: rozdělené váhy, config.json, tokenizér i šablona chatu; mimo aisha-identita.json a .cache).
  vLLM z adresáře čte všechno, proto se měří všechno. Entry point ji před startem přeměří stejně
  jako `accel-vahy`.
- Adaptéry nájemců (`najemci.<id>.adaptery`; zapsání = potvrzení člověkem, registr adaptérů) se načítají
  ZA BĚHU (rozhodnutí Hackathonu 2026-10-07, varianta 2) a načítá je VÝHRADNĚ vstup lane
  (`svc-accel-vstup/src/adaptery.ts`): jen z deklarovaného adresáře `/vahy/<repo>@<revize>` (svazek
  RO, stáhl a změřil accel-vahy), a jen když identita CELÉHO adresáře (`@vse`: adapter_model.safetensors
  i adapter_config.json), kterou vstup sám přeměří, sedí s deklarací i se souborem identity.
  Nesoulad = nenačíst (a uvolnit, pokud běží); adaptér mimo deklaraci = uvolnit + varování; po
  restartu enginu se tentýž seznam načte znovu. Nájemce alias s adaptérem volá, až když je ověřený
  a načtený (do té doby `LANE_STARTUJE`).
- Engine má `VLLM_ALLOW_RUNTIME_LORA_UPDATING=True`: `/v1/load_lora_adapter` a `/v1/unload_lora_adapter`
  jsou jen na síti jádra pod klíčem jádra (`VLLM_API_KEY`), který má jen vstup lane. Nájemci obě cesty
  dostanou `CESTA_NEZNAMA`. Zbytkové riziko: klíč jádra sdílí i ostatní enginy na jádře.

## Paměť a start

- `--gpu-memory-utilization` = `ACCEL_CHAT_1_PODIL_GPU` z deklarace (VRAM enginu / kapacita karty);
  součet VRAM všech enginů + rezerva ≤ kapacita hlídá deklarace (VT3).
- `--enable-prefix-caching`: cache prefixů je oddělená solí nájemce (`cache_salt`, dosazuje vstup;
  klientovi patří POLE_PLATFORMY). Engine je dnes na nájemce (O-4), sůl drží oddělení i pro
  případný sdílený engine (rozhodnutí majitele).
- `start_period` 900 s: váhy desítek GB a CUDA grafy. Do připravenosti vstup vrací `LANE_STARTUJE`.

## Proměnné

Klíče z deklarace (odvozuje `derive-accel-uzel.mjs`) a tajemství jádra jsou HOLÉ `${X}`
a vede je `x-aisha-povinne-za-behu`: `ACCEL_OWNER_PREFIX`,
`ACCEL_CHAT_1_{REPO,REVIZE,SOUBOR_VAH,FORMAT_VAH,SHA256,PODIL_GPU,MAX_MODEL_LEN,MAX_LORAS,MAX_LORA_RANK}`,
`ACCEL_JADRO_API_KEY` (`VLLM_API_KEY`). Adaptéry v env nejsou (načítá je vstup z deklarace).
`:?` nese jen `IMAGE_VLLM`. Lane slotu otevírá `ACCEL_CHAT_1_REPO`.
