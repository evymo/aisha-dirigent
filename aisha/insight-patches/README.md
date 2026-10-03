# AISHA Insight Patches

Vendoring-with-patches pattern (Debian/Yocto/Buildroot style) pro AISHA-specific
úpravy na submodulu `packages/insight/`, pinnutém na náš fork
[aisha/insight](https://repo.id3a.cz/aisha/insight)
(upstream: [AlquistAI/insight](https://github.com/AlquistAI/insight)).

## Princip

- Submodule pinný na konkrétní commit forku `aisha/insight`. Fork nese POUZE generické,
  upstreamovatelné změny (např. `czech_folded` analyzery) — AISHA-specific úpravy
  zůstávají tady jako patche.
- Naše úpravy jsou v tomto adresáři jako numbered patch soubory (`0001-…`, `0002-…`).
- Build-time applier (`scripts/insight-patches-apply.sh` + Dockerfile multi-stage)
  patches aplikuje v lex pořadí proti čistému submodule snapshotu.
- Idempotentní: patche, které už jsou aplikované, se přeskočí (revert-check).

## Kdy přidat patch

Když chceme změnit upstream Maestro/Ragnarok/Kronos kód a:

1. Je to AISHA-specific. Generické/upstreamovatelné změny patří do fork mainu
   `aisha/insight` (a případně jako PR do `AlquistAI/insight`), ne sem.
2. Změna je malá (≤ 100 řádků), jinak je čas na vlastní service v `services/`.
3. Není to jednorázový hack — patch musí být obhajitelný i po upstream upgradu.

## Workflow — vytvoření nového patche

```bash
# 1. Edituj submodule WD (přidej/uprav soubory)
cd packages/insight
vim maestro/maestro/api/something.py

# 2. Vygeneruj patch (full diff včetně untracked přes intent-to-add)
git add -N maestro/maestro/api/something.py 2>/dev/null
git diff > /tmp/raw.patch
git reset HEAD 2>/dev/null

# 3. Wrap-ni s metadata header a ulož pod správné číslo
cd ../..
PINNED=$(cd packages/insight && git rev-parse HEAD)
NEXT_NUM=$(printf "%04d" $(($(ls aisha/insight-patches/*.patch 2>/dev/null | wc -l) + 1)))
NAME="${NEXT_NUM}-popis-zmeny"

cat > "aisha/insight-patches/${NAME}.patch" <<HEADER
# =============================================================================
# ${NAME}.patch
# =============================================================================
# Subject: <jednořádkový popis>
#
# WHY: <proč je to potřeba; co AISHA-specific to řeší>
#
# Target: aisha/insight@${PINNED}
#
# Upgrade workflow: viz aisha/insight-patches/README.md
# =============================================================================

HEADER
cat /tmp/raw.patch >> "aisha/insight-patches/${NAME}.patch"

# 4. Verify applier projde
bash scripts/insight-patches-apply.sh --reset
bash scripts/insight-patches-apply.sh --check

# 5. Commit
git add aisha/insight-patches/
git commit -m "patch(insight): ${NAME}"
```

## Workflow — upgrade upstream

```bash
# 0. Ve forku aisha/insight: fetch AlquistAI upstreamu, rebase/merge našich
#    generických commitů, push fork main (fork je jediný zdroj pinu).
# 1. Pull new fork version
cd packages/insight
git fetch origin
git checkout <new-commit-or-tag>
NEW_PINNED=$(git rev-parse HEAD)
cd ../..

# 2. Update parent submodule pointer
git add packages/insight

# 3. Test patches against new state
bash scripts/insight-patches-apply.sh --reset
bash scripts/insight-patches-apply.sh --check

# 4a. Pokud projde čistě → update Target: header v každém patchu na ${NEW_PINNED}
#     a commit.
sed -i.bak "s/^# Target: aisha\/insight@.*/# Target: aisha\/insight@${NEW_PINNED}/" \
    aisha/insight-patches/*.patch
rm -f aisha/insight-patches/*.bak
git add aisha/insight-patches/ packages/insight
git commit -m "chore(insight): bump submodule + retarget patches @ ${NEW_PINNED:0:12}"

# 4b. Pokud konflikt — fix v submodule WD, regenerate problematický patch
#     (viz workflow výše), commit.
```

## Aktuálně přítomné patche

| # | Soubor | Subject |
|---|--------|---------|
| 0001 | `0001-maestro-readiness-probe-context-gate.patch` | Maestro `/health/ready` USP integrity gate (runtime CONTEXT_ENABLED check) |

## Gate test

`src/tests/gates/insight-patches.gate.test.ts` enforce-uje:

- Submodule není dirty (žádné uncommitted lokální úpravy).
- Všechny patche v `aisha/insight-patches/*.patch` cleanly aplikují na pinný commit.
- Každý patch má `# Target: aisha/insight@<sha>` header matching submodule pin.

Spouští se automaticky v `npm run test:gates`. Pokud upstream se posunul a patche
už neaplikují, gate failne s instrukcí na upgrade workflow výše.
