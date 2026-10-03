#!/bin/sh
# svc-model entrypoint — OpenAI-kompat serving lokálních modelů (llama.cpp, CPU).
#
# Dvě lane v jednom procesu (llama_cpp.server --config_file, routing podle model/alias):
#   1) CHAT: base GGUF + volitelný LoRA adaptér z instance-data bundle (git commit = integrita
#      adaptéru; base váhy = sha256 pin v env). Alias MODEL_ALIAS — pod tímhle jménem model
#      uvidí Aisha (/v1/models discovery v svc-ai-chat backend registry).
#   2) EMBED: embedding GGUF pro RAG vektory (svc-mcp-knowledge embed-dispatcher,
#      OpenAI-compatible /v1/embeddings). Alias EMBED_ALIAS = model_id korpusu/indexu.
#      KTERÝ model to je, deklaruje instance (EMBED_GGUF_URL); rozměr změří discovery.
#
# Aliasy jsou DEKLARACE instance, platforma žádný nedosazuje. Zapnutá lane bez aliasu nebo
# s aliasem, který nesedí na kontrakty discovery a směrování, NENASTARTUJE — a to PŘED
# stažením vah (proč a jaké kontrakty: svc-model-aliasy.sh).
#
# Fail-closed: chybějící pin nebo sha nesouhlas = NENASTARTUJ (tichá záměna vah je únik
# důvěry — zrcadlí docker/entrypoint.sh ingest jednotky). Váhy se stahují jednou do
# volume /models; restart je nechá být. Deployment jde výhradně přes API/git.
set -eu

MODELS_DIR="${MODELS_DIR:-/models}"

# Vlákna llama.cpp — ODVOZENÁ z CPU kvóty kontejneru (nebo výslovně z MODEL_N_THREADS).
# Proč ne literál a proč i n_threads_batch: viz hlavička svc-model-threads.sh.
# shellcheck source=svc-model-threads.sh
. /usr/local/lib/svc-model-threads.sh
MODEL_THREADS="$(model_threads /sys/fs/cgroup)" || { echo "CHYBA: počet vláken nelze odvodit" >&2; exit 1; }
export MODEL_THREADS
echo "threads: ${MODEL_THREADS} (MODEL_N_THREADS='${MODEL_N_THREADS:-}', odvozeno z CPU kvóty, není-li deklarováno)" >&2

# Aliasy lan se ověřují DŘÍV než seed: špatně deklarované jméno se jinak projeví až po
# stažení vah (~190 s naměřeno 2026-09-13) jako model, který discovery zařadí špatně.
# shellcheck source=svc-model-aliasy.sh
. /usr/local/lib/svc-model-aliasy.sh
over_aliasy || { echo "CHYBA: aliasy lan nesedí na kontrakt discovery/směrování — nenastartuji (fail-closed)" >&2; exit 1; }

# seed <url> <sha256> <dest> — jednorázové stažení + sha gate proti pinu z env
seed() {
    _url=$1; _sha=$2; _dest=$3
    if [ -z "$_url" ] || [ -z "$_sha" ]; then
        echo "CHYBA: seed $_dest — URL nebo sha pin chybí (fail-closed)" >&2
        exit 1
    fi
    if [ -f "$_dest" ]; then
        # ⛔ Soubor ve svazku /models přežívá restarty i změnu pinu v env. Bez ověření by
        # svc-model po změně *_GGUF_SHA256 dál běžel na STARÝCH vahách pod novým pinem —
        # tiše — a vektory dotazů i platformního dopočtu by se rozešly s uloženými
        # (živá identita gguf:<pin>). Jednotky sekund při startu; neshoda = stáhnout znovu.
        _have=$(sha256sum "$_dest" | cut -d' ' -f1)
        if [ "$_have" = "$_sha" ]; then
            return 0
        fi
        echo "weights seed: $(basename "$_dest") ve svazku ($_have) ≠ pin ($_sha) — stahuji znovu" >&2
        rm -f "$_dest"
    fi
    echo "weights seed: stahuji $(basename "$_dest") ← $_url" >&2
    mkdir -p "$(dirname "$_dest")"
    if ! curl -fSL --retry 3 -o "$_dest.part" "$_url"; then
        rm -f "$_dest.part"
        echo "CHYBA: stažení $_dest selhalo" >&2
        exit 1
    fi
    _actual=$(sha256sum "$_dest.part" | cut -d' ' -f1)
    if [ "$_actual" != "$_sha" ]; then
        rm -f "$_dest.part"
        echo "CHYBA: sha $(basename "$_dest") ($_actual) ≠ pin ($_sha) — tichá záměna vah odmítnuta" >&2
        exit 1
    fi
    mv "$_dest.part" "$_dest"
    echo "weights seed: OK — $(basename "$_dest") sha ověřeno" >&2
}

