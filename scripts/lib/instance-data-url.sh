#!/usr/bin/env bash
# ==============================================================================
# instance-data-url.sh — single source of truth for AISHA_INSTANCE_DATA_GIT_URL
# ==============================================================================
# The stored value carries a `#<ref>` fragment:
#     https://<token>@repo.id3a.cz/aisha/aisha-instance-data.git#main
#
# git does NOT strip URL fragments. Over smart-HTTP it splices the fragment into
# the request path and the clone fails — verified 2026-07-18:
#     fatal: repository '…/aisha-instance-data.git#main/' not found
# while the same URL without the fragment clones fine.
#
# That mattered: the pre-wipe off-machine vault backup clones this repo to publish
# the encrypted snapshot. The clone failed, the caller warned "kept LOCAL" and
# returned success, so `vault/` in the instance-data repo was still EMPTY — the
# off-machine DR copy had never once been written.
#
# Every caller parses this URL through here. Sourced by scripts that need it.
# ==============================================================================

# parse_instance_data_url <raw-url>
#   Emits shell assignments; consume with:
#       eval "$(parse_instance_data_url "$AISHA_INSTANCE_DATA_GIT_URL")"
#   Sets IDATA_URL (fragment stripped) and IDATA_REF (empty = remote default).
parse_instance_data_url() {
  local raw url ref=""
  raw="$(printf '%s' "${1:-}" | sed 's|\\/|/|g')"
  case "$raw" in
    *"#"*) ref="${raw##*#}"; url="${raw%#*}" ;;
    *)     url="$raw" ;;
  esac
  printf 'IDATA_URL=%q\nIDATA_REF=%q\n' "$url" "$ref"
}

# clone_instance_data <dest>
#   Shallow-clones the instance-data repo, honouring the ref from the fragment.
#   Returns git's exit code; 2 when no URL is configured.
# Note: the ref is passed via explicit branches rather than
# `${IDATA_REF:+--branch "$IDATA_REF"}` — that idiom relies on word-splitting an
# unquoted expansion, which bash does and zsh does not, so under zsh git received
# `--branch main` as ONE argument and exited 129. Being shell-agnostic here is
# cheap; a helper on the pre-wipe backup path must not depend on the caller's shell.
clone_instance_data() {
  local dest="$1"
  eval "$(parse_instance_data_url "${AISHA_INSTANCE_DATA_GIT_URL:-}")"
  [ -n "${IDATA_URL:-}" ] || return 2
  if [ -n "${IDATA_REF:-}" ]; then
    # ⛔ `>/dev/null 2>&1` zahazovalo důvod; klon se u velkých repozitářů trhá.
    # Viz scripts/lib/git-klon.sh — opakuje, od 2. pokusu bez historických blobů.
    . "$(dirname "${BASH_SOURCE[0]}")/git-klon.sh"
    klonuj "$IDATA_URL" "$dest" "$IDATA_REF"
  else
    . "$(dirname "${BASH_SOURCE[0]}")/git-klon.sh"
    klonuj "$IDATA_URL" "$dest"
  fi
}
