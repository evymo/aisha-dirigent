# docker-compose.coolify-accel-embed-1.yml — embedder 1 společné lane (operátor GPU uzlu)

> Prose k [docker-compose.coolify-accel-embed-1.yml](../../docker-compose.coolify-accel-embed-1.yml).
> Compose soubor se posílá na server jako argument příkazové řádky a soupeří
> s ARG_MAX — vysvětlení proto žijí tady.

## Proč tahle aplikace existuje

Embedder fáze 1 společné lane. Každý engine je samostatná aplikace Coolify (návrh lane, rozhodnutí 6):
restart v Coolify nasazuje znovu celý stack, takže změna modelu jednoho enginu nesmí restartovat jiný.
Engine nevidí žádný nájemce. Na sítích `<vlastník>-lane-<nájemce>` visí jen vstup lane (`svc-accel-vstup`),
engine je jen na `<vlastník>-accel-jadro` (`internal`, zakládá ji compose `accel-vstup`, vlna 1; engine
je ve vlně 2). Na GPU slotu nasazuje Coolify raw: síť aplikace ani `env_file` engine nedostane.

## Váhy (accel-vahy je v compose vstupu lane)

Jednorázové stažení a změření vah běží v operátorském compose vstupu lane (`<vlastník>-accel-vahy`,
projekt hlídače), protože zapisuje do svazku operátora `<vlastník>-accel-vahy`. Engine svazek jen čte
(`external`) a bez změřené identity nenastartuje. Popis kroku:


- Stáhne PŘIPNUTOU revizi (repo + 40hex revize z `ACCEL_VAHY_B64`, tytéž hodnoty jako `ACCEL_EMBED_1_*`) do NEMĚNNÉHO adresáře
  `/vahy/<repo s -- místo />@<revize>`. Stahuje se do `.tmp-…` a teprve po změření se přejmenuje,
  takže engine nikdy neuvidí půlku.
- Změří sha256 deklarovaného souboru vah a porovná ho s deklarací uzlu. Neshoda = konec s chybou. Warmup pak
  enginy nepustí a engine by sám nenastartoval (před startem váhy přeměřuje).
- Zapíše `aisha-identita.json` `{format, sha256, revize}`. Odtud ji vstup lane čte do hlavičky
  `x-aisha-identita` (EM2) z adresáře, který engine sám hlásí jako `root` modelu. Identita se tedy
  nebere z deklarace ani z hlášení enginu.
- `FORMAT_VAH=pytorch` se odmítne, když revize nese i safetensors: vLLM by nahrál jiný artefakt, než
  deklarace jmenuje (pojistka z A2-3).
- Už existující adresář jen přeměří. Neodpovídá-li deklaraci, NEPŘEPISUJE ho, protože neměnný adresář
  se nemění. Nová revize = nový adresář.
- Jediná služba enginu se sítí ven: `<vlastník>-accel-ven` (odchozí na Hugging Face). `read_only`,
  `cap_drop: ALL`, cache HF jen v `tmpfs`.
- Změřeno na uzlu 2026-10-05 pro bge-m3 @5617a9f6: soubor `pytorch_model.bin`, sha256
  `b5e0ce34…6aad38`. Revize safetensors nenese.

## accel-embed-1 (vLLM, pooling)

- Před každým startem engine váhy PŘEMĚŘÍ: `aisha-identita.json` se musí rovnat deklaraci uzlu, sha256
  souboru vah se spočítá znovu a u `FORMAT_VAH=pytorch` nesmí v adresáři být safetensors. Engine tak nevěří
  jen tomu, že accel-vahy jednou proběhl: platí i pro restart kontejneru a samostatné `compose up` enginu.
  bge-m3 (2,2 GB) se přeměří za pár sekund.
- `vllm serve /vahy/…@<revize>` OFFLINE (`HF_HUB_OFFLINE=1`, svazek vah jen pro čtení, síť jen jádro).
- `--runner pooling --dtype float16 --no-enable-prefix-caching`. Cache prefixů je u embedderu vypnutá
  (změřený únik mezi nájemci bez soli, 10-05). float16 je připnutý, ne `auto`, protože dtype je součást
  receptu (změřeno: `dtype=torch.float16`, pooler CLS, normalizace zapnutá).
- `--max-model-len` (`ACCEL_EMBED_1_MAX_MODEL_LEN`) počítá VČETNĚ speciálních tokenů. U bge-m3:
  8192 = 8190 tokenů obsahu, delší vstup = HTTP 400 (změřeno 10-05). Zahřátí vstupu lane se odměřuje
  přes `/tokenize` enginu.
- `--gpu-memory-utilization` = `ACCEL_EMBED_1_PODIL_GPU` z deklarace uzlu (VRAM enginu / kapacita karty).
  Změřeno pro bge-m3: 2 586 MiB procesu, start do /health 102 s.
- `VLLM_API_KEY` = `ACCEL_JADRO_API_KEY` (tajemství vrstvy, vyrábí env-doktor, zachovává cold-start),
  interní klíč operátora mezi vstupem lane a enginy (ochrana do hloubky). Nájemci ho nikdy nedostanou.
- GPU přes CDI (`devices: nvidia.com/gpu=all`), změřené s `docker run`. První nasazení přes Coolify musí
  ukázat zařízení v `docker inspect` (riziko z návrhu §5).
- Alias `<vlastník>-accel-embed-1` na síti jádra = `container_name` (raw ho nepřepisuje). Adresa enginu
  v deklaraci VB (`enginy.embed-1.url`) míří na něj a hlídač ji porovnává se jménem kontejneru.
- Hlídač GPU z A2-3 tu není. Engine s podílem paměti nad volnou VRAM ve vLLM sám spadne při startu,
  nahlas. Hlídač se vrátí s druhým enginem, až se enginy budou startovat postupně.

## Proměnné

Klíče z deklarace uzlu (odvozuje je `derive-accel-uzel.mjs`) a tajemství jádra jsou HOLÉ `${X}` a vede je
`x-aisha-povinne-za-behu`: `ACCEL_OWNER_PREFIX`,
`ACCEL_EMBED_1_{REPO,REVIZE,SOUBOR_VAH,FORMAT_VAH,SHA256,PODIL_GPU,MAX_MODEL_LEN}`, `ACCEL_JADRO_API_KEY`.
Prázdné odmítne i skript služby (FATAL / NEDEKLAROVÁNO). `:?` nese jen `IMAGE_VLLM` (pin digestem).
Lane slotu otevírá `ACCEL_EMBED_1_REPO` (deklarace bez enginu `embed-1` = aplikace se nezakládá).
Svazek vah `<vlastník>-accel-vahy` je `external` a jen pro čtení: zakládá ho compose `accel-vstup`
(krok 0 ho proto uzná za změřený jen s compose z katalogu a jen `:ro`). Raw režim jeho jméno zachová,
takže váhy přežijí přesun vrstvy beze změny jména.
