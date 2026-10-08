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

# Release repository (issues, wiki, checksums, release downloads) — the FULL URL
# of the workbench release repo on your git host. product.json gets it through
# envsubst. No default: the address is a property of the installation, not code.
export RELEASE_REPO="${RELEASE_REPO:?RELEASE_REPO must be set (full URL of the workbench release repo, e.g. https://github.com/<org>/aisha-workbench)}"

# Upstream VSCodium ref to build from
# Update this when adopting a new VS Code version
# Tag format: major.minor.patchBUILD (e.g. 1.112.01907)
# List tags: git ls-remote --tags https://github.com/VSCodium/vscodium.git | tail -20
export VSCODIUM_REPO="https://github.com/VSCodium/vscodium.git"
export VSCODIUM_REF="1.112.01907"

# Disable Microsoft telemetry
export DISABLE_TELEMETRY="yes"
