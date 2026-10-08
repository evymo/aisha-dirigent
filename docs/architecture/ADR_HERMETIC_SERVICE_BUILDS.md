# ADR: Hermetic Service Builds přes npm Workspaces (Verdaccio zachován pro externí distribuci)

**Status:** Proposed
**Date:** 2026-06-01
**Deciders:** AISHA Dirigent + maintainers (návrh vzešel z provozní zkušenosti downstream forku)
**Tags:** build, cold-start, verdaccio, workspaces, reproducibility, supply-chain

---

## Context

`@aisha/*` balíčky (`packages/*`) plní v aisha stacku **DVĚ různé role**:

| Role | Konzument | Dnes řešeno přes |
|------|-----------|------------------|
| **Build-time deps in-repo služeb** | `services/svc-*`, `gateway`, `migrate`, … | Verdaccio (`"@aisha/x": "*"`) |
| **Distribuovatelné balíčky pro externí konzumenty** | `extensions/aisha-dirigent` (VS Code rozšíření), per-stack operator Verdaccio | Verdaccio (publish workflow) |

Obě role dnes tečou stejnou cestou — **Verdaccio**:

- Služby konzumují `@aisha/*` jako `"*"` z per-stack Verdaccio (uplink na hub `npm.id3a.cz`, viz `scripts/render-per-stack-verdaccio-config.mjs`).
- `.github/workflows/aisha-packages-publish.yml` + `scripts/aisha-packages-publish.mjs` publikují `packages/*` na hub; `aisha-packages-publish.gate` chrání integritu publish-loopu.

### Problém: service buildy závisí na publish-before-build

Protože in-repo služby resolvují `@aisha/*` z registry, **jejich build závisí na tom, že publish krok proběhl dřív a registry má správnou verzi**. Když publish neproběhne / je stale / registry verzi nemá, service build padá:

```
npm error notarget No matching version found for @aisha/...
# → fallback na public npmjs.org → E404
```

To **váže cold-start reprodukovatelnost na stav registry**: from-scratch build celého stacku může selhat, **i když je veškerý kód v git tree**. Vrstva build-cache to maskuje, dokud se nebusti.

Tato křehkost se akutně projevila v downstream forku, který šel registry-free: zděděné Verdaccio Dockerfily padaly při každém cold-startu, jakmile se cache vrstva zneplatnila (např. jakákoli změna v build kontextu).

### Klíčové pozorování

Build in-repo služby **nepotřebuje registry** — `@aisha/*` zdroje jsou ve stejném git tree (`packages/*`). Registry je nutný **jen pro externí konzumenty**, kteří monorepo nevidí (rozšíření, per-operator distribuce).

## Decision

**Oddělit obě role:**

1. **In-repo SERVICE BUILDY → npm workspaces (hermetické).**
   Build kontext = repo root, `npm ci --workspace=@aisha/<svc> --include-workspace-root` resolvuje `@aisha/*` přes workspace symlinky na `packages/*`. **Build závisí jen na git tree, nula registry.** `gateway` a `svc-aisha-kronos-shim` tento vzor už používají — je in-repo ověřený.

2. **EXTERNÍ DISTRIBUCE → Verdaccio zůstává BEZE ZMĚNY.**
   Publish workflow + `aisha-packages-publish.gate` + per-stack uplink config zůstávají. Rozšíření a per-operator instance dál získávají `@aisha/*` z registry. Publish-loop se tím stává **jasně zodpovědný jen za externí distribuci**, ne za in-repo buildy.

```
                        ┌─ in-repo service buildy ──→ npm workspaces (hermetic, git-only)
  @aisha/* (packages/*) ┤
                        └─ externí konzumenti ──────→ Verdaccio publish (beze změny)
```

## Consequences

**Pozitivní:**
- **Hermetic + reprodukovatelný cold-start služeb** — žádný `notarget`; registry už není na kritické cestě service buildů.
- Publish pipeline má **jedinou jasnou zodpovědnost** (externí distribuce), ne dvojí.
- Žádná závislost na pořadí „publish-before-build" v cold-startu.

**Daň:**
- Větší per-service build kontext (celé repo vs service adresář) → pomalejší jednotlivé buildy, větší přenos kontextu.
- Všechny služby musí být workspace members + udržovaný root `package-lock.json`.
- Runtime image musí zkopírovat dep-chain workspace adresáře (vč. nested `node_modules` jako `@aisha/observability`'s `@opentelemetry/*`).

**Mitigace daně:** multi-stage build (install+build ve stage 1, slim runtime kopíruje jen node_modules + dep dist) drží runtime image malý; whole-dir COPY dep adresářů eliminuje křehkost enumerace nested node_modules.

## Migrace (jednotlivé PR)

| PR | Obsah | Pozn. |
|----|-------|-------|
| **B** | Všechny `services/*` do root `workspaces` + `package-lock.json` regen | Enabling; nerozbíjí stávající Verdaccio buildy (ty buildí z service kontextu, root workspaces nevidí) |
| **C** | Convert compose-built service Dockerfilů na workspace vzor (`gateway` jako reference) + `context: .` v compose | Verifikováno per-service buildem z čistého git checkoutu |
| **D** | Gate: žádný compose-built Dockerfile nesmí mapovat `@aisha/@evymo` na registry | Chrání proti regresi; scope = compose-built (ne stale duplikáty) |

`aisha-packages-publish.yml` + `aisha-packages-publish.gate` **zůstávají netknuté** — externí distribuce beze změny.

## Verification

Akceptační kritérium: **každá compose-built služba se postaví z čistého git checkoutu bez dostupného registry.** Cold-start (`scripts/db/verify-cold-start-apply.sh` analog pro buildy) nesmí být závislý na publish kroku pro service buildy.
