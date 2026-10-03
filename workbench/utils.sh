#!/usr/bin/env bash
# utils.sh — AISHA Workbench overrides for VSCodium build system
# Sourced by build.sh, prepare_vscode.sh etc.
# These values override VSCodium defaults.

export APP_NAME="AISHA Workbench"
export BINARY_NAME="aisha-workbench"
export ORG_NAME="Evymo"
export ASSETS_REPOSITORY="aisha/aisha-workbench"
export GH_REPO_PATH="aisha/aisha-workbench"
export QUALITY="stable"

# Forgejo-based registry (not GitHub). Set FORGEJO_BASE_URL in env before calling.
export FORGEJO_BASE_URL="${FORGEJO_BASE_URL:?FORGEJO_BASE_URL must be set (e.g. https://repo.example.com)}"
export RELEASE_REPO="${FORGEJO_BASE_URL}/aisha/aisha-workbench"

# Upstream VSCodium ref to build from
# Update this when adopting a new VS Code version
# Tag format: major.minor.patchBUILD (e.g. 1.112.01907)
# List tags: git ls-remote --tags https://github.com/VSCodium/vscodium.git | tail -20
export VSCODIUM_REPO="https://github.com/VSCodium/vscodium.git"
export VSCODIUM_REF="1.112.01907"

# Disable Microsoft telemetry
export DISABLE_TELEMETRY="yes"
