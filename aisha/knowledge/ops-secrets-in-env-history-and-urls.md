---
slug: ops-secrets-in-env-history-and-urls
title: "Where secrets leak during operations: env values, URLs and base64"
summary: "Secrets hide in values that do not look secret (git URLs with tokens, base64 blobs, CI_ prefixed variables); print keys only and values only by an allowlist."
category: operations
item_type: playbook
tags: [secrets, env, logging, hygiene]
verified: read
verified_note: "each pattern was observed at least once in operation (2026-09-14, 2026-09-27, 2026-10-04); the records are not public (not re-run for this item)"
evidence:
  - "file: scripts/lib/env-file-keys.sh — load_env_file_keys reads an env file without executing it"
  - "file: scripts/lib/env-soubor.sh — parse_env_soubor, an env parser that does not execute values"
valid_for: "general; examples from Coolify 4.x compose deployments"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When inspecting containers, env, Coolify API /envs or SQL rows with URLs, print keys only (cut -d= -f1) and values only for an explicit allowlist of named keys; read env files with a parser, never with `source`; strip credentials from URLs with sed -E 's#//[^@/]*@#//#'. Never filter by prefix or regex to decide what is safe to print. Do not rotate leaked secrets without the owner."
---
# Where secrets leak during operations

## Rules
1. **Env of a container: keys only.** [measured] `docker inspect … Config.Env | cut -d= -f1`. A "quick look" with `grep -E '^CI_'` printed a registry token; a warning in memory did not prevent it, the mechanical rule does.
2. **Values only by allowlist of named keys.** [measured] `grep -E '^(CI_MIN_FREE_PCT|CI_PRUNE_INTERVAL)='`. Never by prefix or by a pattern such as `OPERATOR|PORT`.
3. **URLs carry tokens.** [measured] `…_GIT_URL=https://oauth2:<token>@host/…`, repository URLs stored in databases, `git remote -v`. Clean with `sed -E 's#//[^@/]*@#//#'`, in SQL `regexp_replace(x,'//[^@/]*@','//')`, in jq `sub("//[^@/]*@";"//")`.
4. **Base64 is not harmless.** [measured] A `*_B64` value contained an HMAC key and an OTP seed.
5. **Read credential files with a parser, never `source` them.** [measured] `set -a; . file; set +a` executes values: a backup with the bare value `a|touch <file>` created the file when a doctor script sourced it, and part of another value went to the log as "command not found". Use the platform's env parser (`scripts/lib/env-file-keys.sh` -> `load_env_file_keys`, `scripts/lib/env-soubor.sh` -> `parse_env_soubor`, or `readConfigKey` in Node). Tokens live in one local env file (chmod 600); never minted ad hoc, never echoed.

## Why
Secret values must not reach transcripts; transcripts are long-lived and shared between sessions.
