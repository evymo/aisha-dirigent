#!/bin/bash
# Batch commit all remaining i18n rebrand changes
set -e
cd "$(git rev-parse --show-toplevel)"

echo "=== Starting batch commits ==="
echo "HEAD before: $(git --no-pager log -1 --format='%h %s')"

# Commit member + partner
git add src/i18n/segments/*/member.json src/i18n/segments/*/partner.json
git commit -m "refactor(i18n): rebrand member+partner.json — medical → tech platform (6 langs)" || echo "member+partner: already committed or failed"

# Commit admin
git add src/i18n/segments/*/admin.json
git commit -m "refactor(i18n): rebrand admin.json — RTN/studies → platform/clusters (6 langs)" || echo "admin: already committed or failed"

# Commit remaining segments (auth, legal, assessment, lab-tests, shop)
git add src/i18n/segments/*/auth.json src/i18n/segments/*/legal.json src/i18n/segments/*/assessment.json src/i18n/segments/*/lab-tests.json src/i18n/segments/*/shop.json
git commit -m "refactor(i18n): rebrand auth+legal+assessment+lab-tests+shop (6 langs)

Remaining i18n segments rebranded:
- auth: study→cluster, legacy brand→platform, consent text
- legal: prior operator entity→Evymo, full legal text rebrand
- assessment: Longevity Score→Health Score, symptoms→issues
- lab-tests: legacy therapy→platform usage
- shop: legacy preparations→platform tools" || echo "remaining: already committed or failed"

# E2E test files (if any)
if git diff --name-only HEAD | grep -q "^e2e/"; then
  git add e2e/ docs/FINAL_PRODUCTION_TEST_PLAN.md 2>/dev/null
  ALLOW_NEW_FILES=1 git commit -m "test(e2e): add production platform audit and services health specs" || echo "e2e: already committed or failed"
fi

echo ""
echo "=== Final state ==="
git --no-pager log --oneline -10
echo ""
echo "Remaining uncommitted:"
git --no-pager diff --stat HEAD | tail -5
echo "DONE"
