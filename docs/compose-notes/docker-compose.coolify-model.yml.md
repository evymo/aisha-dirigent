# docker-compose.coolify-model.yml — notes

Prose extracted from `docker-compose.coolify-model.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `services:`

==============================================================================
Coolify story: aisha-model (Experimental — lokální model serving, OpenAI-kompat)
==============================================================================
svc-model = llama.cpp server (CPU) s až třemi lane v jednom procesu:
  chat   → base GGUF (URL + sha pin) + volitelný LoRA adaptér z instance-data bundle
           (alias MODEL_ALIAS; discovery přes /v1/models v svc-ai-chat registry)
  embed  → embedding GGUF pro RAG prostor v1 (alias EMBED_ALIAS; /v1/embeddings)
  embed2 → volitelný embedding GGUF pro RAG prostor v2 (alias EMBED2_ALIAS)

Image NEVÍ, který model to je. Platforma nabízí MÍSTO pro kandidáty; které váhy
tam instance dá, deklaruje instance, a KTERÝ model co dělá, rozhoduje AISHA.

Aisha (svc-ai-chat /v1 = Omni face za core gateway) tenhle backend RESOLVUJE
(env VLLM_GENERATION_URL / ai_provider_registry `vllm-local`) a vystavuje ho dál
jako součást svého stacku — konzumenti mluví s Aishou, nikdy s llama.cpp přímo.
Proto ŽÁDNÝ public face (in-cluster only).

------------------------------------------------------------------------------
Jak instance deklaruje kandidáty
------------------------------------------------------------------------------
Všechno je INSTANČNÍ env (.env-prod-backup / vault instance), nikdy repo platformy:

  CHAT_GGUF_URL / CHAT_GGUF_SHA256     — chat kandidát. CHAT_GGUF_URL je zároveň
                                         podmínka existence služby
                                         (config/services.json →
                                         model.provision_when_env). Bez něj se
                                         služba nezaloží, resolver nevydá
                                         VLLM_GENERATION_URL a provider vllm-local
                                         zůstane VYPNUTÝ (migrate to zaloguje).
  EMBED_GGUF_URL / EMBED_GGUF_SHA256   — embedding kandidát (volitelný).
  EMBED2_GGUF_URL / EMBED2_GGUF_SHA256 — druhý embedding kandidát (volitelný).
  MODEL_ALIAS / EMBED_ALIAS / EMBED2_ALIAS — jména, pod kterými modely uvidí stack.
                                         POVINNÁ deklarace zapnuté lane, platforma
                                         žádné jméno nedosazuje (dřív compose
                                         dosazoval default-lens / bge-m3-embedding /
                                         qwen3-embedding-4b — dvě z nich jmenovala
                                         model, který instance mít nemusí).
                                         Kontrakt ověří entrypoint PŘED stažením
                                         vah (scripts/deploy/svc-model-aliasy.sh):
                                           · chat alias začíná prefixem lokálního
                                             backendu local- / vllm- (canServe
                                             createVLLMBackend; bez něj ho cesty bez
                                             řádku registru přemapují na jiný model)
                                             a NEnese značku ne-chat modelu,
                                           · embedding alias obsahuje „embedding"
                                             (modelDiscovery odvozuje is_embedding
                                             z id; bez něj se zaregistruje jako chat),
                                           · aliasy zapnutých lan jsou navzájem různé.
                                         Proč deklarace a ne odvození z názvu GGUF:
                                         viz hlavička svc-model-aliasy.sh.
  MODEL_CPUS / MODEL_MEM               — rozpočet kontejneru (deklarace instance).
  MODEL_N_THREADS                      — VOLITELNÉ; prázdné = odvodí se z CPU kvóty.
  INGEST_BUNDLE_GIT_URL / _PATH / _REF — LoRA adaptér (bez něj jede holý base).

Fail-closed: požadovaná lane bez sha pinu nebo se sha nesouhlasem nenastartuje.

------------------------------------------------------------------------------
Omezení, se kterými musí kandidát počítat
------------------------------------------------------------------------------
  · RAM: kontejner má `mem_limit: ${MODEL_MEM}` (dnešní deklarace 8 GB) a VŠECHNY
    lane běží v JEDNOM procesu. Součet (váhy GGUF + KV cache n_ctx × vrstvy + režie
    llama.cpp) pro chat + embed (+ embed2) se musí vejít do limitu, jinak OOM kill.
    Kolik chat kandidátů se vejde, platforma neurčuje — rozhoduje vlastník instance
    podle skutečné spotřeby (NEMĚŘENO níž); jeden proces = jeden sdílený limit.
  · Embedding pro prostor v1 musí mít NATIVNĚ 1024 rozměrů a zvládat češtinu
    (sloupce knowledge_embeddings.embedding, expert_rules.content_embedding,
    agent_memories.embedding jsou vector(1024)); prostor v2 = 2560 (halfvec).
    Rozměr se NEdeklaruje — discovery ho změří (/v1/embeddings) a resolver prostoru
    (fn_resolve_embedding_model_for_space) model jiného rozměru pro danou dráhu nevybere.
  · Pouze OSS váhy ve formátu GGUF (llama.cpp); licence vah je odpovědnost instance.
  · URL vah musí být dosažitelná ZEVNITŘ kontejneru (egress z experimental uzlu),
    ne jen z operátorova stroje. Stahuje se jednou do volume `model-weights`.
  · CPU-only (x86-64-v3: AVX2/FMA/F16C). Image je přeložený s těmito instrukcemi
    výslovně a build ověří, že je knihovna opravdu má; CPU bez AVX2 image nespustí.

------------------------------------------------------------------------------
Jak AISHA vybírá (nic z toho se nekonfiguruje ručně)
------------------------------------------------------------------------------
  1. migrate: provider `vllm-local` = odvozená VLLM_GENERATION_URL
     (scripts/deploy/reconcile-local-model-provider.sql). Adresa je → povolen;
     není → vypnutý. Změna adresy → modely providera nedostupné do discovery.
  2. discovery (svc-ai-chat, při startu, na vyžádání a periodicky): přečte ÚPLNÝ
     /v1/models, zaregistruje modely, co v listingu není, vede jako nedostupné;
     u embedding modelů změří rozměr. svc-model se nasazuje až po ai-chat, proto
     cold-start (krok 6b, čeká na embedding model) discovery VYŽÁDÁ sám
     (POST /functions/v1/discover-models se servisním tokenem, selfTest:false)
     místo čekání na periodu; perioda zůstává pro nasazení jinými kanály
     (redeploy svc-model) a návrat po výpadku.
  3. self-test: krátký chat smoke u PROVIDERA, ze kterého model pochází (ne podle
     id) → pending → tested / rejected.
  4. benchmark (/admin/benchmark): sada úloh chat / classification / reasoning /
     extraction v češtině i angličtině → ai_model_benchmarks.
  5. resolver: aisha_resolve_clow_backend (chat) a fn_resolve_embedding_model_for_space
     (embedding pro prostor) volí podle dostupnosti, zdraví, capability a skóre.
     RAG srovnání embedding modelů: /rag/eval/run nad golden setem z platformního
     obsahu (cs + en) → fn_compare_rag_embedding_models.

------------------------------------------------------------------------------
NEMĚŘENO (tady to spustit nešlo) — ověřit na cílovém stroji
------------------------------------------------------------------------------
  · Doba jednoho embeddingu a tokeny/s chatu PŘED a PO změně buildu (explicitní
    AVX2/FMA) a vláken (n_threads_batch z kvóty místo CPU hostitele). Starý komentář
    v entrypointu uvádí > 80 s na embedding; nejpravděpodobnější příčina je
    n_threads_batch = počet CPU hostitele při `cpus: 2.0` (throttling), ne model.
    Měřit: `docker logs <prefix>-svc-model` (řádek „threads: N", výpis system_info
    z buildu) a čas `POST /v1/embeddings` s krátkým textem.
  · Že llama-cpp-python 0.3.16 existuje na PyPI a jeho system_info hlásí „AVX2 = 1"
    — build to ověří sám a při neshodě spadne.

## `context: .`

Repo-root context (Coolify ARG_MAX pattern) — root Dockerfile.svc-model.

## `- CHAT_GGUF_URL=${CHAT_GGUF_URL}`

chat lane — base pin (fail-closed: bez pinu/sha nesouhlasu kontejner nenastartuje).
Zároveň podmínka provisioningu celé služby (services.json provision_when_env).

## `- EMBED_GGUF_URL=${EMBED_GGUF_URL:-}`

embed lane — pin; zapnutá lane vyžaduje EMBED_ALIAS s markerem „embedding"
(capability derivace v discovery) — ověřuje entrypoint, compose nic nedosazuje

## `- EMBED2_GGUF_URL=${EMBED2_GGUF_URL:-}`

volitelná druhá embed lane — platformní RAG prostor v2 (2560)

## `- BUNDLE_GIT_URL=${INGEST_BUNDLE_GIT_URL:-}`

LoRA adaptér z instance-data bundle (integrita = git commit; viz
local-ingest docs/ADVISORY_CPU.md §3). Reuse ingest kontraktu.

## `- MODEL_ALIAS=${MODEL_ALIAS:-}`

aliasy = jména, pod kterými modely uvidí zbytek stacku (/v1/models). Compose
žádné jméno nedosazuje; prázdné = nedeklarováno a entrypoint (svc-model-aliasy.sh)
takovou zapnutou lane odmítne PŘED stažením vah. Chat alias není `:?`, přestože
chat lane je podmínkou existence služby: je to hodnota operátora (třída
„external" jako CHAT_GGUF_URL — doktor ji přenese z .env-prod-backup, odvodit
ji nelze), a `:?` na takovém klíči brána deklarace-v-compose-ma-zapisovatele
správně hlásí jako klíč bez plniče na cestě redeploye.
Doručení: scripts/aisha-env-doctor.mjs CONTRACT (external) + heredoc cold-startu.

## `- MODEL_N_THREADS=${MODEL_N_THREADS:-}`

Prázdné = odvodí se z CPU kvóty kontejneru (scripts/deploy/svc-model-threads.sh:
cgroup v2 cpu.max / v1 cfs, dolů zaokrouhleno, bez limitu nproc). Nastavuje se
n_threads I n_threads_batch — bez n_threads_batch bere llama_cpp.server
multiprocessing.cpu_count() = CPU HOSTITELE a na kvótě 2 CPU běží 8 vláken.
Výslovná hodnota musí být kladné celé číslo, jinak kontejner nenastartuje.

## `- model-weights:/models`

GGUF váhy (seed jednou, restart je nechá být) + adaptér (refresh při startu)

## `cpus: ${MODEL_CPUS:-2.0}`

Sdílený server: konzervativní stropy. Počet vláken llama.cpp se z téhle kvóty
odvozuje (viz MODEL_N_THREADS), takže změna MODEL_CPUS se do vláken propíše sama.

## `test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:8000/v1/models || exit 1"]`

127.0.0.1, NOT localhost (IPv6-first resolve trap). start_period 300s: entrypoint
PŘED startem serveru stahuje GGUF váhy (jen při prvním startu).

## `internal:`

Both alias the external coolify network (per-stack bridges se nevyrábí);
alias svc-model resolvuje pro same-stack i cross-stack konzumenty (ai-chat,
mcp-knowledge přes core gateway síť).

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