# Chat lane is what this service IS — config/services.json gates the whole
# service on CHAT_GGUF_URL, so reaching this line without it is a real error and
# `seed` fails closed on the missing pin.
seed "${CHAT_GGUF_URL:-}" "${CHAT_GGUF_SHA256:-}" "$MODELS_DIR/chat.gguf"

# Embedding lane is INDEPENDENTLY optional — same shape as the second embedding
# lane a few lines below, which was already written this way.
#
# The two lanes answer different needs: chat serves the tuned model, embed feeds
# RAG vectors. On CPU-only hardware the embed lane is not viable (measured on
# this platform: >80s per embedding), so "chat yes, embed no" is a legitimate
# operating state — it just had no way to be expressed. Seeding both
# unconditionally meant an install that only wanted the chat lane could not
# start at all, and its absence was reported as a missing-credential error
# rather than as an unused capability.
#
# Fail-closed is preserved where it matters: a lane that IS requested still
# needs its sha pin, because `seed` refuses a URL without one.
if [ -n "${EMBED_GGUF_URL:-}" ]; then
    seed "$EMBED_GGUF_URL" "${EMBED_GGUF_SHA256:-}" "$MODELS_DIR/embed.gguf"
else
    echo "embed lane: EMBED_GGUF_URL unset — serving chat lane only" >&2
fi

# Volitelná druhá embedding lane — platformní RAG space v2 (halfvec 2560 = Qwen3-Embedding-4B).
# bge-m3 (1024) do v1/v2 sloupců nesedí; Qwen3 4B GGUF je oficiální a 2560 je jeho nativní dim.
if [ -n "${EMBED2_GGUF_URL:-}" ]; then
    seed "$EMBED2_GGUF_URL" "${EMBED2_GGUF_SHA256:-}" "$MODELS_DIR/embed2.gguf"
fi

# LoRA adaptér z instance-data bundle (podadresář ingest/adapters/) — malý, náš artefakt,
# integrita = git commit (viz local-ingest docs/ADVISORY_CPU.md §3). Bez BUNDLE_GIT_URL
# jede holý base (žádný egress navíc). Refresh: adaptér se klonuje PŘI KAŽDÉM startu do tmp
# a kopíruje přes stávající — promote nového adaptéru = commit + restart appky.
ADAPTER_PATH=""
if [ -n "${BUNDLE_GIT_URL:-}" ]; then
    SUB="${BUNDLE_GIT_PATH:-ingest}"
    SAFE_URL=$(printf '%s' "$BUNDLE_GIT_URL" | sed 's|//[^@]*@|//***@|')
    rm -rf /tmp/bundle-seed
    # ⛔ `2>/dev/null` u klonu = utržený přenos k nerozeznání od špatného pověření.
    # Běží v kontejneru, kde lib/git-klon.sh není, takže týž tvar inline.
    _md_err="$(mktemp)"
    # shellcheck disable=SC2086 # prázdný přepínač se NESMÍ uvozovkovat
    if git clone --quiet --depth 1 --filter=blob:none ${BUNDLE_GIT_REF:+--branch "$BUNDLE_GIT_REF"} "$BUNDLE_GIT_URL" /tmp/bundle-seed 2>"$_md_err"; then
        SRC="/tmp/bundle-seed/$SUB/adapters/lora-adapter.gguf"
        if [ -f "$SRC" ]; then
            cp "$SRC" "$MODELS_DIR/lora-adapter.gguf"
            ADAPTER_PATH="$MODELS_DIR/lora-adapter.gguf"
            echo "adapter seed: OK — lora-adapter.gguf z ${SAFE_URL} ($SUB/adapters)" >&2
        else
            echo "VAROVÁNÍ: adapter seed — $SUB/adapters/lora-adapter.gguf v repu není, jedu holý base" >&2
        fi
        rm -rf /tmp/bundle-seed
    else
        echo "VAROVÁNÍ: adapter seed — clone selhal (URL/credentials?), jedu holý base" >&2
    fi
