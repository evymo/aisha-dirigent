/**
 * Brána TŘÍDY: co je v prostředí NAŠE, říká efektivní topologie profilu — a řádky
 * `app:` manifestu čte pro rozhodnutí o nasazení JEN domov vlastnictví
 *
 * ⛔ ZMĚŘENO ČTENÍM 2026-10-04 (staging instance, která konzumuje sdílený Keycloak jiné
 * instance, zatímco její produkce Keycloak vlastní): studený start rozhodoval o
 * vlastnictví Keycloaku `grep '^app: *keycloak:'` nad manifestem. Manifest je ale JEDEN
 * na instanci (inventář všech prostředí), takže staging by Keycloak „vlastnil“ — založil
 * by aplikaci na doméně cizí instance a importoval realm do cizího Keycloaku. Řádky `app:`
 * přitom četlo přes dvacet míst, každé vlastním výrazem: story-init (zakládá), redeploy
 * (cíle), sdílená mapa sync-envs/deploy-init, cold-start (krok 3, rewarmup, preflight,
 * n8n, extranet, llm-gateway), ověřovač po startu, výběr stacků NetBirdu, drift-check.
 *
 * Měří se:
 *   1. JEDEN DOMOV: `scripts/lib/vlastnictvi-aplikaci.mjs` (+ shellový obal
 *      `vlastnictvi.sh`, který jen volá jeho CLI). Detektor ho v univerzu NAJDE (kotva).
 *   2. TŘÍDA: žádné čtení řádků `app:` mimo domov v `scripts/` ani `.forgejo/` (bez
 *      testů a komentářů). Výjimky jmenovitě, každá s důvodem, na ŘÁDEK; výjimka, která
 *      už v souboru není, bránu shodí; počet výjimek má strop (seznam se smí jen zmenšovat).
 *   3. SPOTŘEBITELÉ jdou přes domov a externí službu vyřadí: KC_OWNED, krok 3 a úklid
 *      sirotků studeného startu, story-init, redeploy, deploy-init, sync-envs.
 *   4. DOMOV MUTACE vrací pro externí aplikaci VLASTNÍ kód (101 ≠ držená 100) a ptá se
 *      PŘED odesláním.
 *   5. sebetest detektoru: pozitivní vzorky (tvary, které tu dřív stály) a negativní.
 *
 * CO DETEKTOR NEVIDÍ (nahlas): je řádkový — výraz složený z proměnných
 * (`new RegExp("^" + klic + ":")`) nechytí; čtení přes knihovnu, která `app:` řádky
 * vrací pod jiným jménem, taky ne. Chování (že externí služba se opravdu nezaloží,
 * nenasadí a nesmaže) měří behaviorální test nad falešným Coolify
 * (vlastnictvi-z-topologie-chovani.gate.test.ts) a unit testy domova.
 *
 * Brána nespouští podprocesy (lehká dráha).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const DOMOV = 'scripts/lib/vlastnictvi-aplikaci.mjs';
const cti = (soubor: string) => readFileSync(join(ROOT, soubor), 'utf8');

// ── univerzum: scripts/ a .forgejo/ ─────────────────────────────────────────
const PRIPONY_KODU = new Set(['.sh', '.mjs', '.cjs', '.js', '.ts', '.py', '.awk', '.yml', '.yaml']);
const PRIPONY_NEKODU = new Set(['.md', '.txt', '.json', '.css', '.html', '.svg', '.sql', '.woff2', '.example', '.tmpl', '.template', '']);
const jeTest = (cesta: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(cesta) || cesta.split('/').includes('__tests__');

function univerzum(): { kod: string[]; neznamePripony: string[] } {
  const kod: string[] = [];
  const neznamePripony: string[] = [];
  const projdi = (adresar: string) => {
    for (const e of readdirSync(adresar, { withFileTypes: true })) {
      const plna = join(adresar, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') projdi(plna);
        continue;
      }
      const rel = relative(ROOT, plna).split('\\').join('/');
      if (jeTest(rel)) continue;
      const pripona = extname(e.name);
      if (PRIPONY_KODU.has(pripona)) kod.push(rel);
      else if (!PRIPONY_NEKODU.has(pripona)) neznamePripony.push(rel);
    }
  };
  projdi(join(ROOT, 'scripts'));
  projdi(join(ROOT, '.forgejo'));
  return { kod: kod.sort(), neznamePripony };
}

/** Řádky kódu: komentář (`#`, `//`, `*`, `/*`) popisuje, nečte. */
const radkyKodu = (text: string) => text.split('\n').filter((r) => !/^\s*(#|\/\/|\*|\/\*)/.test(r));

// ── detektor: vlastní čtení řádků `app:` manifestu ──────────────────────────
const TVARY_CTENI_APP = [
  /(?<![\w-])["']?app:["']?\*\s*\)/, // větev `case`: app:*)  nebo  "app:"*)
  /\$\{\w+#+app:/, // ořez parametru: ${line#app:}
  /\^(?:\\s\*|\[\[:space:\]\]\*|\[ \\t\]\*| \*)?app:/, // kotvený výraz: ^app: (grep, awk, sed, [[ =~ ]], JS)
  /startsWith\(\s*['"`]app:/, // JS: startsWith("app:")
];

function cteniApp(text: string): string[] {
  return radkyKodu(text)
    .filter((r) => TVARY_CTENI_APP.some((t) => t.test(r)))
    .map((r) => r.trim());
}

// ── výjimky: na ŘÁDEK, s důvodem, se stropem ────────────────────────────────
type Vyjimka = { soubor: string; radek: string; duvod: string };
/**
 * Kontroly a generátory — NErozhodují o tom, co se v prostředí zakládá, nasazuje,
 * nastavuje nebo maže. Rozhodnutí o nasazení sem nepatří NIKDY (převést na domov).
 */
const VYJIMKY: Vyjimka[] = [
  {
    soubor: 'scripts/cold-start-doctor.sh',
    radek: `app_count=$(grep -cE '^app:' "$manifest" || true)`,
    duvod: 'doktor jen POČÍTÁ řádky inventáře pro výpis (prázdný manifest = nález); o nasazení nerozhoduje',
  },
  {
    soubor: 'scripts/cold-start-doctor.sh',
    radek: `done < <(grep -E '^app:' "$manifest")`,
    duvod: 'doktor ověřuje, že compose soubor KAŽDÉHO řádku inventáře v repu existuje (i externí služby — inventář je společný); nic nezakládá ani nenasazuje',
  },
  {
    soubor: 'scripts/cold-start-doctor.sh',
    radek: `if grep -qE '^app: *source-broker:' "$MANIFEST" 2>/dev/null; then`,
    duvod: 'fáze H doktora jen kontroluje konfiguraci brokeru, když ho inventář jmenuje; nic nezapisuje do Coolify',
  },
  {
    soubor: 'scripts/lib/derive-domains.mjs',
    radek: 'const m = /^app:\\s*([a-z0-9-]+):/.exec(line.trim());',
    duvod: 'kontrola POKRYTÍ inventáře topologií (checkManifestCoverage a manifestCoverageOffenders — každá aplikace musí mít adresu); domov vlastnictví importuje derive-domains, opačný import by byl kruhový',
  },
  {
    soubor: 'scripts/lib/derive-domains.mjs',
    radek: '[...text.matchAll(/^app:\\s*([a-z0-9-]+):/gm)].map((m) => m[1]),',
    duvod: 'CLI kontroly pokrytí (--check --manifest, ráčna baseline) — kontrola inventáře, ne rozhodnutí o nasazení; kruhový import jako výš',
  },
  {
    soubor: 'scripts/gen-instance-manifest.mjs',
    radek: 'const m = /^app:\\s*([a-z0-9-]+):([a-z]+):(\\S+)/.exec(line.trim());',
    duvod: 'GENERÁTOR inventáře (čte šablonu, píše manifest instance) — tvoří vstup domova, nerozhoduje podle něj',
  },
  {
    soubor: 'scripts/aisha-changed-apps.mjs',
    radek: 'const m = line.match(/^app:\\s*([a-z0-9_-]+):([a-z0-9_-]+):(\\S+?\\.yml)(?::(\\S+))?\\s*$/i);',
    duvod: 'detektor změn CI je záměrně SAMOSTATNÝ (brány ho spouštějí v pískovišti bez knihoven) a čte ŠABLONOVÝ manifest platformy, ne inventář prostředí; vlastnictví v cestě CI hlídá domov mutace',
  },
  {
    soubor: 'scripts/local-compose-gen.mjs',
    radek: 'const m = line.match(/^app:\\s*([a-z0-9_-]+):([a-z0-9_-]+):(\\S+?\\.yml)(?::(\\S+))?\\s*$/i);',
    duvod: 'vývojový nástroj pro LOKÁLNÍ docker compose — s Coolify ani s prostředím instance nepracuje',
  },
  {
    soubor: 'scripts/preflight-compose.sh',
    radek: '[[ "$_line" =~ ^app:[[:space:]]*[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+:([^[:space:]:]+) ]] || continue',
    duvod: 'rozsah VALIDACE compose při samostatném běhu (cold-start předává COMPOSE_FILES z domova); nic nenasazuje',
  },
];
const STROP_VYJIMEK = 9;

describe('vlastnictví z topologie — jeden domov čtení `app:` (brána třídy)', () => {
  const { kod, neznamePripony } = univerzum();
  const nalezy = kod.flatMap((soubor) => cteniApp(cti(soubor)).map((radek) => ({ soubor, radek })));

  it('univerzum není prázdné a nezná žádnou nečekanou příponu', () => {
    expect(kod.length).toBeGreaterThan(300);
    expect(kod).toContain(DOMOV);
    expect(neznamePripony, 'soubor s neznámou příponou — zařaď ji mezi kód, nebo ne-kód').toEqual([]);
  });

  it('kotva: detektor najde čtení v DOMOVĚ (jinak by měřil prázdno)', () => {
    expect(nalezy.filter((n) => n.soubor === DOMOV).length).toBeGreaterThan(0);
  });

  it('⛔ mimo domov žádné čtení `app:` — kromě jmenovitých výjimek', () => {
    const kryje = (v: Vyjimka, n: { soubor: string; radek: string }) => v.soubor === n.soubor && n.radek.includes(v.radek);
    const neomluvene = nalezy
      .filter((n) => n.soubor !== DOMOV && n.soubor !== 'scripts/lib/vlastnictvi.sh')
      .filter((n) => !VYJIMKY.some((v) => kryje(v, n)))
      .map((n) => `${n.soubor}: ${n.radek}`);
    expect(
      neomluvene,
      'řádky `app:` manifestu čte jen scripts/lib/vlastnictvi-aplikaci.mjs (shell: lib/vlastnictvi.sh — vlastni, externi, vlastni_aplikace).\n' +
        'Manifest je inventář VŠECH prostředí; co je v tomhle prostředí naše, říká profil (external_domain).',
    ).toEqual([]);
    const mrtve = VYJIMKY.filter((v) => !nalezy.some((n) => kryje(v, n))).map((v) => `${v.soubor}: ${v.radek}`);
    expect(mrtve, 'výjimka, která už v souboru není — smaž ji ze seznamu (seznam se smí jen zmenšovat)').toEqual([]);
  });

  it('výjimky mají důvod a strop', () => {
    expect(VYJIMKY.length, `výjimek je víc než ${STROP_VYJIMEK} — převáděj na domov, nepřidávej`).toBeLessThanOrEqual(STROP_VYJIMEK);
    for (const v of VYJIMKY) expect(v.duvod.length, `výjimka ${v.soubor} nemá důvod`).toBeGreaterThan(30);
    expect(VYJIMKY.map((v) => v.soubor)).not.toContain(DOMOV);
  });

  it('sebetest detektoru: tvary, které tu dřív stály, chytí; komentář, story: ani repo: ne', () => {
    const pozitivni = [
      `    if grep -qE '^app: *keycloak:' "$MANIFEST" 2>/dev/null; then`,
      `      app:*)    APPS+=("\${line#app:}") ;;`,
      `    const m = /^app:\\s*([a-z0-9-]+):/.exec(radek.trim());`,
      `PREFLIGHT_COMPOSE_FILES="$(awk -F: '/^app:/ { gsub(/ /,"",$4); print $4 }' "$MANIFEST")"`,
      `    case "$line" in "app:"*) ;; *) continue ;; esac`,
      `    [[ "$line" =~ ^app:[[:space:]]*([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+):(.+)$ ]] || continue`,
      `  if (line.startsWith("app:")) continue;`,
    ];
    for (const p of pozitivni) expect(cteniApp(p), p).toHaveLength(1);
    const negativni = [
      `# grep -qE '^app: *keycloak:' "$MANIFEST" — tak to bylo dřív`,
      `      story:*)  STORY_NAME="\${line#story:}" ;;`,
      `  const m = /^repo:\\s*(\\S+)/.exec(line);`,
      `  echo "app: keycloak je externí"`,
    ];
    for (const n of negativni) expect(cteniApp(n), n).toHaveLength(0);
  });
});

describe('spotřebitelé jdou přes domov a externí službu vyřadí', () => {
  const bezKom = (s: string) => radkyKodu(cti(s)).join('\n');

  it('cold-start: vlastnictví se načte po profilu; KC_OWNED, krok 3 a úklid sirotků podle domova', () => {
    const CS = bezKom('scripts/aisha-cold-start.sh');
    expect(CS).toMatch(/\. "\$\{SCRIPT_DIR\}\/lib\/vlastnictvi\.sh"/);
    const profil = CS.indexOf('AISHA_PROFILE není deklarovaný');
    const nacteni = CS.indexOf('\ncs_nacti_vlastnictvi\n');
    expect(nacteni, 'vlastnictví se nenačítá').toBeGreaterThan(-1);
    expect(nacteni, 'vlastnictví se čte před ověřením profilu').toBeGreaterThan(profil);
    expect(CS).toMatch(/if vlastni keycloak; then\s+KC_OWNED=1/);
    expect(CS).toMatch(/done < <\(vlastni_aplikace \| cut -f1\)/);
    const wipe = CS.slice(CS.indexOf('wipe_orphan_apps() {'), CS.indexOf('_names+=("$name")'));
    expect(wipe, 'úklid sirotků nevyřadí externí službu').toMatch(/if externi "\$\(cs_role_aplikace "\$name"\)"; then[\s\S]*?continue/);
  });

  it('story-init bere aplikace z domova (jen vlastní) a externí nahlas vynechá', () => {
    const SI = bezKom('scripts/coolify-story-init.sh');
    expect(SI).toMatch(/vlastnictvi_nacti "\$MANIFEST_FILE"/);
    expect(SI).toMatch(/done < <\(vlastni_aplikace\)/);
    expect(SI).toMatch(/NEZAKLÁDÁM ani NESROVNÁVÁM/);
  });

  it('redeploy: výběr cílů vyřadí externí; --only a --canary ji odmítnou kódem EXTERNÍ', () => {
    const RD = bezKom('scripts/aisha-redeploy.mjs');
    expect(RD).toMatch(/vlastnictviProstredi\(/);
    expect(RD).toMatch(/apps\.has\(n\) && !vypnute\.has\(n\) && !DRZENE\.has\(n\) && !externi\.has\(n\)/);
    expect(RD).toMatch(/process\.exit\(KOD_EXTERNI\);[\s\S]*process\.exit\(KOD_EXTERNI\);/);
  });

  it('sdílená mapa (sync-envs, deploy-init, umístění) staví z vlastních aplikací; deploy-init a sync externí nenastaví', () => {
    const AV = bezKom('scripts/lib/coolify-app-vars.sh');
    expect(AV.slice(AV.indexOf('load_app_compose_map() {'))).toMatch(/done < <\(vlastni_aplikace\)/);
    expect(bezKom('scripts/coolify-deploy-init.sh')).toMatch(/if externi "\$_bd_role"; then/);
    expect(bezKom('scripts/coolify-sync-envs.sh')).toMatch(/externi "\$\{NAME#"\$\{PREFIX\}"-\}"; then/);
  });
});

describe('domov mutace: externí ≠ držená', () => {
  it('dva jmenované kódy, shodné v JS i shellu, a otázka na vlastnictví PŘED odesláním', async () => {
    const { KOD_EXTERNI } = await import('../../../scripts/lib/vlastnictvi-aplikaci.mjs');
    const { KOD_DRZENO } = await import('../../../scripts/lib/nasazeni-drzene.mjs');
    expect(KOD_EXTERNI).not.toBe(KOD_DRZENO);
    const SH = cti('scripts/lib/coolify-mutace.sh');
    expect(SH).toMatch(new RegExp(`COOLIFY_MUTACE_EXTERNI=${KOD_EXTERNI}\\b`));
    expect(SH).toMatch(new RegExp(`COOLIFY_MUTACE_DRZENO=${KOD_DRZENO}\\b`));
    const M = cti('scripts/lib/coolify-mutace.mjs');
    const telo = M.slice(M.indexOf('export async function mutujAplikaci'), M.indexOf('async function overParovani'));
    expect(telo.indexOf('externiPolozka(z, k)'), 'mutace se na vlastnictví neptá').toBeGreaterThan(-1);
    expect(telo.indexOf('externiPolozka(z, k)'), 'na vlastnictví se ptá až po odeslání').toBeLessThan(telo.indexOf('k.volej(cesta'));
  });
});
