#!/bin/bash
#
# bump-version.sh - Version bumping for AISHA Dirigent
#
# Usage:
#   ./scripts/bump-version.sh patch    # 1.0.0 -> 1.0.1 (bugfix)
#   ./scripts/bump-version.sh minor    # 1.0.0 -> 1.1.0 (new feature)
#   ./scripts/bump-version.sh major    # 1.0.0 -> 2.0.0 (breaking change)
#   ./scripts/bump-version.sh build    # Only bumps build number (default)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
# ⭐ PROFIL INSTANCE, ne soubor platformy — poslední z pěti skriptů, které si
# identitu zjišťovaly po svém (2026-08-19). Bez toho by `--bump` zvedl verzi
# PLATFORMĚ, zatímco build by běžel nad profilem instance: dvě evidence o téže
# appce, a rozdíl by se poznal až v obchodě.
. "$SCRIPT_DIR/app-profile.sh"
PACKAGE_JSON="$PROJECT_DIR/package.json"

BUMP_TYPE="${1:-build}"

echo "Version Bump: $BUMP_TYPE"
echo "========================"

if [ ! -f "$VERSION_FILE" ]; then
    echo "[error] version.json not found"
    exit 1
fi

CURRENT_VERSION=$(cat "$VERSION_FILE" | grep '"version"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
CURRENT_BUILD=$(cat "$VERSION_FILE" | grep '"build"' | head -1 | sed 's/.*: \([0-9]*\).*/\1/')

echo "Current: v$CURRENT_VERSION (build $CURRENT_BUILD)"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP_TYPE" in
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0; NEW_BUILD=$((CURRENT_BUILD + 1)) ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0; NEW_BUILD=$((CURRENT_BUILD + 1)) ;;
    patch) PATCH=$((PATCH + 1)); NEW_BUILD=$((CURRENT_BUILD + 1)) ;;
    build) NEW_BUILD=$((CURRENT_BUILD + 1)) ;;
    *)     echo "[error] Unknown bump type: $BUMP_TYPE (use: major, minor, patch, build)"; exit 1 ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
# ⛔ BYLO "$MAJOR.$MINOR" — SKRIPT SI SÁM ROZBÍJEL TO, CO BRÁNA HLÍDÁ.
# Z 1.0.11 udělal marketingVersion 1.0, takže `version` (1.0.11),
# `ios.marketingVersion` (1.0) a `android.versionName` (1.0.11) se rozešly.
# `app.config.ts` z marketingVersion staví CFBundleShortVersionString, takže by
# archiv odešel s JINOU verzí, než říká evidence — přesně ta vada, kvůli které
# `check-version-consistency.mjs` vznikl (viz jeho hlavička, případ 1.0.10).
# Naměřeno 2026-08-19 při srovnávání build 13 vs 14.
NEW_MARKETING_VERSION="$NEW_VERSION"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

echo "New:     v$NEW_VERSION (build $NEW_BUILD)"

node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('$VERSION_FILE', 'utf8'));

  data.version = '$NEW_VERSION';
  data.build = $NEW_BUILD;
  data.lastUpdated = '$TIMESTAMP';

  data.ios.marketingVersion = '$NEW_MARKETING_VERSION';
  data.ios.buildNumber = $NEW_BUILD;

  data.android.versionCode = $NEW_BUILD;
  data.android.versionName = '$NEW_VERSION';

  fs.writeFileSync('$VERSION_FILE', JSON.stringify(data, null, 2) + '\n');
"
echo "[ok] version.json updated"

if [ -f "$PACKAGE_JSON" ]; then
    # ⛔ `package.json` JE SOUBOR PLATFORMY, ne instance. Když se zvedá verze
    # INSTANČNÍHO profilu (AISHA_APP_VERSION_FILE), nesmí se do něj sáhnout —
    # jinak tam přistane verze appky zákazníka (naměřeno 2026-08-19: bump
    # riq.version.json zapsal do platformy 1.0.11 místo jejího 1.0.0). Byla by
    # to táž vada jako ikona přepisující assety platformy: instanční identita
    # v cizím stromě, kterou nikdo nečeká.
    if [ -n "${AISHA_APP_VERSION_FILE:-}" ]; then
      echo "[info] package.json PŘESKOČEN — bump instančního profilu se stromu platformy nedotýká"
    else
      node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$PACKAGE_JSON', 'utf8'));
        pkg.version = '$NEW_VERSION';
        fs.writeFileSync('$PACKAGE_JSON', JSON.stringify(pkg, null, 2) + '\n');
      "
      echo "[ok] package.json updated"
    fi
fi

echo ""
echo "========================"
echo "[ok] Version bumped to v$NEW_VERSION (build $NEW_BUILD)"
echo ""
echo "Next steps:"
echo "  1. Update changelog in version.json if needed"
echo "  2. Commit: git commit -am 'chore: bump version to $NEW_VERSION ($NEW_BUILD)'"