elif [ -f "$MODELS_DIR/lora-adapter.gguf" ]; then
    ADAPTER_PATH="$MODELS_DIR/lora-adapter.gguf"
fi

# config.json pro llama_cpp.server — multi-model, routing podle aliasu.
# n_ctx konzervativně (sdílený server); n_threads I n_threads_batch = odvozená vlákna.
# ⛔ n_threads_batch MUSÍ být nastavené: jinak ho server vezme z multiprocessing.cpu_count()
# = CPU HOSTITELE, a prompt i každý embedding by běžel ve více vláknech, než je kvóta.
python - <<PYEOF
import json, os
chat = {
    "model": "$MODELS_DIR/chat.gguf",
    # ⛔ Bez dosazeného jména: get("MODEL_ALIAS", "chat") by id „chat" bez prefixu
    # lokálního backendu poslalo na cesty, které ho přemapují na jiný model. Deklaraci
    # ověřil over_aliasy výš; tady chybějící klíč = KeyError = nenastartuje.
    "model_alias": os.environ["MODEL_ALIAS"],
    "n_ctx": int(os.environ.get("MODEL_N_CTX", "4096")),
    "n_threads": int(os.environ["MODEL_THREADS"]),
    "n_threads_batch": int(os.environ["MODEL_THREADS"]),
    "seed": 0,
}
adapter = "$ADAPTER_PATH"
if adapter:
    chat["lora_path"] = adapter
models = [chat]
# Embed lane only when its weights were actually seeded — same existence check
# the second embed lane below already used. Listing a model file that was never
# downloaded makes llama.cpp fail at load, which would move the crash from the
# seed step to startup instead of removing it.
if os.path.exists("$MODELS_DIR/embed.gguf"):
    models.append({
        "model": "$MODELS_DIR/embed.gguf",
        # 'embedding' v aliasu je capability marker (modelDiscovery deriveModelCaps:
        # is_embedding = id obsahuje 'embedding'; bez něj by discovery model vedla jako chat).
        # Jméno deklaruje instance — dosazené bge-m3-embedding jmenovalo model, který
        # v EMBED_GGUF_URL být nemusí. Ověřeno over_aliasy.
        "model_alias": os.environ["EMBED_ALIAS"],
        "embedding": True,
        "n_ctx": int(os.environ.get("EMBED_N_CTX", "8192")),
        "n_threads": int(os.environ["MODEL_THREADS"]),
        "n_threads_batch": int(os.environ["MODEL_THREADS"]),
    })
if os.path.exists("$MODELS_DIR/embed2.gguf"):
    models.append({
        "model": "$MODELS_DIR/embed2.gguf",
        "model_alias": os.environ["EMBED2_ALIAS"],
        "embedding": True,
        "n_ctx": int(os.environ.get("EMBED2_N_CTX", "4096")),
        "n_threads": int(os.environ["MODEL_THREADS"]),
        "n_threads_batch": int(os.environ["MODEL_THREADS"]),
    })
cfg = {
    "host": "0.0.0.0",
    "port": int(os.environ.get("MODEL_PORT", "8000")),
    "models": models,
}
with open("/tmp/svc-model-config.json", "w") as f:
    json.dump(cfg, f, indent=1)
print("config:", json.dumps({**cfg, "models": [
    {k: v for k, v in m.items()} for m in cfg["models"]]}, indent=1))
PYEOF

exec python -m llama_cpp.server --config_file /tmp/svc-model-config.json
