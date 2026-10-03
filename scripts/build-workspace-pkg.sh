#!/bin/sh
# =============================================================================
# scripts/build-workspace-pkg.sh — compile a packages/<name> dir to dist/ + JS
# =============================================================================
# Upstream's `packages/<name>/package.json` ships `main: "./src/index.ts"` (raw
# TypeScript source). That works in development monorepos with tsx/ts-node, but
# breaks production Docker builds where services run `node dist/server.js` and
# hit `import '@aisha/security'` → resolves to `.ts` → node can't load TS.
#
# This script:
#   1. Installs the package's deps (including tsc as devDep) inside its dir
#   2. Compiles src/*.ts → dist/*.js using --noEmit false
#   3. Rewrites package.json main/types/exports to point at compiled output
#
# Called from service Dockerfiles BEFORE the service's own `npm install` so
# the file:./packages/<name> install sees the compiled output.
#
# Upstream PR pending (task #19/#20) — once landed, this script becomes
# obsolete and Dockerfiles can drop it.
#
# Usage: scripts/build-workspace-pkg.sh <path-to-package-dir>
#        scripts/build-workspace-pkg.sh ./packages/security
# =============================================================================
set -eu

PKG_DIR="${1:?missing package dir}"

if [ ! -d "$PKG_DIR/src" ]; then
  echo "[build-workspace-pkg] $PKG_DIR has no src/ — skipping"
  exit 0
fi
if [ ! -f "$PKG_DIR/package.json" ]; then
  echo "[build-workspace-pkg] $PKG_DIR has no package.json — skipping"
  exit 0
fi

echo "[build-workspace-pkg] compiling $PKG_DIR"

cd "$PKG_DIR"

# 0. Drop test sources before the PRODUCTION compile. Balíkový tsconfig má
#    `include: src/**/*`, takže by typoval i __tests__/ — a do běhového obrazu
#    testy stejně nepatří.
#
#    ⚠️ Fork tu měl jako důvod „naše lokální rozšíření typu v cors.ts se
#    záměrně rozchází s tvrzeními upstreamových testů". Nahoře je to obrácené:
#    tyhle testy JSOU naše. Mazat test, aby prošel překlad, by bylo tiché
#    přeskočení, ne oprava. Platí jen ten první důvod: produkční obraz testy
#    nevozí.
#
#    Cesta je relativní k PKG_DIR, který je fail-closed ověřený výš
#    (${1:?…} + test -d src + test -f package.json), takže `cd` výš nemůže
#    skončit jinde. DRY_RUN respektujeme, jak předepisuje brána
#    destructive-ops-dry-run-coverage.
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "[DRY RUN] rm -rf $PKG_DIR/src/__tests__ (+ vnořené)"
else
  rm -rf src/__tests__ src/**/__tests__ 2>/dev/null || true
fi

# 1. Install deps (including devDeps for typescript)
npm install --no-audit --no-fund --include=dev --ignore-scripts

# 2. Compile src/ → dist/ overriding tsconfig's noEmit
#    --listFilesOnly off, --noEmit off, --outDir dist
#    Use the package's existing tsconfig as a base; override emit settings.
TSCONFIG="tsconfig.json"
if [ ! -f "$TSCONFIG" ]; then
  echo "[build-workspace-pkg] no tsconfig.json in $PKG_DIR — using defaults"
  npx --no-install tsc \
    --module ES2022 --moduleResolution Bundler --target ES2022 \
    --esModuleInterop --skipLibCheck --declaration \
    --outDir dist src/*.ts
else
  # Some packages have tsconfig with noEmit:true; we override.
  npx --no-install tsc --project "$TSCONFIG" --noEmit false --outDir dist
fi

# 3. Rewrite package.json so consumers find compiled output via file: refs.
#    Use node (we just installed everything; node is available).
node -e "
const fs = require('fs');
const path = require('path');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Update main + types to compiled output
p.main = './dist/index.js';
p.types = './dist/index.d.ts';

// Rebuild exports map: every entry that pointed at ./src/X.ts now points at ./dist/X.js
if (p.exports && typeof p.exports === 'object') {
  const newExports = {};
  for (const [key, value] of Object.entries(p.exports)) {
    if (typeof value === 'string') {
      newExports[key] = value.replace(/^\.\/src\//, './dist/').replace(/\.ts\$/, '.js');
    } else if (value && typeof value === 'object') {
      const sub = {};
      for (const [cond, target] of Object.entries(value)) {
        if (typeof target === 'string') {
          sub[cond] = target
            .replace(/^\.\/src\//, './dist/')
            .replace(/\.ts\$/, cond === 'types' ? '.d.ts' : '.js');
        } else {
          sub[cond] = target;
        }
      }
      newExports[key] = sub;
    } else {
      newExports[key] = value;
    }
  }
  p.exports = newExports;
}

fs.writeFileSync('package.json', JSON.stringify(p, null, 2));
console.log('[build-workspace-pkg] rewrote main → ' + p.main);
"

echo "[build-workspace-pkg] ✓ $PKG_DIR compiled to dist/"
