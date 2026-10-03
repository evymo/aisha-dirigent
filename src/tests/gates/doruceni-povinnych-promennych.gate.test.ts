/**
 * Brána: kdo aplikaci nasazuje nebo jí posílá env, se zeptá, jestli dostane
 * všechno, bez čeho její compose SPADNE — a ptá se JEDNOHO domova.
 *
 * ⛔ NAMĚŘENO 2026-09-13 po slití forků do upstreamu: `Deploy: Core` spadl na
 * `${MESH_DNS_NETWORK:?}`. Hodnota v .env.coolify byla, do aplikace ji nikdo
 * nedoručil. Živé měření flotily: 20 z 32 aplikací, 8 klíčů, všechno `${X:?}`
 * — každé z nich by příští nasazení shodilo.
 *
 * Mezera nebyla v jednom nástroji, ale MEZI nimi: env-doktor měřil soubor proti
 * kontraktu, preflight-compose soubor proti compose, read-back syncu tajemství,
 * deploy výsledek buildu. Na APLIKACI se neptal nikdo. A extrakce referencí žila
 * ve dvou implementacích (grep v bashi, YAML parser v node), které se na
 * block-scalaru rozcházely — textová nedoručovala na prebuilt stacku tři klíče.
 *
 * CO SE MĚŘÍ (bez podprocesů — chování CLI a funkce syncu měří
 * scripts/lib/povinne-promenne.test.mjs):
 *   1. bashová extrakce jde přes YAML extraktor, textová se nevrátí;
 *   2. každé stanoviště, které aplikaci doručuje nebo nasazuje, se ptá
 *      scripts/lib/povinne-promenne.mjs — sync po zápisu, CI před nasazením,
 *      doktor, lokální generátor a znovupoužití vygenerovaného stacku;
 *   3. CI se ptá DŘÍV, než nasazení spustí, a nález ho zastaví;
 *   4. řídký checkout deploy úloh nese celý statický graf importů té knihovny.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(join(ROOT, p), "utf8");
const KNIHOVNA = "scripts/lib/povinne-promenne.mjs";

describe("doručení povinných proměnných compose (brána)", () => {
  test("univerzum není prázdné — jinak jsou tvrzení níž vakuová", () => {
    for (const p of [
      KNIHOVNA,
      "scripts/lib/compose-env-refs.mjs",
      "scripts/lib/coolify-app-vars.sh",
      "scripts/coolify-sync-envs.sh",
      "scripts/ci/deploy-and-verify.sh",
      "scripts/cold-start-doctor.sh",
      "scripts/local-compose-gen.mjs",
      "scripts/local-warmup.sh",
      ".forgejo/workflows/ci.yml",
    ]) {
      expect(existsSync(join(ROOT, p)), `${p} chybí`).toBe(true);
    }
  });

  describe("1. extrakce referencí má jeden domov", () => {
    /** Tělo bashové funkce podle jména (od `jmeno() {` po `}` na začátku řádku). */
    const telo = (sh: string, jmeno: string) => new RegExp(`^${jmeno}\\(\\) \\{[\\s\\S]*?^\\}`, "m").exec(sh)?.[0] ?? "";
    /**
     * Textová extrakce `${VAR}` Z COMPOSE: grep nad `\$\{[A-Z_]` v tělech funkcí,
     * které compose čtou. Šablona realmu (extract_realm_template_vars) je JSON,
     * ne compose — tam je regex nad `${VAR}` správně a brána ji neměří.
     */
    const COMPOSE_FUNKCE = ["_compose_refs", "extract_compose_vars", "extract_required_compose_vars"];
    const textovaExtrakce = (sh: string) =>
      COMPOSE_FUNKCE.map((f) => telo(sh, f))
        .join("\n")
        .split("\n")
        .filter((r) => !/^\s*#/.test(r))
        .some((r) => /grep\s+-o[A-Za-z]*\s+'\\\$\\\{\[A-Z_\]/.test(r));

    test("coolify-app-vars.sh čte compose YAML parserem", () => {
      const sh = cti("scripts/lib/coolify-app-vars.sh");
      for (const f of COMPOSE_FUNKCE) expect(telo(sh, f), `funkce ${f}() v coolify-app-vars.sh není`).not.toBe("");
      expect(telo(sh, "_compose_refs"), "_compose_refs nevolá compose-env-refs.mjs").toMatch(/node\s+"\$root\/scripts\/lib\/compose-env-refs\.mjs"/);
      for (const f of ["extract_compose_vars", "extract_required_compose_vars"]) {
        expect(telo(sh, f), `${f} nejde přes _compose_refs`).toMatch(/_compose_refs "\$1"/);
      }
      expect(
        textovaExtrakce(sh),
        "v coolify-app-vars.sh je zase grep nad `${VAR}` — ten zahazoval řádky s # uvnitř block-scalaru\n" +
          "a `\\${X}` bral za escape; obojí compose interpoluje. Extrakce patří do compose-env-refs.mjs.",
      ).toBe(false);
    });

    test("sonda na textovou extrakci jde rozsvítit (negativní vzorek)", () => {
      const puvodni = `extract_required_compose_vars() {\n  _clean "$1" \\\n    | grep -oE '\\$\\{[A-Z_][A-Z0-9_]*(\\}|(:[?]|[?])[^}]*\\})' \\\n    | sort -u\n}\n_compose_refs() {\n}\nextract_compose_vars() {\n}`;
      expect(textovaExtrakce(puvodni), "detektor nepoznal textovou extrakci, kterou měl chytit").toBe(true);
    });

    test("selhání extraktoru se v syncu nepromění v prázdný payload", () => {
      const sync = cti("scripts/coolify-sync-envs.sh");
      expect(sync).toMatch(/if ! compose_refs=\$\(extract_compose_vars "\$compose_path"\)/);
      expect(sync).toMatch(/VALIDATION_NO_REFS/);
    });
  });

  describe("2. každé stanoviště se ptá téže knihovny", () => {
    test("sync: po zápisu i u aplikace, které nic neposlal", () => {
      const sync = cti("scripts/coolify-sync-envs.sh");
      expect(sync).toMatch(/node "\$ROOT\/scripts\/lib\/povinne-promenne\.mjs" --compose "\$compose_path" --coolify-envs -/);
      const volani = sync.match(/over_povinne_na_aplikaci "\$RB0?" [^\n]*\|\| FAILED\+=\("\$NAME"\)/g) ?? [];
      expect(
        volani.length,
        "sync neměří povinné proměnné na obou cestách (po zápisu `$RB` i při 0 odeslaných `$RB0`),\n" +
          "nebo nález nepřidá aplikaci mezi selhané",
      ).toBe(2);
    });

    test("sync: s nedoručenou povinnou se REDEPLOY=1 nespustí", () => {
      const sync = cti("scripts/coolify-sync-envs.sh");
      const i = sync.indexOf('if [ "$REDEPLOY" = "1" ]; then');
      expect(i).toBeGreaterThan(-1);
      const blok = sync.slice(i, sync.indexOf("# ── Souhrn", i));
      const iStraz = blok.indexOf("${FAILED[*]:-}");
      const iPost = blok.indexOf("/deploy?uuid=");
      expect(iStraz, "redeploy nekontroluje FAILED — nasadil by aplikaci, o které sync ví, že spadne").toBeGreaterThan(-1);
      expect(iStraz).toBeLessThan(iPost);
    });

    test("doktor: fáze P měří aplikace v Coolify a SoT předává kvůli nápravě", () => {
      const doktor = cti("scripts/cold-start-doctor.sh");
      expect(doktor).toMatch(/should_run_phase P/);
      expect(doktor).toMatch(/scripts\/lib\/povinne-promenne\.mjs" --coolify --prefix "\$_p_prefix"/);
      // SoT PROSTŘEDÍ, ne napevno produkční `.env.coolify` (PR2 izolace cold-startu): doktor
      // předává soubor, který mu určil jeden domov prostředí (scripts/lib/prostredi-behu.sh).
      expect(doktor).toMatch(/--env-file "\$DOKTOR_ENV_SOUBOR"/);
      expect(doktor).toMatch(/DOKTOR_ENV_SOUBOR="\$\{ENV_FILE:-\$\(pb_env_soubor "\$REPO_ROOT"/);
    });

    test("lokální generátor: všechny mezery naráz, dřív než docker najde první", () => {
      const gen = cti("scripts/local-compose-gen.mjs");
      expect(gen).toMatch(/from "\.\/lib\/povinne-promenne\.mjs"/);
      const iKontrola = gen.indexOf("nedorucene(povinneSouboru(");
      const iDocker = gen.indexOf("renderComposeJson(composeFile, DEV_ENV_FILE)");
      expect(iKontrola, "generátor se na povinné proměnné neptá").toBeGreaterThan(-1);
      expect(iKontrola, "kontrola běží až PO renderu — docker by spadl na první mezeru dřív").toBeLessThan(iDocker);
      expect(gen).toMatch(/merged\["x-aisha-zdroje"\]/);
    });

    test("local-warmup: znovupoužitý stack se změří proti dnešním compose", () => {
      const warmup = cti("scripts/local-warmup.sh");
      expect(warmup).toMatch(/x-aisha-zdroje/);
      expect(warmup).toMatch(/lib\/povinne-promenne\.mjs" "\$\{POVINNE_ARGS\[@\]\}" --env-file \.env\.local\.dev/);
    });
  });

  describe("3. CI se ptá dřív, než nasadí", () => {
    const skript = cti("scripts/ci/deploy-and-verify.sh");

    test("kontrola stojí před zápisem revize i před POST /deploy", () => {
      const iKontrola = skript.indexOf("node scripts/lib/povinne-promenne.mjs --compose");
      const iRevize = skript.indexOf('-X PATCH "${COOLIFY_URL}/api/v1/applications/${UUID}/envs/bulk"');
      const iSpust = skript.indexOf('-X POST "${COOLIFY_URL}/api/v1/deploy');
      expect(iKontrola, "deploy-and-verify.sh se na doručení povinných neptá").toBeGreaterThan(-1);
      expect(iKontrola).toBeLessThan(iRevize);
      expect(iKontrola).toBeLessThan(iSpust);
    });

    test("nález (kód 1) nasazení ZASTAVÍ; neměřeno ho jen označí", () => {
      const i = skript.indexOf('case "$PREFLIGHT_RC" in');
      expect(i).toBeGreaterThan(-1);
      const blok = skript.slice(i, skript.indexOf("esac", i));
      const vetev1 = /\n\s*1\)[\s\S]*?;;/.exec(blok)?.[0] ?? "";
      expect(vetev1, "větev nálezu nekončí exit 1 — nasadilo by se, co spadne").toMatch(/exit 1/);
      expect(skript, "stav kontroly se v závěrečném výpisu neobjeví").toMatch(/echo "\$PREFLIGHT_STAV"/);
    });

    test("compose se bere z aplikace (docker_compose_location), ne ze jména", () => {
      expect(skript).toMatch(/docker_compose_location/);
    });

    test("parser pro řídký checkout je připnutý otiskem", () => {
      expect(skript).toMatch(/^YAML_PARSER_OTISK="sha512-[A-Za-z0-9+/]+=*"$/m);
      expect(skript).toMatch(/npm pack --silent "yaml@\$\{YAML_PARSER_VERZE\}"/);
      expect(skript, "stažený balík se nesrovnává s otiskem").toMatch(/!= "\$YAML_PARSER_OTISK"/);
    });
  });

  describe("4. řídký checkout nese, co knihovna importuje", () => {
    /** Statické relativní importy, rekurzivně. Dynamické `await import()` jsou jen v režimu --coolify. */
    function grafImportu(start: string, videno = new Set<string>()): Set<string> {
      if (videno.has(start)) return videno;
      videno.add(start);
      const zdroj = cti(start);
      for (const m of zdroj.matchAll(/^import\s[^;]*?from\s+"(\.{1,2}\/[^"]+)";/gm)) {
        grafImportu(normalize(join(dirname(start), m[1])), videno);
      }
      return videno;
    }

    test("každá úloha, která volá deploy-and-verify.sh, má celý graf ve sparse-checkoutu", () => {
      const graf = [...grafImportu(KNIHOVNA)].sort();
      expect(graf, "graf importů je podezřele malý — parser importů přestal sedět").toContain("scripts/lib/compose-env-refs.mjs");

      const yml = cti(".forgejo/workflows/ci.yml");
      const ulohy = yml.split(/\n(?= {2}[a-z0-9-]+:\s*\n)/);
      const volajici = ulohy.filter((u) => /(?<![\w./-])bash[ \t]+scripts\/ci\/deploy-and-verify\.sh/.test(u));
      expect(volajici.length, "žádná úloha nevolá deploy-and-verify.sh — brána by neměřila nic").toBeGreaterThan(0);

      const chybi: string[] = [];
      for (const u of volajici) {
        const jmeno = /^\s*([a-z0-9-]+):/.exec(u)?.[1] ?? "?";
        const sparse = /sparse-checkout: \|\n((?:\s{12}\S[^\n]*\n)+)/.exec(u)?.[1] ?? "";
        for (const soubor of graf) if (!sparse.includes(soubor)) chybi.push(`${jmeno}: ${soubor}`);
      }
      expect(
        chybi,
        "deploy úloha by kontrolu doručení pustila bez souboru, který knihovna importuje —\n" +
          "node spadne na import a kontrola skončí jako NEMĚŘENO u každého nasazení:\n" +
          chybi.map((c) => `  ${c}`).join("\n"),
      ).toEqual([]);
    });
  });
});
