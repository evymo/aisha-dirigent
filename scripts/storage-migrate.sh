#!/usr/bin/env bash
# =============================================================================
# storage-migrate.sh — Migrate Supabase Storage buckets → MinIO (S3)
# =============================================================================
# Copies all objects from Supabase Storage (S3-compatible) to new MinIO
# instance using mc (MinIO Client).
#
# Buckets (8):
#   archive-scans, email-assets, email-templates, health-documents,
#   hero-images, page-assets, product-images, wearable-analysis
#
# Two modes:
#   1. S3-to-S3: mc mirror from old Supabase S3 endpoint → new MinIO
#   2. Volume-to-S3: mc mirror from local filesystem → new MinIO
#      (when Supabase Storage volume is mounted locally)
#
# Usage:
#   # S3 mode (remote Supabase → new MinIO):
#   ./scripts/storage-migrate.sh --mode=s3
#
#   # Volume mode (mounted docker volume → new MinIO):
#   ./scripts/storage-migrate.sh --mode=volume --volume-path=/var/lib/supabase/storage
#
#   # Dry-run (show what would be copied):
#   ./scripts/storage-migrate.sh --mode=s3 --dry-run
#
# Required env vars:
#   MINIO_ENDPOINT          — e.g. http://minio:9000
#   MINIO_ACCESS_KEY        — MinIO access key
#   MINIO_SECRET_KEY        — MinIO secret key
#
# For S3 mode also:
#   SUPABASE_S3_ENDPOINT    — Old Supabase S3 endpoint
#   SUPABASE_S3_ACCESS_KEY  — Old Supabase Storage S3 key
#   SUPABASE_S3_SECRET_KEY  — Old Supabase Storage S3 secret
#
# For volume mode:
#   --volume-path           — Path to mounted Supabase Storage volume
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[storage-migrate]${NC} $*"; }
warn() { echo -e "${YELLOW}[storage-migrate]${NC} $*"; }
err()  { echo -e "${RED}[storage-migrate]${NC} $*" >&2; }
info() { echo -e "${CYAN}[storage-migrate]${NC} $*"; }

# ── Buckets to migrate ──
BUCKETS=(
  "archive-scans"
  "email-assets"
  "email-templates"
  "health-documents"
  "hero-images"
  "page-assets"
  "product-images"
  "wearable-analysis"
)

# ── Public buckets (anonymous read) ──
PUBLIC_BUCKETS=(
  "archive-scans"
  "email-assets"
  "product-images"
)

# ── Parse args ──
MODE=""
VOLUME_PATH=""
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --mode=s3)       MODE="s3" ;;
    --mode=volume)   MODE="volume" ;;
    --volume-path=*) VOLUME_PATH="${arg#*=}" ;;
    --dry-run)       DRY_RUN=true ;;
    --help|-h)
      echo "Usage: $0 --mode=<s3|volume> [--volume-path=PATH] [--dry-run]"
      exit 0
      ;;
    *) err "Unknown arg: $arg"; exit 1 ;;
  esac
done

if [[ -z "$MODE" ]]; then
  err "Specify --mode=s3 or --mode=volume"
  exit 1
fi

# ── Validate env ──
: "${MINIO_ENDPOINT:?Missing MINIO_ENDPOINT}"
: "${MINIO_ACCESS_KEY:?Missing MINIO_ACCESS_KEY}"
: "${MINIO_SECRET_KEY:?Missing MINIO_SECRET_KEY}"

if [[ "$MODE" == "s3" ]]; then
  : "${SUPABASE_S3_ENDPOINT:?Missing SUPABASE_S3_ENDPOINT for S3 mode}"
  : "${SUPABASE_S3_ACCESS_KEY:?Missing SUPABASE_S3_ACCESS_KEY for S3 mode}"
  : "${SUPABASE_S3_SECRET_KEY:?Missing SUPABASE_S3_SECRET_KEY for S3 mode}"
fi

if [[ "$MODE" == "volume" && -z "$VOLUME_PATH" ]]; then
  err "--mode=volume requires --volume-path=PATH"
  exit 1
fi

# ── Verify mc is available ──
if ! command -v mc &>/dev/null; then
  err "mc (MinIO Client) not found. Install: brew install minio/stable/mc"
  exit 1
fi

# ── Configure mc aliases ──
log "Configuring MinIO client aliases..."

