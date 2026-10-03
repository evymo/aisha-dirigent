#!/usr/bin/env bash
# =============================================================================
# train-lora.sh — MLX LoRA fine-tuning for Apple Silicon
#
# Trains a LoRA adapter on JSONL data using mlx-lm.
# Designed for integration with WF_FINE_TUNE_JOB n8n workflow.
#
# Usage:
#   ./scripts/ai/train-lora.sh \
#     --data /path/to/train.jsonl \
#     --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit \
#     --output /path/to/adapters/my-adapter \
#     [--rank 8] [--alpha 16] [--epochs 3] [--lr 1e-4] [--batch 4]
#
# Environment:
#   AISHA_POSTGREST_URL, AISHA_POSTGREST_SERVICE_KEY — for status updates
#   TRAINING_JOB_ID — optional: updates training_jobs table on completion
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Defaults ---
MODEL="mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"
RANK=8
ALPHA=16
EPOCHS=3
LR="1e-4"
BATCH=4
MAX_SEQ_LENGTH=2048
DATA=""
OUTPUT=""

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --data)       DATA="$2";       shift 2 ;;
    --model)      MODEL="$2";      shift 2 ;;
    --output)     OUTPUT="$2";     shift 2 ;;
    --rank)       RANK="$2";       shift 2 ;;
    --alpha)      ALPHA="$2";      shift 2 ;;
    --epochs)     EPOCHS="$2";     shift 2 ;;
    --lr)         LR="$2";        shift 2 ;;
    --batch)      BATCH="$2";      shift 2 ;;
    --max-seq)    MAX_SEQ_LENGTH="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --data FILE --output DIR [options]"
      echo "  --data     JSONL training file (required)"
      echo "  --output   Output adapter directory (required)"
      echo "  --model    Base model (default: $MODEL)"
      echo "  --rank     LoRA rank (default: $RANK)"
      echo "  --alpha    LoRA alpha (default: $ALPHA)"
      echo "  --epochs   Training epochs (default: $EPOCHS)"
      echo "  --lr       Learning rate (default: $LR)"
      echo "  --batch    Batch size (default: $BATCH)"
      echo "  --max-seq  Max sequence length (default: $MAX_SEQ_LENGTH)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Validate ---
if [[ -z "$DATA" ]]; then
  echo "ERROR: --data is required"
  exit 1
fi

if [[ -z "$OUTPUT" ]]; then
  echo "ERROR: --output is required"
  exit 1
fi

if [[ ! -f "$DATA" ]]; then
  echo "ERROR: Training data file not found: $DATA"
  exit 1
fi

