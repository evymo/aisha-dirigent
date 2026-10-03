#!/bin/sh
# svc-model-aliasy.sh — jména, pod kterými svc-model obsluhuje své lane, jsou DEKLARACE instance.
#
# Použití (POSIX sh, source):   . /usr/local/lib/svc-model-aliasy.sh
#                               over_aliasy || exit 1
#
# ⛔ NAMĚŘENO 2026-09-13. Compose dosazoval `MODEL_ALIAS=${MODEL_ALIAS:-default-lens}`,
# `EMBED_ALIAS=${EMBED_ALIAS:-bge-m3-embedding}`, `EMBED2_ALIAS=${EMBED2_ALIAS:-qwen3-embedding-4b}`
# a entrypoint k tomu ještě `os.environ.get(..., "chat" | "bge-m3-embedding" | "qwen3-embedding-4b")`.
# Dvě z těch hodnot JMENUJÍ konkrétní model, který instance vůbec mít nemusí — pod jménem
# `qwen3-embedding-4b` by běžely libovolné váhy z EMBED2_GGUF_URL. A žádná z nich nesplňovala
# kontrakty, které alias čtou:
#   · discovery (services/svc-ai-chat/src/lib/modelDiscovery.ts, deriveModelCaps): is_embedding
#     = id obsahuje „embedding"; is_chat_capable = id NEnese žádnou značku ne-chat modelu
#     (NON_CHAT_MODEL_MARKERS). Chat alias se značkou se zaregistruje jako ne-chat a resolver
#     ho nikdy nevybere; embedding alias bez značky se zaregistruje jako CHAT model.
#   · směrování (packages/llm-dispatch/src/providers/openai-compat.ts, createVLLMBackend
#     modelPrefixes; services/svc-ai-chat/src/lib/llmRouter.ts resolveProvider): model id bez
#     prefixu `vllm-`/`local-` žádný backend „neumí" (canServe) a cesty, které nemají řádek
#     registru — resolveAvailableModel (evaluate, proactive, flowboard, slot v decision.ts)
#     a unifiedChatStream (Omni /v1 stream) — ho TIŠE přemapují na jiný model jiného providera.
#     `default-lens` tak šel k OpenAI (naměřeno v llm-pin-provider.unit.test.ts: 404).
#   · jedinečnost: llama_cpp.server vede modely ve slovníku podle aliasu; dvě lane pod týmž
#     jménem by jednu schovaly (NEMĚŘENO v kontejneru — tady ho spustit nejde) a registr
#     (provider, model_id) by dva různé modely slil do jednoho řádku.
#
# Proč DEKLARACE, a ne odvození z názvu GGUF v URL: název souboru nese jen to, co zvolil
# autor vah — bge-m3 se běžně publikuje jako `bge-m3-Q8_0.gguf` (bez „embedding"), URL může
# být zrcadlo bez názvu souboru a jiná kvantizace téhož modelu by změnila model_id, tedy
# identitu řádku registru, jeho benchmarky i provenienci vektorů. Odvození by kontrakt
# „embedding alias obsahuje embedding" nedrželo; deklarace se dá ověřit PŘED stažením vah.
#
# Seznamy značek a prefixů níž jsou OPISEM zdrojů v TypeScriptu. Brána
# src/tests/gates/lokalni-model-alias-je-deklarace.gate.test.ts je čte z obou míst a srovnává —
# opis bez měřidla by se rozešel při první změně discovery.

SVC_MODEL_NECHAT_ZNACKY="embedding whisper dall-e tts davinci babbage realtime audio moderation"
SVC_MODEL_SMEROVACI_PREFIXY="vllm- local-"

_svc_model_mala() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# _svc_model_embed_alias <lane> <proměnná aliasu> <hodnota aliasu> — 0 = alias nese značku embeddingu
_svc_model_embed_alias() {
    _lana=$1; _promenna=$2; _alias=$3
    if [ -z "$_alias" ]; then
        echo "CHYBA: lane $_lana je zapnutá, ale $_promenna chybí — jméno modelu deklaruje instance, platforma ho nedosazuje" >&2
        return 1
    fi
    case "$(_svc_model_mala "$_alias")" in
        *embedding*) return 0 ;;
    esac
    echo "CHYBA: $_promenna='$_alias' neobsahuje „embedding\" — discovery by model zaregistrovala jako CHAT (modelDiscovery deriveModelCaps)" >&2
    return 1
}

# over_aliasy — ověří aliasy ZAPNUTÝCH lan. Čte MODEL_ALIAS, EMBED_GGUF_URL/EMBED_ALIAS,
# EMBED2_GGUF_URL/EMBED2_ALIAS. Vrací 0, nebo 1 se všemi nálezy na stderr (ne jen prvním).
over_aliasy() {
    _chyby=0
    _chat="${MODEL_ALIAS:-}"
    if [ -z "$_chat" ]; then
        echo "CHYBA: MODEL_ALIAS chybí — chat lane je to, čím svc-model JE; jméno modelu deklaruje instance" >&2
        _chyby=1
    else
        _m="$(_svc_model_mala "$_chat")"
        for _z in $SVC_MODEL_NECHAT_ZNACKY; do
            case "$_m" in
                *"$_z"*)
                    echo "CHYBA: MODEL_ALIAS='$_chat' nese značku ne-chat modelu „$_z\" — discovery by ho nevedla jako chat" >&2
                    _chyby=1
                    ;;
            esac
        done
        _smerovatelny=0
        for _p in $SVC_MODEL_SMEROVACI_PREFIXY; do
            case "$_m" in
                "$_p"*) _smerovatelny=1 ;;
            esac
        done
        if [ "$_smerovatelny" != 1 ]; then
            echo "CHYBA: MODEL_ALIAS='$_chat' nezačíná prefixem lokálního backendu ($SVC_MODEL_SMEROVACI_PREFIXY) — cesty bez řádku registru by ho přemapovaly na jiný model" >&2
            _chyby=1
        fi
    fi

    if [ -n "${EMBED_GGUF_URL:-}" ]; then
        _svc_model_embed_alias embed EMBED_ALIAS "${EMBED_ALIAS:-}" || _chyby=1
        if [ -n "${EMBED_ALIAS:-}" ] && [ "${EMBED_ALIAS}" = "$_chat" ]; then
            echo "CHYBA: EMBED_ALIAS a MODEL_ALIAS jsou totéž jméno ('$_chat') — dvě lane pod jedním id" >&2
            _chyby=1
        fi
    fi
    if [ -n "${EMBED2_GGUF_URL:-}" ]; then
        _svc_model_embed_alias embed2 EMBED2_ALIAS "${EMBED2_ALIAS:-}" || _chyby=1
        if [ -n "${EMBED2_ALIAS:-}" ] && [ "${EMBED2_ALIAS}" = "$_chat" ]; then
            echo "CHYBA: EMBED2_ALIAS a MODEL_ALIAS jsou totéž jméno ('$_chat') — dvě lane pod jedním id" >&2
            _chyby=1
        fi
        if [ -n "${EMBED_GGUF_URL:-}" ] && [ -n "${EMBED2_ALIAS:-}" ] && [ "${EMBED2_ALIAS}" = "${EMBED_ALIAS:-}" ]; then
            echo "CHYBA: EMBED2_ALIAS a EMBED_ALIAS jsou totéž jméno ('${EMBED_ALIAS}') — dvě lane pod jedním id" >&2
            _chyby=1
        fi
    fi
    return "$_chyby"
}
