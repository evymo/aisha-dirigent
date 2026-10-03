#!/usr/bin/env bash
# =============================================================================
# czech-doc-analyze.sh — local Czech-RAG document analysis & QA (Apple Silicon)
# =============================================================================
# Operator tool over the LOCAL aisha stack's Elasticsearch. Zero installs:
# bash + system python3 + Docker Desktop. All ES calls run inside the ES
# container with its own credentials (no secrets touch the host shell).
#
# Analyzer definitions come from the insight submodule SoT
# (packages/insight/ragnarok/ragnarok/index_settings.py) when available,
# with an embedded fallback so the script also works standalone.
#
# Usage:
#   scripts/rag/czech-doc-analyze.sh battery
#       Regression battery: accent/unaccent pairs must meet in cs|cs_ascii.
#   scripts/rag/czech-doc-analyze.sh analyze "nájemné" [more words...]
#       Show tokens from all three analyzers side by side.
#   scripts/rag/czech-doc-analyze.sh file <path> [--query "..."]
#       Text-extract (txt/md native; docx/rtf/html via macOS textutil;
#       pdf via pdftotext if installed) + cleaning report + top folded
#       tokens. With --query: does the query match this document's text?
#   scripts/rag/czech-doc-analyze.sh match <index> "<query>"
#       Per-field hit breakdown (text / text.cs / text.cs_ascii) — shows
#       WHY (or why not) documents match.
#   scripts/rag/czech-doc-analyze.sh indices
#       List indices + whether they carry the Czech analyzers/sub-fields
#       (read-only upgrade check).
#
# Exit codes: 0 ok / 1 failed check / 2 environment problem.
# =============================================================================
set -euo pipefail

DOCKER="${DOCKER:-/Applications/Docker.app/Contents/Resources/bin/docker}"
[ -x "$DOCKER" ] || DOCKER="$(command -v docker || true)"
[ -n "$DOCKER" ] || { echo "✗ docker CLI not found" >&2; exit 2; }

# Docker container name of the local-stack ES (docker-compose.local.yml) — not a credential.
# Per-implementation stack prefix: default must match scripts/lib/local-stack-name.mjs
# (parity enforced by the local-container-namespacing gate) — a hardcoded foreign
# prefix would docker-exec into ANOTHER implementation's ES container.
ES_CONTAINER_DEFAULT="${AISHA_LOCAL_STACK:-aisha-local}__backend--integration--elasticsearch"
ES_CONTAINER="${ES_CONTAINER:-$ES_CONTAINER_DEFAULT}"
SCRATCH_INDEX="czech-doc-analyze-scratch"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INDEX_SETTINGS_PY="$REPO_ROOT/packages/insight/ragnarok/ragnarok/index_settings.py"

# ── ES plumbing (auth stays inside the container) ────────────────────────────
es() { # es <method> <path> [json-body-file]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    "$DOCKER" exec -i "$ES_CONTAINER" sh -c \
      "curl -s -u \"elastic:\${ELASTIC_PASSWORD}\" -X $method 'localhost:9200$path' -H 'Content-Type: application/json' --data-binary @-" < "$body"
  else
    "$DOCKER" exec "$ES_CONTAINER" sh -c \
      "curl -s -u \"elastic:\${ELASTIC_PASSWORD}\" -X $method 'localhost:9200$path'"
  fi
}

ensure_es() {
  "$DOCKER" ps --format '{{.Names}}' | grep -q "^${ES_CONTAINER}\$" \
    || { echo "✗ ES container '$ES_CONTAINER' not running — start the stack: npm run stack:bringup" >&2; exit 2; }
  es GET /_cluster/health >/dev/null || { echo "✗ ES unreachable inside container" >&2; exit 2; }
}

# ── scratch index body (SoT module, embedded fallback) ───────────────────────
# Full body: analysis settings + the text mapping WITH cs/cs_ascii sub-fields —
# without the mapping, multi_match silently degrades to the base field.
scratch_body_json() {
  if [ -f "$INDEX_SETTINGS_PY" ]; then
    python3 - "$INDEX_SETTINGS_PY" <<'PY'
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location("m", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps({
    "settings": {"analysis": m.CZECH_FOLDED_ANALYSIS},
    "mappings": {"properties": {"text": m.TEXT_FIELD_MAPPING}},
}))
PY
  else
    cat <<'JSON'
{"settings":{"analysis":{"filter":{"czech_stop":{"type":"stop","stopwords":"_czech_"},"czech_stemmer":{"type":"stemmer","language":"czech"}},"analyzer":{"standard_lowercase":{"tokenizer":"standard","filter":["lowercase"]},"czech_folded":{"tokenizer":"standard","filter":["lowercase","czech_stop","czech_stemmer","asciifolding"]},"czech_folded_ascii":{"tokenizer":"standard","filter":["lowercase","czech_stop","asciifolding","czech_stemmer"]}}}},"mappings":{"properties":{"text":{"type":"text","analyzer":"standard_lowercase","fields":{"cs":{"type":"text","analyzer":"czech_folded"},"cs_ascii":{"type":"text","analyzer":"czech_folded_ascii"}}}}}}
JSON
  fi
}

