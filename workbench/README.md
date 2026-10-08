# AISHA Workbench

Plnohodnotné IDE prostředí postavené na [VSCodium](https://github.com/VSCodium/vscodium) pro Evymo AISHA platformu.

## Proč vlastní IDE — ne jen extension?

`aisha-dirigent` extension funguje jako plugin do VS Code / Cursor / jiných IDE. To je záměr — ukazuje co AISHA umí, a slouží vývojářům jako konzultant.

**AISHA Workbench je víc.** Je to celé prostředí, kde:

- **Warmup** = IDE-level onboarding — autodetekce prostředí (Docker, Supabase, Ollama, n8n...), konfigurace backendu, prvotní auth. Není to "extension walkthrough", je to nativní součást IDE.
- **Dashboardy** = vestavěné nebo nad Appsmith/NocoDB — KPI, story přehled, backend health — přímo v IDE, ne v browseru.
- **Story-driven workflow** = celé IDE je centrum práce na stories — chat, knowledge, deploy, preview, vše na jednom místě.
- **Operator Desk** = custom sidebar, status bar, panels — role-based UX (beginner / expert / developer / admin).

Extension (`aisha-dirigent`) je **jeden z modulů** co Workbench bundluje. Slouží jako:
1. Ukázka — "takhle to vypadá" i v cizím IDE
2. Content provider — warmup flow načítá data z extension commands
3. Portable subset — kdo nechce celé IDE, vezme si jen extension

## Architektura

```
workbench/                          # IDE build infrastructure
├── product.json                    # Brand overlay (merged on top of VS Code's)
├── utils.sh                        # Build env overrides (APP_NAME etc.)
├── build.sh                        # Main build orchestrator
├── build/
│   ├── generate_icons.sh           # SVG → PNG/ICNS/ICO pipeline
│   └── install_bundled_extensions.sh
├── icons/stable/                   # Master SVG source
├── src/stable/resources/           # Platform icons (generated)
│   ├── darwin/code.icns
│   ├── linux/code-icons/*.png
│   └── win32/code.ico
├── patches/                        # Custom patches applied to VS Code source
├── bundled-extensions/             # Optional extra .vsix files to pre-install
├── resources/fonts/nunito-sans/    # Brand typography (Nunito Sans, OFL)
└── (CI: GitHub Actions, .github/workflows/)

extensions/aisha-dirigent/          # AISHA Core Extension (source of truth)
├── src/                            # Veškerá logika — auth, story, LLM, chat, warmup
├── media/walkthrough/              # SVG assety pro warmup/welcome screeny
└── package.json                    # Commands, views, walkthrough contributions

packages/workbench-core/            # Sdílená logika (auth adaptery, typy, profily)
```

### Princip: Extension = SoT, Workbench = runtime

```
AISHA Workbench (IDE)
  ├── bundluje extensions/aisha-dirigent.vsix
  ├── bundluje případné další extensions (themes, language packs)
  ├── IDE-level warmup (nad extension walkthrough API)
  ├── IDE-level dashboardy (Webview panels, Appsmith embeds)
  └── IDE-level branding (product.json, ikony, fonty)

extensions/aisha-dirigent (Extension = Source of Truth)
  ├── Warmup UI content (SVG, kroky, detekce)
  ├── Auth adapter logika (workbench-core)
  ├── Story Loop, Chat, Knowledge, LLM discovery
  └── Funguje samostatně i v VS Code/Cursor
```

## Build

### Prerequisites

- Node.js 20+ (VSCodium 1.112 vyžaduje **22+**)
- jq, git, python3
- librsvg (`rsvg-convert`), icoutils (`icotool`)
- macOS: Xcode Command Line Tools + `iconutil`
- **`RELEASE_REPO`** (plná URL release repa workbenche, např.
  `https://github.com/<org>/aisha-workbench`) — bez ní build spadne na PRVNÍM
  řádku (`utils.sh`: `RELEASE_REPO must be set`). Odmítá dosadit výchozí
  hodnotu záměrně: adresa je vlastnost instalace, ne kódu.

### Local build

```bash
# Generate platform icons from SVG
bash build/generate_icons.sh

# Build for current platform
RELEASE_REPO=https://git.example.com/acme/aisha-workbench ./build.sh

# Build for specific platform
RELEASE_REPO=https://git.example.com/acme/aisha-workbench ./build.sh --platform linux --arch x64
RELEASE_REPO=https://git.example.com/acme/aisha-workbench ./build.sh --platform osx --arch arm64

# Opakovaný build nad už staženým VSCodiem (ušetří ~10 min klonování)
RELEASE_REPO=https://git.example.com/acme/aisha-workbench ./build.sh --platform osx --arch arm64 --skip-clone
```

Výstup: `workbench/artifacts/` (macOS `.zip`, Linux `.tar.gz`/`.deb`, Windows `.exe`).
Sbalená aplikace navíc zůstává v `vscodium/VSCode-<platform>-<arch>/`.

### ⚠️ Patche nad VSCodiem

`workbench/patches/*.patch` se kopírují do `vscodium/patches/` a aplikuje je
`prepare_vscode.sh`. **Ruční editace `vscodium/vscode/` nepřežije** — ten strom
se před každým buildem resetuje, takže oprava, která není patchem, zmizí.

Aktuální patche:

| patch | proč existuje |
|---|---|
| `policy-nls-open-vsx-tolerant.patch` | VSCode generátor politik si tahá jazykové balíčky z **Microsoft Marketplace API** (`POST /extensionquery`), jenže VSCodium míří galerii na **Open VSX**. Ten dotaz proto nemůže uspět nikdy a shodí build ještě před generováním politik. Patch drží vzorec, který si ten soubor sám stanovil výš (`Skipping policy localization` + pokračovat), jen po jednotlivých jazycích. Následek: šablony politik zůstanou anglicky — aplikace ani `.zip` se to netýká. |

### CI

GitHub Actions workflow (`.github/workflows/`):
- Linux x64 on every push to `main`
- macOS arm64/x64 on tags (`v*`)
- Manual trigger via `workflow_dispatch`

## Bundling AISHA Core Extension

Extension se buildí v monorepu a bundluje do Workbench automaticky. Jediný zdroj pravdy je `extensions/aisha-dirigent`; Workbench build si z něj vždy vytvoří aktuální VSIX přes stejný skript jako e2e testy.

1. Build `aisha-dirigent` extension:
   ```bash
  npm run ext:build:force
   ```
2. Workbench build spustí `tests/e2e-dirigent/scripts/build-extension-vsix.mjs`
3. Aktuální `tests/e2e-dirigent/.artifacts/aisha-dirigent.vsix` se pre-instaluje do app bundle

`workbench/bundled-extensions/` je jen pro volitelné další VSIX balíky. `aisha-dirigent` tam nepatří, aby Workbench nemohl omylem nést zastaralý login/auth flow.

**Extension zůstává source of truth** — workbench z ní čerpá, neduplikuje.

## Warmup vs Extension Walkthrough

| Aspekt | Extension Walkthrough | IDE Warmup |
|--------|----------------------|------------|
| Kde běží | VS Code / Cursor / jakékoli IDE | Pouze AISHA Workbench |
| Scope | Ukázka funkcí, základní setup | Plný onboarding + detekce prostředí |
| Dashboardy | ❌ | ✅ vestavěné + Appsmith embeds |
| Backend health | Jen status bar indikátor | Plný monitoring panel |
| Auto-detekce | Omezená (porty) | Plná (Docker, services, AI modely) |
| Role management | ❌ | ✅ beginner/expert/developer/admin |

## Design System

| Token | Value | Usage |
|-------|-------|-------|
| Navy | `#162032` | Primary background |
| Orange | `#FF6A1A` | CTA, accents, AISHA eyes |
| Gold | `#C4A24E` | Premium highlights |
| Ink | `#1A1A1A` | Icon backgrounds |
| Font | Nunito Sans | Headlines + UI |

## License

Proprietary — Evymo s.r.o.