mc alias set evymo-new "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api s3v4 2>/dev/null

if [[ "$MODE" == "s3" ]]; then
  mc alias set evymo-old "$SUPABASE_S3_ENDPOINT" "$SUPABASE_S3_ACCESS_KEY" "$SUPABASE_S3_SECRET_KEY" --api s3v4 2>/dev/null
fi

# ── Create buckets in MinIO if they don't exist ──
log "Creating buckets in MinIO..."
for bucket in "${BUCKETS[@]}"; do
  if mc ls "evymo-new/${bucket}" &>/dev/null; then
    info "Bucket '${bucket}' already exists"
  else
    mc mb "evymo-new/${bucket}" 2>/dev/null
    log "Created bucket: ${bucket}"
  fi
done

# ── Set public access policies ──
log "Setting bucket access policies..."
for bucket in "${PUBLIC_BUCKETS[@]}"; do
  mc anonymous set download "evymo-new/${bucket}" 2>/dev/null
  log "Set public-read on: ${bucket}"
done

# ── Migrate data ──
TOTAL_OBJECTS=0
TOTAL_ERRORS=0

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY-RUN MODE — no data will be copied"
fi

for bucket in "${BUCKETS[@]}"; do
  log "────────────────────────────────────────────"
  log "Migrating bucket: ${bucket}"

  MC_FLAGS="--overwrite --preserve"
  if [[ "$DRY_RUN" == "true" ]]; then
    MC_FLAGS="${MC_FLAGS} --dry-run"
  fi

  if [[ "$MODE" == "s3" ]]; then
    # S3-to-S3 mirror
    SOURCE="evymo-old/${bucket}"

    # Check if source bucket exists
    if ! mc ls "$SOURCE" &>/dev/null; then
      warn "Source bucket '${bucket}' not found — skipping"
      continue
    fi

    OBJECT_COUNT=$(mc ls --recursive "$SOURCE" 2>/dev/null | wc -l | tr -d ' ')
    info "Objects in source: ${OBJECT_COUNT}"

    if [[ "$OBJECT_COUNT" -eq 0 ]]; then
      info "Empty bucket — skipping"
      continue
    fi

    mc mirror ${MC_FLAGS} "$SOURCE" "evymo-new/${bucket}" 2>&1 | tail -5
    TOTAL_OBJECTS=$((TOTAL_OBJECTS + OBJECT_COUNT))

  elif [[ "$MODE" == "volume" ]]; then
    # Local volume → S3
    LOCAL_PATH="${VOLUME_PATH}/${bucket}"

    if [[ ! -d "$LOCAL_PATH" ]]; then
      warn "Local path '${LOCAL_PATH}' not found — skipping"
      continue
    fi

    OBJECT_COUNT=$(find "$LOCAL_PATH" -type f | wc -l | tr -d ' ')
    info "Files in volume: ${OBJECT_COUNT}"

    if [[ "$OBJECT_COUNT" -eq 0 ]]; then
      info "Empty directory — skipping"
      continue
    fi

    mc mirror ${MC_FLAGS} "$LOCAL_PATH" "evymo-new/${bucket}" 2>&1 | tail -5
    TOTAL_OBJECTS=$((TOTAL_OBJECTS + OBJECT_COUNT))
  fi

  # Verify count in destination
  DEST_COUNT=$(mc ls --recursive "evymo-new/${bucket}" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$DRY_RUN" != "true" ]]; then
    log "Objects in destination: ${DEST_COUNT}"
    if [[ "$OBJECT_COUNT" -ne "$DEST_COUNT" ]]; then
      err "COUNT MISMATCH for ${bucket}: source=${OBJECT_COUNT} dest=${DEST_COUNT}"
      ((TOTAL_ERRORS++))
    fi
  fi
done

# ── Summary ──
log "════════════════════════════════════════════"
log "Migration complete."
log "  Total objects processed: ${TOTAL_OBJECTS}"
log "  Buckets: ${#BUCKETS[@]}"
if [[ "$TOTAL_ERRORS" -gt 0 ]]; then
  err "  ERRORS: ${TOTAL_ERRORS} bucket(s) with count mismatch!"
  exit 1
else
  log "  Errors: 0"
fi
if [[ "$DRY_RUN" == "true" ]]; then
  warn "  (dry-run — nothing was actually copied)"
fi