ensure_scratch() {
  # recreate when missing OR when it predates the mapping (no text.cs)
  if ! es GET "/$SCRATCH_INDEX/_mapping" | grep -q '"cs_ascii"'; then
    es DELETE "/$SCRATCH_INDEX" >/dev/null 2>&1 || true
    local tmp; tmp="$(mktemp)"
    scratch_body_json > "$tmp"
    es PUT "/$SCRATCH_INDEX" "$tmp" >/dev/null
    rm -f "$tmp"
  fi
}

tokens_for() { # tokens_for <analyzer> <text>  → python list on stdout
  local analyzer="$1" text="$2" tmp; tmp="$(mktemp)"
  python3 - "$analyzer" "$text" <<'PY' > "$tmp"
import json, sys
print(json.dumps({"analyzer": sys.argv[1], "text": sys.argv[2]}))
PY
  es POST "/$SCRATCH_INDEX/_analyze" "$tmp" | python3 -c \
    'import json,sys; print(" ".join(t["token"] for t in json.load(sys.stdin).get("tokens",[])) or "∅")'
  rm -f "$tmp"
}

# ── subcommands ──────────────────────────────────────────────────────────────
cmd_analyze() {
  ensure_es; ensure_scratch
  printf '%-22s │ %-24s │ %-24s │ %s\n' "input" "standard_lowercase" "czech_folded" "czech_folded_ascii"
  printf '%.0s─' {1..100}; echo
  for w in "$@"; do
    printf '%-22s │ %-24s │ %-24s │ %s\n' "$w" \
      "$(tokens_for standard_lowercase "$w")" \
      "$(tokens_for czech_folded "$w")" \
      "$(tokens_for czech_folded_ascii "$w")"
  done
}

cmd_battery() {
  ensure_es; ensure_scratch
  # accented ↔ unaccented pairs: they MUST share a token in cs OR cs_ascii
  local pairs=(
    "nájemné:najemne" "nájemného:najemneho" "pojištění:pojisteni"
    "výpověď:vypoved" "smlouva:smlouvy" "škoda:skoda" "řízení:rizeni"
    "vyúčtování:vyuctovani" "přílohy:prilohy" "daň:dan"
  )
  local fails=0
  for pair in "${pairs[@]}"; do
    local a="${pair%%:*}" b="${pair##*:}"
    local a_cs b_cs a_csa b_csa
    a_cs="$(tokens_for czech_folded "$a")";        b_cs="$(tokens_for czech_folded "$b")"
    a_csa="$(tokens_for czech_folded_ascii "$a")"; b_csa="$(tokens_for czech_folded_ascii "$b")"
    if [ "$a_cs" = "$b_cs" ] || [ "$a_csa" = "$b_csa" ]; then
      printf '✓ %-14s ≈ %-14s (cs: %s|%s  cs_ascii: %s|%s)\n' "$a" "$b" "$a_cs" "$b_cs" "$a_csa" "$b_csa"
    else
      printf '✗ %-14s ≠ %-14s (cs: %s|%s  cs_ascii: %s|%s)\n' "$a" "$b" "$a_cs" "$b_cs" "$a_csa" "$b_csa"
      fails=$((fails+1))
    fi
  done
  [ "$fails" -eq 0 ] && echo "PASS — all pairs meet in at least one sub-field" || { echo "FAIL — $fails pair(s) never meet"; exit 1; }
}

extract_text() { # extract_text <path> → plain text on stdout
  local f="$1" ext="${1##*.}"
  case "$(echo "$ext" | tr '[:upper:]' '[:lower:]')" in
    txt|md|csv|json|sql|log) cat "$f" ;;
    docx|doc|rtf|html|htm|odt|webarchive)
      textutil -convert txt -stdout "$f" 2>/dev/null \
        || { echo "✗ textutil failed on $f" >&2; exit 2; } ;;
    pdf)
      if command -v pdftotext >/dev/null; then pdftotext "$f" -
      else echo "✗ pdftotext not installed (brew install poppler) — or upload via ragnarok POST /knowledge_base/file" >&2; exit 2; fi ;;
    *) echo "✗ unsupported extension .$ext (txt/md/docx/rtf/html/pdf)" >&2; exit 2 ;;
  esac
}