# Check for Apple Silicon
if [[ "$(uname -m)" != "arm64" ]] || [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: MLX LoRA training requires Apple Silicon (M1+)"
  exit 1
fi

# --- Ensure venv ---
VENV_DIR="${SCRIPT_DIR}/.venv"
if [[ ! -d "$VENV_DIR" ]]; then
  echo "Setting up Python virtual environment..."
  python3 -m venv "$VENV_DIR"
fi
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

# Ensure mlx-lm is installed
if ! python3 -c "import mlx_lm" 2>/dev/null; then
  echo "Installing mlx-lm..."
  pip install -q mlx-lm
fi

# --- Count training examples ---
EXAMPLE_COUNT=$(wc -l < "$DATA" | tr -d ' ')
echo "Training data: $EXAMPLE_COUNT examples from $DATA"
echo "Base model:    $MODEL"
echo "LoRA config:   rank=$RANK alpha=$ALPHA lr=$LR epochs=$EPOCHS batch=$BATCH"
echo "Output:        $OUTPUT"

# --- Create output dir ---
mkdir -p "$OUTPUT"

# --- Split train/eval (90/10) ---
TRAIN_FILE="${OUTPUT}/train.jsonl"
EVAL_FILE="${OUTPUT}/eval.jsonl"
SPLIT_LINE=$(( EXAMPLE_COUNT * 9 / 10 ))

head -n "$SPLIT_LINE" "$DATA" > "$TRAIN_FILE"
tail -n "+$((SPLIT_LINE + 1))" "$DATA" > "$EVAL_FILE"

TRAIN_COUNT=$(wc -l < "$TRAIN_FILE" | tr -d ' ')
EVAL_COUNT=$(wc -l < "$EVAL_FILE" | tr -d ' ')
echo "Split: $TRAIN_COUNT train / $EVAL_COUNT eval"

# --- Update job status if TRAINING_JOB_ID set ---
update_job_status() {
  local status="$1"
  local extra="${2:-}"
  if [[ -n "${TRAINING_JOB_ID:-}" ]] && [[ -n "${AISHA_POSTGREST_URL:-}" ]] && [[ -n "${AISHA_POSTGREST_SERVICE_KEY:-}" ]]; then
    local payload="{\"p_job_id\": \"$TRAINING_JOB_ID\", \"p_status\": \"$status\""
    if [[ -n "$extra" ]]; then
      payload="$payload, $extra"
    fi
    payload="$payload}"
    curl -sS -o /dev/null -w '' \
      "${AISHA_POSTGREST_URL}/rest/v1/rpc/fn_update_training_job_status" \
      -H "apikey: ${AISHA_POSTGREST_SERVICE_KEY}" \
      -H "Authorization: Bearer ${AISHA_POSTGREST_SERVICE_KEY}" \
      -H "Content-Type: application/json" \
      -d "$payload" 2>/dev/null || true
  fi
}

update_job_status "training"
START_TIME=$(date +%s)

# --- Run LoRA training ---
echo ""
echo "Starting LoRA training..."
echo "---"

python3 -m mlx_lm.lora \
  --model "$MODEL" \
  --data "$OUTPUT" \
  --adapter-path "${OUTPUT}/adapters" \
  --train \
  --num-layers "$RANK" \
  --lora-parameters "{\"rank\": $RANK, \"alpha\": $ALPHA, \"scale\": $(echo "scale=$ALPHA/$RANK" | bc -l)}" \
  --batch-size "$BATCH" \
  --iters "$((EPOCHS * TRAIN_COUNT / BATCH))" \
  --learning-rate "$LR" \
  --max-seq-length "$MAX_SEQ_LENGTH" \
  --save-every 100 \
  --test \
  2>&1 | tee "${OUTPUT}/training.log"

TRAIN_EXIT=$?
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "---"
echo "Training completed in ${DURATION}s (exit: $TRAIN_EXIT)"

if [[ $TRAIN_EXIT -ne 0 ]]; then
  update_job_status "failed" "\"p_error\": \"Training exited with code $TRAIN_EXIT\""
  exit $TRAIN_EXIT
fi

# --- Extract final metrics from log ---
TRAIN_LOSS=$(grep -oP 'Train Loss: \K[\d.]+' "${OUTPUT}/training.log" | tail -1 || echo "N/A")
EVAL_LOSS=$(grep -oP 'Val Loss: \K[\d.]+' "${OUTPUT}/training.log" | tail -1 || echo "N/A")

echo ""
echo "Final metrics:"
echo "  Train loss: $TRAIN_LOSS"
echo "  Eval loss:  $EVAL_LOSS"
echo "  Duration:   ${DURATION}s"
echo "  Adapter:    ${OUTPUT}/adapters"

# --- Save metadata ---
cat > "${OUTPUT}/metadata.json" <<EOF
{
  "base_model": "$MODEL",
  "adapter_type": "lora",
  "lora_rank": $RANK,
  "lora_alpha": $ALPHA,
  "learning_rate": "$LR",
  "epochs": $EPOCHS,
  "batch_size": $BATCH,
  "max_seq_length": $MAX_SEQ_LENGTH,
  "train_examples": $TRAIN_COUNT,
  "eval_examples": $EVAL_COUNT,
  "train_loss": "$TRAIN_LOSS",
  "eval_loss": "$EVAL_LOSS",
  "duration_seconds": $DURATION,
  "trained_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "data_source": "$DATA"
}
EOF

# --- Update job status ---
update_job_status "completed" "\"p_metrics\": {\"train_loss\": \"$TRAIN_LOSS\", \"eval_loss\": \"$EVAL_LOSS\", \"duration_seconds\": $DURATION, \"train_examples\": $TRAIN_COUNT}, \"p_output_path\": \"${OUTPUT}/adapters\""

echo ""
echo "LoRA training complete. Adapter saved to: ${OUTPUT}/adapters"
