#!/bin/bash
# Compatibility wrapper. The old version hardcoded Coolify UUIDs and went stale
# after every wipe. The doctor discovers apps dynamically and only restarts when
# --restart is passed explicitly.
set -euo pipefail

exec node scripts/coolify-domain-doctor.mjs --apply "$@"