cmd_file() {
  local path="$1"; shift || true
  local query=""
  [ "${1:-}" = "--query" ] && query="${2:?--query needs a value}"
  [ -f "$path" ] || { echo "✗ no such file: $path" >&2; exit 2; }
  ensure_es; ensure_scratch

  local txt; txt="$(mktemp)"
  extract_text "$path" > "$txt"

  echo "── cleaning report: $path"
  python3 - "$txt" <<'PY'
import re, sys, unicodedata, collections
raw = open(sys.argv[1], 'rb').read()
try:
    text = raw.decode('utf-8'); enc = 'utf-8 ✓'
except UnicodeDecodeError:
    text = raw.decode('utf-8', 'replace'); enc = 'NOT valid utf-8 ✗ (replaced)'
lines = text.splitlines()
words = re.findall(r'\w+', text, re.UNICODE)
ctrl = sum(1 for c in text if unicodedata.category(c) == 'Cc' and c not in '\n\t\r')
diac = sum(1 for c in text if unicodedata.decomposition(c))
dupl = sum(c - 1 for c in collections.Counter(l.strip() for l in lines if l.strip()).values() if c > 1)
cz_hint = sum(1 for w in words if any(ch in w for ch in 'ěščřžýáíéůúťďň'))
print(f"  encoding:        {enc}")
print(f"  size:            {len(raw):,} B / {len(lines):,} lines / {len(words):,} words")
print(f"  control chars:   {ctrl} {'✗ (clean them)' if ctrl else '✓'}")
print(f"  duplicate lines: {dupl} {'⚠ (dedup before ingest)' if dupl > 5 else '✓'}")
print(f"  diacritic chars: {diac:,}  czech-looking words: {cz_hint:,} ({(100*cz_hint/max(1,len(words))):.0f} %)")
PY

  echo "── top czech_folded tokens (indexable signal)"
  local sample tmp; sample="$(head -c 6000 "$txt")"; tmp="$(mktemp)"
  python3 - czech_folded "$sample" <<'PY' > "$tmp"
import json, sys
print(json.dumps({"analyzer": sys.argv[1], "text": sys.argv[2]}))
PY
  es POST "/$SCRATCH_INDEX/_analyze" "$tmp" | python3 -c '
import json, sys, collections
toks = [t["token"] for t in json.load(sys.stdin).get("tokens", [])]
for tok, n in collections.Counter(toks).most_common(12):
    print(f"  {n:>3}× {tok}")'
  rm -f "$tmp"

  if [ -n "$query" ]; then
    echo "── query match test: \"$query\""
    local doc qy; doc="$(mktemp)"; qy="$(mktemp)"
    python3 - "$txt" <<'PY' > "$doc"
import json, sys
print(json.dumps({"text": open(sys.argv[1], encoding="utf-8", errors="replace").read()[:100000]}))
PY
    es PUT "/$SCRATCH_INDEX/_doc/probe?refresh=true" "$doc" >/dev/null
    for fields in '["text"]' '["text","text.cs"]' '["text","text.cs","text.cs_ascii"]'; do
      python3 - "$query" "$fields" <<'PY' > "$qy"
import json, sys
print(json.dumps({"query": {"multi_match": {"query": sys.argv[1], "fields": json.loads(sys.argv[2]), "type": "most_fields"}}}))
PY
      printf '  fields=%-38s → ' "$fields"
      es POST "/$SCRATCH_INDEX/_search" "$qy" | python3 -c \
        'import json,sys; h=json.load(sys.stdin)["hits"]["hits"]; print("HIT score=%.2f" % h[0]["_score"] if h else "no match")'
    done
    es DELETE "/$SCRATCH_INDEX/_doc/probe" >/dev/null 2>&1 || true
    rm -f "$doc" "$qy"
  fi
  rm -f "$txt"
}

cmd_match() {
  local index="$1" query="$2"
  ensure_es
  local qy; qy="$(mktemp)"
  echo "── per-field breakdown on '$index' for: \"$query\""
  for f in text text.cs text.cs_ascii; do
    python3 - "$query" "$f" <<'PY' > "$qy"
import json, sys
print(json.dumps({"size": 3, "query": {"match": {sys.argv[2]: sys.argv[1]}}}))
PY
    printf '  %-14s → ' "$f"
    es POST "/$index/_search" "$qy" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "error" in d: print("n/a (" + d["error"]["root_cause"][0]["type"] + ")"); raise SystemExit
h = d["hits"]["hits"]
print(", ".join("%s:%.2f" % (x["_id"], x["_score"]) for x in h) if h else "no hits")'
  done
  rm -f "$qy"
}

cmd_indices() {
  ensure_es
  echo "── Czech-readiness of indices (analyzers + text sub-fields)"
  es GET "/_all/_settings/index.analysis*" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for idx in sorted(data):
    if idx.startswith("."): continue
    an = set(data[idx].get("settings", {}).get("index", {}).get("analysis", {}).get("analyzer", {}))
    need = {"czech_folded", "czech_folded_ascii"}
    state = "✓ czech-ready" if need <= an else ("~ partial (" + ",".join(sorted(need - an)) + " missing)" if an & need else "✗ legacy")
    print(f"  {idx:<50} {state}")'
  echo "  (upgrade path: VectorStore.upgrade_czech_subfield() — live-verified sequence)"
}

# ── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-help}" in
  battery)  shift; cmd_battery "$@" ;;
  analyze)  shift; [ $# -ge 1 ] || { echo "usage: $0 analyze <word|text>..." >&2; exit 2; }; cmd_analyze "$@" ;;
  file)     shift; [ $# -ge 1 ] || { echo "usage: $0 file <path> [--query \"...\"]" >&2; exit 2; }; cmd_file "$@" ;;
  match)    shift; [ $# -ge 2 ] || { echo "usage: $0 match <index> \"<query>\"" >&2; exit 2; }; cmd_match "$@" ;;
  indices)  shift; cmd_indices ;;
  *) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac
