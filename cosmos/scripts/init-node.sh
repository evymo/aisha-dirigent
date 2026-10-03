#!/bin/bash
# init-node.sh — Initialize and start the AISHA Cosmos node
#
# This script:
# 1. Initializes the node if not already done
# 2. Imports the backend signer key if COSMOS_SIGNER_MNEMONIC is set
# 3. Configures genesis with AISHA token denominations
# 4. Starts CometBFT + Cosmos app
#
# Environment variables:
# - CHAIN_ID: Chain identifier (default: aisha-1)
# - MONIKER: Node moniker (default: aisha-validator)
# - COSMOS_SIGNER_MNEMONIC: Backend signer mnemonic (for key import)
# - MINIMUM_GAS_PRICES: Minimum gas prices (default: 0.025uash)
set -euo pipefail

CHAIN_ID="${CHAIN_ID:-aisha-1}"
MONIKER="${MONIKER:-aisha-validator}"
HOME_DIR="/root/.aisha"
MINIMUM_GAS_PRICES="${MINIMUM_GAS_PRICES:-0.025uash}"

echo "=== AISHA Cosmos Node Init ==="
echo "Chain ID: ${CHAIN_ID}"
echo "Moniker:  ${MONIKER}"

# ── Force re-init if config is corrupted (e.g. duplicate TOML keys from old init) ──
if [ -f "${HOME_DIR}/config/app.toml" ]; then
  DUPES=$(awk '/^\[/{section=$0; next} /^enable/{count[section]++} END{for(s in count) if(count[s]>1) print s}' "${HOME_DIR}/config/app.toml" 2>/dev/null || true)
  if [ -n "${DUPES}" ]; then
    echo ">>> Detected duplicate TOML keys in app.toml — removing data dir for clean init..."
    rm -rf "${HOME_DIR}"
  fi
fi

# ── Initialize if first run ───────────────────────────────────
if [ ! -f "${HOME_DIR}/config/genesis.json" ]; then
  echo ">>> First run — initializing chain..."

  aishad init "${MONIKER}" --chain-id "${CHAIN_ID}" --home "${HOME_DIR}"

  # ── Configure genesis ─────────────────────────────────────
  GENESIS="${HOME_DIR}/config/genesis.json"

  # Set native denom to uash (micro-AISHA)
  jq '.app_state.staking.params.bond_denom = "uash"' "$GENESIS" > /tmp/genesis.json && mv /tmp/genesis.json "$GENESIS"
  jq '.app_state.crisis.constant_fee.denom = "uash"' "$GENESIS" > /tmp/genesis.json && mv /tmp/genesis.json "$GENESIS"
  jq '.app_state.mint.params.mint_denom = "uash"' "$GENESIS" > /tmp/genesis.json && mv /tmp/genesis.json "$GENESIS"
  jq '.app_state.gov.params.min_deposit[0] = {"denom": "uash", "amount": "10000000"}' "$GENESIS" > /tmp/genesis.json && mv /tmp/genesis.json "$GENESIS"

  # Governance params: 2-day voting, 1-day deposit
  jq '.app_state.gov.params.voting_period = "172800s"' "$GENESIS" > /tmp/genesis.json && mv /tmp/genesis.json "$GENESIS"
  jq '.app_state.gov.params.max_deposit_period = "86400s"' "$GENESIS" > /tmp/genesis.json && mv /tmp/genesis.json "$GENESIS"

  # Add ugovernance as secondary denom (governance token)
  # This is registered as a module account token — no minting by end users

  # ── Create validator key ──────────────────────────────────
  aishad keys add validator --keyring-backend test --home "${HOME_DIR}" 2>&1 | tail -1

  # Genesis account with initial supply
  VALIDATOR_ADDR=$(aishad keys show validator -a --keyring-backend test --home "${HOME_DIR}")
  aishad genesis add-genesis-account "${VALIDATOR_ADDR}" "1000000000000uash,1000000000000ugovernance" --home "${HOME_DIR}"

  # Create genesis transaction
  aishad genesis gentx validator "500000000000uash" \
    --chain-id "${CHAIN_ID}" \
    --moniker "${MONIKER}" \
    --keyring-backend test \
    --home "${HOME_DIR}"

  aishad genesis collect-gentxs --home "${HOME_DIR}"

  # Validate genesis
  aishad genesis validate --home "${HOME_DIR}"

  echo ">>> Chain initialized successfully"
fi

# ── Import backend signer key ─────────────────────────────────
if [ -n "${COSMOS_SIGNER_MNEMONIC:-}" ]; then
  echo ">>> Importing backend signer key..."
  echo "${COSMOS_SIGNER_MNEMONIC}" | aishad keys add backend-signer \
    --recover \
    --keyring-backend test \
    --home "${HOME_DIR}" 2>/dev/null || true

  SIGNER_ADDR=$(aishad keys show backend-signer -a --keyring-backend test --home "${HOME_DIR}" 2>/dev/null || echo "")
  if [ -n "${SIGNER_ADDR}" ]; then
    echo "    Signer address: ${SIGNER_ADDR}"
  fi
fi

# ── Configure node ────────────────────────────────────────────
CONFIG="${HOME_DIR}/config/config.toml"
APP_CONFIG="${HOME_DIR}/config/app.toml"

# Enable LCD/REST API (required by edge functions) — target [api] section only
sed -i '/^\[api\]/,/^\[/{s/enable = false/enable = true/}' "${APP_CONFIG}" 2>/dev/null || true
sed -i "s/minimum-gas-prices = \"\"/minimum-gas-prices = \"${MINIMUM_GAS_PRICES}\"/g" "${APP_CONFIG}" 2>/dev/null || true

# Enable gRPC — target [grpc] section only
sed -i '/^\[grpc\]/,/^\[/{s/enable = false/enable = true/}' "${APP_CONFIG}" 2>/dev/null || true

# Allow external connections (for Docker networking)
sed -i 's/laddr = "tcp:\/\/127.0.0.1:26657"/laddr = "tcp:\/\/0.0.0.0:26657"/g' "${CONFIG}" 2>/dev/null || true
sed -i 's/address = "tcp:\/\/localhost:1317"/address = "tcp:\/\/0.0.0.0:1317"/g' "${APP_CONFIG}" 2>/dev/null || true
sed -i 's/address = "localhost:9090"/address = "0.0.0.0:9090"/g' "${APP_CONFIG}" 2>/dev/null || true

echo "=== Starting AISHA node ==="
exec aishad start --home "${HOME_DIR}" --minimum-gas-prices "${MINIMUM_GAS_PRICES}"
