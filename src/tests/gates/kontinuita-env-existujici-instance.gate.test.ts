/**
 * Brána: nový .env.coolify existující instance nesmí ztratit, co drží provoz
 *
 * ⛔ NAMĚŘENO 2026-10-03 (konvergence nasazené instance, výpadek ~7 h): krok 2
 * cold-startu vyrobil .env.coolify nanovo — držený POSTGRES_MAJOR (17) nahradil
 * domov (18) a obraz 18 nad daty 17 odmítl start; pin KEYCLOAK_URL se odvodil jako
 * `https://`; 12 klíčů, které compose čte, ze souboru zmizelo. Simulace vedle běhu
 * hlídala jen vyprázdnění.
 *
 * Měří se rozhodnutí (scripts/lib/kontinuita-env.mjs) a to, že ho krok 2 volá
 * PŘED zápisem souboru. Spouští se přes: npm run test:gates
 *
 * ⛔ NAMĚŘENO 2026-10-04 (vypnutí lokálního modelu na nasazené instanci): opačný směr téže
 * třídy. Operátor lane ZAVŘEL (`CHAT_GGUF_URL=`), resolver službu vynechal a její adresa
 * (`VLLM_GENERATION_URL`) v novém souboru jen chyběla — kontinuita ji jako čtený klíč
 * převzala z minula, migrace by providera lokálního modelu zapnula proti službě, která se
 * nenasazuje. Chybění je od zapomenutí nerozeznatelné; krok 2 proto adresy zavřených lanes
 * vydává VÝSLOVNĚ PRÁZDNÉ (scripts/lib/provision-gate.mjs) a prázdnou kontinuita nepřebíjí.
 * Že prázdná adresa je pro migraci „není“, měří src/tests/db/lokalni-model-provider-runtime.test.ts.
 */
import { describe, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRZENE_INSTANCI, cteneCompose, main, srovnejKontinuitu, urlBezHostu } from "../../../scripts/lib/kontinuita-env.mjs";
import { adresyZavrenychLanes, doplnAdresyZavrenych, doplnPrazdneKlice, nactiKatalog } from "../../../scripts/lib/provision-gate.mjs";

const ROOT = process.cwd();
const COMPOSE = "a: ${POSTGRES_MAJOR:?}\nb: ${CORS_ALLOWLIST:-}\nc: ${KEYCLOAK_URL:?chybí}\nd: ${LIVEKIT_URL:-}\ne: ${NOVA_URL?}\nf: ${X}\n";
const { ctene, povinne } = cteneCompose([COMPOSE]);
const MINULE = [
  "POSTGRES_MAJOR=17", "AISHA_DB_IMAGE=aisha-db-pg17:local", 'CORS_ALLOWLIST="https://a.example"',
  "KEYCLOAK_URL=https://auth.mesh.example", "SIROTEK=1", "X=stare", "PRAZDNY=", "",
].join("\n");
const NOVE = ["# hlavička", "AISHA_DB_IMAGE=aisha-db-pg18:local", "KEYCLOAK_URL=https://", "LIVEKIT_URL=wss://", "X=nove", ""].join("\n");

describe("kontinuita .env.coolify existující instance", () => {
  const r = srovnejKontinuitu({ minule: MINULE, nove: NOVE, ctene, povinne });

  test("(8) držený klíč: minulá hodnota vyhraje nad domovem — i když v novém chybí", () => {
    expect(r.drzene).toEqual(["AISHA_DB_IMAGE", "POSTGRES_MAJOR"]);
    expect(r.vystup).toMatch(/^AISHA_DB_IMAGE=aisha-db-pg17:local$/m);
    expect(r.vystup).toMatch(/^POSTGRES_MAJOR=17$/m);
    expect(r.vystup).not.toMatch(/pg18/);
  });

  test("(9) pin operátora: URL bez hostu nahradí platná minulá hodnota", () => {
    expect(r.piny).toEqual(["KEYCLOAK_URL"]);
    expect(r.vystup).toMatch(/^KEYCLOAK_URL=https:\/\/auth\.mesh\.example$/m);
  });

  test("(10) klíč, který compose čte a nový soubor nemá, se převezme vč. uvozovek; sirotek ne", () => {
    expect(r.prevzate).toEqual(["CORS_ALLOWLIST"]);
    expect(r.vystup).toMatch(/^CORS_ALLOWLIST="https:\/\/a\.example"$/m);
    expect(r.vystup).not.toMatch(/SIROTEK|PRAZDNY/);
  });

  test("změna hodnoty čteného klíče se jen hlásí (čerstvé odvození vyhrává); výstup má každý klíč jednou", () => {
    expect(r.zmenene).toEqual(["X"]);
    expect(r.vystup).toMatch(/^X=nove$/m);
    const klice = r.vystup.split("\n").filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => l.split("=")[0]);
    expect(new Set(klice).size).toBe(klice.length);
    expect(r.vystup.startsWith("# hlavička\n")).toBe(true);
  });

  test("URL bez hostu bez platné minulé hodnoty: vyžadovaný klíč je vada, volitelný hlášení", () => {
    expect(r.bezHostu).toEqual(["LIVEKIT_URL"]);
    expect(r.vady).toEqual([]);
    const vada = srovnejKontinuitu({ minule: "", nove: "NOVA_URL=https://\n", ctene, povinne });
    expect(vada.vady).toHaveLength(1);
    expect(vada.vady[0]).toMatch(/^NOVA_URL: compose ho vyžaduje/);
  });

  test("mutace: bez pravidla držených klíčů by nasadil domov; bez pravidla čtených by klíč zmizel", () => {
    const bezDrzenych = srovnejKontinuitu({ minule: MINULE, nove: NOVE, ctene: new Set(), povinne, drzene: [] });
    expect(bezDrzenych.vystup).toMatch(/pg18/);
    expect(bezDrzenych.vystup).not.toMatch(/POSTGRES_MAJOR/);
    expect(bezDrzenych.vystup).not.toMatch(/CORS_ALLOWLIST/);
  });

  test("prázdná minulá hodnota se nepřevádí a nic nepřebíjí", () => {
    const x = srovnejKontinuitu({ minule: "POSTGRES_MAJOR=\nKEYCLOAK_URL=\n", nove: "POSTGRES_MAJOR=18\n", ctene, povinne });
    expect(x.vystup).toBe("POSTGRES_MAJOR=18\n");
    expect(x.drzene).toEqual([]);
  });

  test.each([
    ["https://", true], ['"http:///cesta"', true], ["wss://:8443", true], ["https://a.example", false],
    ["file:///var/x", false], ["postgresql:///db", false], ["", false],
  ])("URL bez hostu: %s → %s", (hodnota, cekano) => {
    expect(urlBezHostu(hodnota)).toBe(cekano);
  });

  test("compose: čtené × vyžadované (`:?` i `?`)", () => {
    expect([...ctene].sort()).toEqual(["CORS_ALLOWLIST", "KEYCLOAK_URL", "LIVEKIT_URL", "NOVA_URL", "POSTGRES_MAJOR", "X"]);
    expect([...povinne].sort()).toEqual(["KEYCLOAK_URL", "NOVA_URL", "POSTGRES_MAJOR"]);
  });
});

describe("kontinuita — zapojení", () => {
  test("seznam držených klíčů = klíče, které doktor bere z domova jen když chybí (image(K, \"\"))", () => {
    const doktor = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");
    const zDoktora = [...doktor.matchAll(/\["([A-Z0-9_]+)",\s*"required-static",\s*image\("\1",\s*""\)\]/g)].map((m) => m[1]).sort();
    expect(zDoktora.length).toBeGreaterThan(0);
    expect([...DRZENE_INSTANCI].sort()).toEqual(zDoktora);
  });

  test("krok 2 cold-startu volá kontinuitu nad existujícím stackem PŘED zápisem .env.coolify", () => {
    const cs = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");
    const volani = cs.indexOf('scripts/lib/kontinuita-env.mjs" --minule "$ENV_COOLIFY" --nove "$TMP_ENV"');
    const zapis = cs.indexOf('env_zapis_atomicky "$TMP_ENV" "$ENV_COOLIFY"');
    expect(volani).toBeGreaterThan(0);
    expect(zapis).toBeGreaterThan(volani);
    // ⛔ Volání NESMÍ být podmíněné existencí minulého souboru (`-s`/`-f`): ten je vlastnost
    // stromu, ne instance — z čerstvého klonu chybí a kontrola by se tiše přeskočila
    // (revize 2026-10-03). Že není s čím srovnat, říká nástroj sám (kód 4, test níž).
    const pred = cs.slice(volani - 400, volani);
    expect(pred).toMatch(/if \[ "\$SKIP_CREATE" = "1" \]; then/);
    expect(pred).not.toMatch(/\[ -[sf] "\$ENV_COOLIFY" \]/);
    // Nenulový kód (vada i NEMĚŘENO) končí běh DŘÍV než zápis.
    const mezi = cs.slice(volani, zapis);
    expect(mezi).toMatch(/_kont_rc=\$\?/);
    expect(mezi).toMatch(/if \[ "\$_kont_rc" -ne 0 \]; then[\s\S]*?exit 1/);
  });

  test("CLI: vada soubor NEZMĚNÍ a vrátí 3; jinak přepíše na místě a hodnoty nevypisuje", () => {
    const dir = mkdtempSync(join(tmpdir(), "kontinuita-"));
    writeFileSync(join(dir, "docker-compose.coolify.yml"), COMPOSE);
    const minule = join(dir, "minule.env"); const nove = join(dir, "nove.env");
    // V témže procesu (main vrací kód, proces nekončí) — brána nepotřebuje podproces.
    const spust = () => {
      const out: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
      const err = vi.spyOn(console, "error").mockImplementation((...a) => { out.push(a.join(" ")); });
      try { return { status: main(["--minule", minule, "--nove", nove, "--koren", dir]), vystup: out.join("\n") }; } finally { log.mockRestore(); err.mockRestore(); }
    };
    // Minulý soubor nese jiný klíč než ten vadný — vada se pozná ze SROVNÁNÍ (kód 3), ne z toho,
    // že není s čím srovnat (to je kód 4, test níž).
    writeFileSync(minule, "JINY_KLIC=1\n"); writeFileSync(nove, "NOVA_URL=https://\n");
    const vada = spust();
    expect(vada.status, vada.vystup).toBe(3);
    expect(readFileSync(nove, "utf8")).toBe("NOVA_URL=https://\n");
    writeFileSync(minule, MINULE); writeFileSync(nove, NOVE);
    const ok = spust();
    expect(ok.status, ok.vystup).toBe(0);
    expect(readFileSync(nove, "utf8")).toMatch(/^POSTGRES_MAJOR=17$/m);
    expect(ok.vystup).toMatch(/DRŽENO instancí.*AISHA_DB_IMAGE POSTGRES_MAJOR/);
    expect(ok.vystup).not.toMatch(/a\.example|auth\.mesh|pg17/);
  });

  test("CLI: minulý soubor CHYBÍ nebo nenese klíč → NEMĚŘENO (kód 4), nový soubor se nezmění", () => {
    // ⛔ Minulý .env.coolify je vlastnost STROMU (není v gitu): čerstvý klon, jiný pracovní strom,
    // jiný stroj. Do 2026-10-03 se kontinuita v tom případě tiše přeskočila (podmínka `-s`
    // u volajícího) a nový soubor vzal držené hodnoty z domova — tvar výpadku, kvůli kterému
    // kontinuita vznikla. „Není s čím srovnat“ není „v pořádku“.
    const dir = mkdtempSync(join(tmpdir(), "kontinuita-nemereno-"));
    writeFileSync(join(dir, "docker-compose.coolify.yml"), COMPOSE);
    const minule = join(dir, "minule.env"); const nove = join(dir, "nove.env");
    const spust = () => {
      const out: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
      const err = vi.spyOn(console, "error").mockImplementation((...a) => { out.push(a.join(" ")); });
      try { return { status: main(["--minule", minule, "--nove", nove, "--koren", dir]), vystup: out.join("\n") }; } finally { log.mockRestore(); err.mockRestore(); }
    };
    writeFileSync(nove, NOVE);
    // (1) soubor neexistuje
    const chybi = spust();
    expect(chybi.status, chybi.vystup).toBe(4);
    expect(chybi.vystup).toMatch(/kontinuita NEMĚŘENA/);
    expect(readFileSync(nove, "utf8")).toBe(NOVE);
    // (2) soubor existuje, ale nenese žádný klíč (prázdný, jen komentáře)
    // Soubor jen s řádky malými písmeny klíč pro kontinuitu NENESE (čte se týmž výrazem jako
    // `nacti()`); volnější kontrola by ho pustila a srovnávalo by se proti nule klíčů.
    for (const obsah of ["", "\n\n", "# jen komentář\n", "male_pismeno=1\nDalsi=2\n"]) {
      writeFileSync(minule, obsah);
      const prazdny = spust();
      expect(prazdny.status, JSON.stringify(obsah)).toBe(4);
      expect(readFileSync(nove, "utf8")).toBe(NOVE);
    }
    // KOTVA: týž nový soubor s minulým souborem, který klíče nese, projde (a přepíše se) —
    // kód 4 tedy není vlastnost vstupu `nove` ani kořene, jen chybějícího minula.
    writeFileSync(minule, MINULE);
    const ok = spust();
    expect(ok.status, ok.vystup).toBe(0);
    expect(readFileSync(nove, "utf8")).not.toBe(NOVE);
  });
});

describe("zavřená opt-in lane: adresy výslovně prázdné, kontinuita je nevrací", () => {
  const cti = (hodnoty: Record<string, string>) => (k: string) => hodnoty[k];
  const KATALOG = {
    zavrena: {
      provision_when_env: "VAHY_URL",
      internal_url: { service: "svc-a", port: 1, env_aliases: ["ADRESA_A", "SDILENY_ALIAS"] },
      internal_endpoints: [{ env_aliases: ["DALSI_A"] }],
      internal_tcp_endpoints: [{ env_aliases: ["TCP_A"] }],
    },
    "za-pnuta": { provision_when_env: ["LANE_1", "LANE_2"], internal_url: { service: "svc-b", port: 2, env_aliases: ["SDILENY_ALIAS"] } },
    "bez-podminky": { internal_url: { service: "svc-c", port: 3, env_aliases: ["ADRESA_C"] } },
    "bez-adresy": { provision_when_env: "NIC" },
  };

  test("klíče adres: jen služby se zavřenou lane; alias, který vydá zapnutá služba, se nevyprazdňuje", () => {
    const zavrena = adresyZavrenychLanes(KATALOG, cti({ LANE_2: "1" }));
    expect(zavrena).toEqual(["ADRESA_A", "DALSI_A", "TCP_A", "ZAVRENA_URL"]);
    // výslovné „ne“ je zavřená lane stejně jako prázdno
    expect(adresyZavrenychLanes(KATALOG, cti({ VAHY_URL: "false", LANE_2: "1" }))).toEqual(zavrena);
    // otevřená lane: žádný její klíč
    expect(adresyZavrenychLanes(KATALOG, cti({ VAHY_URL: "https://vahy.invalid/x", LANE_1: "1" }))).toEqual([]);
    // obě zavřené: sdílený alias už nevydá nikdo → vyprazdňuje se; služba bez podmínky nikdy
    expect(adresyZavrenychLanes(KATALOG, cti({}))).toEqual(["ADRESA_A", "DALSI_A", "SDILENY_ALIAS", "TCP_A", "ZAVRENA_URL", "ZA_PNUTA_URL"]);
  });

  test("skutečný katalog: zavřený lokální model = MODEL_URL + aliasy, jak je vydává resolver", () => {
    const katalog = nactiKatalog();
    const aliasy = katalog.model?.internal_url?.env_aliases ?? [];
    expect(aliasy).toContain("VLLM_GENERATION_URL");
    // Model se zakládá při CPU vahách NEBO na GPU uzlu (MODEL_MESH, krok 7): zavřený = obě prázdné;
    // most (jen MODEL_MESH) se zavře s ním. Jen jedna zavřená model NEZAVŘE.
    const zavrenyModel = (k: string) => (k === "CHAT_GGUF_URL" || k === "MODEL_MESH" ? "" : "1");
    expect(adresyZavrenychLanes(katalog, zavrenyModel)).toEqual(["MODEL_MOST_URL", "MODEL_URL", ...aliasy].sort());
    expect(adresyZavrenychLanes(katalog, (k: string) => (k === "CHAT_GGUF_URL" ? "" : "1"))).toEqual([]);
    expect(adresyZavrenychLanes(katalog, () => "1")).toEqual([]);
    // Jméno `<ID>_URL` skládá resolver — tvar se nesmí rozejít (jinak se vyprazdňuje jiný klíč, než se vydává).
    const resolver = readFileSync(join(ROOT, "scripts/lib/derive-domains.mjs"), "utf8");
    expect(resolver).toContain('const idUpper = id.toUpperCase().replace(/-/g, "_");');
    expect(resolver).toContain("lines.push(`${idUpper}_URL=${internalUrl}`);");
  });

  test("doplnění: chybějící klíč prázdný; klíč, který soubor nese (pin operátora), se nemění", () => {
    const klice = ["MODEL_URL", "SVC_MODEL_URL", "VLLM_GENERATION_URL"];
    // soubor bez koncového řádku + pin operátora na cizí službu
    const r = doplnPrazdneKlice("A=1\nSVC_MODEL_URL=http://cizi-sluzba:8000/v1", klice);
    expect(r.doplnene).toEqual(["MODEL_URL", "VLLM_GENERATION_URL"]);
    expect(r.text).toBe("A=1\nSVC_MODEL_URL=http://cizi-sluzba:8000/v1\nMODEL_URL=\nVLLM_GENERATION_URL=\n");
    // už vydaný prázdný klíč se nezdvojí; není co doplnit → text beze změny
    const hotovo = doplnPrazdneKlice(r.text, klice);
    expect(hotovo).toEqual({ text: r.text, doplnene: [] });
    expect(doplnPrazdneKlice("", ["X"]).text).toBe("X=\n");
  });

  test("⛔ kontinuita: chybějící adresu zavřené lane by převzala z minula; prázdnou nepřevezme", () => {
    const compose = cteneCompose(["a: ${VLLM_GENERATION_URL:-}\nb: ${CHAT_GGUF_URL}\n"]);
    const minule = "CHAT_GGUF_URL=https://vahy.invalid/chat.gguf\nVLLM_GENERATION_URL=http://svc-model:8000/v1\n";
    const nove = "CHAT_GGUF_URL=\n"; // operátor lane zavřel; resolver adresu nevydal
    // KOTVA (tvar vady): bez doplnění se adresa služby, která se nenasazuje, vrátí
    const bez = srovnejKontinuitu({ minule, nove, ctene: compose.ctene, povinne: compose.povinne });
    expect(bez.prevzate).toContain("VLLM_GENERATION_URL");
    expect(bez.vystup).toMatch(/^VLLM_GENERATION_URL=http:\/\/svc-model:8000\/v1$/m);
    // s doplněním: adresa je v novém souboru výslovně prázdná → nepřevzata, vypínač zůstává prázdný
    const doplnene = doplnPrazdneKlice(nove, ["VLLM_GENERATION_URL"]).text;
    const s = srovnejKontinuitu({ minule, nove: doplnene, ctene: compose.ctene, povinne: compose.povinne });
    expect(s.prevzate).toEqual([]);
    expect(s.vystup.match(/^VLLM_GENERATION_URL=.*$/gm)).toEqual(["VLLM_GENERATION_URL="]);
    expect(s.vystup).toMatch(/^CHAT_GGUF_URL=$/m);
  });

  test("lane se čte z TÉHOŽ souboru, který se doplňuje (zavřená doplní, otevřená ne)", () => {
    // Prostředí běhu bran nesmí rozhodnout za soubor (ctenarHodnot dává neprázdnému prostředí přednost).
    const podminky = ["CHAT_GGUF_URL", "INGEST_BUNDLE_GIT_URL", "EXTRANET_ENABLED", "POTOK_ENABLED", "SOURCE_API_URL", "LOCAL_INGEST_DROP_DIR", "MODEL_MESH"];
    for (const k of podminky) vi.stubEnv(k, "");
    try {
      const dir = mkdtempSync(join(tmpdir(), "zavrena-lane-"));
      // Model se zakládá při CPU vahách NEBO na GPU uzlu (lane MODEL_MESH, krok 7) — zavřená lane modelu
      // tedy znamená obě prázdné; most (jen MODEL_MESH) se zavře s ní.
      const ostatni = "INGEST_BUNDLE_GIT_URL=https://x.invalid/b\nEXTRANET_ENABLED=true\nPOTOK_ENABLED=1\nSOURCE_API_URL=https://s.invalid\n";
      const zavreny = join(dir, "zavreny.env");
      writeFileSync(zavreny, `CHAT_GGUF_URL=\nMODEL_MESH=\n${ostatni}`);
      expect(doplnAdresyZavrenych(zavreny)).toEqual(["MODEL_MOST_URL", "MODEL_URL", "SVC_MODEL_URL", "VLLM_GENERATION_URL"]);
      expect(readFileSync(zavreny, "utf8")).toBe(`CHAT_GGUF_URL=\nMODEL_MESH=\n${ostatni}MODEL_MOST_URL=\nMODEL_URL=\nSVC_MODEL_URL=\nVLLM_GENERATION_URL=\n`);
      const otevreny = join(dir, "otevreny.env");
      writeFileSync(otevreny, `CHAT_GGUF_URL=https://vahy.invalid/chat.gguf\nMODEL_MESH=gpu\n${ostatni}`);
      expect(doplnAdresyZavrenych(otevreny)).toEqual([]);
      expect(readFileSync(otevreny, "utf8")).toBe(`CHAT_GGUF_URL=https://vahy.invalid/chat.gguf\nMODEL_MESH=gpu\n${ostatni}`);
      // GPU uzel bez CPU vah (fork po zrušení CPU vah): model i most otevřené z MODEL_MESH — nic se nevyprázdní
      const gpu = join(dir, "gpu.env");
      writeFileSync(gpu, `CHAT_GGUF_URL=\nMODEL_MESH=gpu\n${ostatni}`);
      expect(doplnAdresyZavrenych(gpu)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("zavřená lane modelového meshe (model mimo GPU slot) → adresa MOSTU výslovně prázdná, nic jiného", () => {
    // MODEL_MESH zapisuje derivace (prázdná = instance modelový mesh nemá); most je její opt-in služba.
    const podminky = ["CHAT_GGUF_URL", "INGEST_BUNDLE_GIT_URL", "EXTRANET_ENABLED", "POTOK_ENABLED", "SOURCE_API_URL", "LOCAL_INGEST_DROP_DIR", "MODEL_MESH"];
    for (const k of podminky) vi.stubEnv(k, "");
    try {
      const dir = mkdtempSync(join(tmpdir(), "zavrena-lane-mostu-"));
      const ostatni = "CHAT_GGUF_URL=https://vahy.invalid/chat.gguf\nINGEST_BUNDLE_GIT_URL=https://x.invalid/b\nEXTRANET_ENABLED=true\nPOTOK_ENABLED=1\nSOURCE_API_URL=https://s.invalid\n";
      const soubor = join(dir, "bez-meshe.env");
      writeFileSync(soubor, `MODEL_MESH=\n${ostatni}`);
      expect(doplnAdresyZavrenych(soubor)).toEqual(["MODEL_MOST_URL"]);
      expect(readFileSync(soubor, "utf8")).toBe(`MODEL_MESH=\n${ostatni}MODEL_MOST_URL=\n`);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("krok 2: doplnění běží ZA průchodem zálohy a PŘED kontrolou dvojích klíčů i kontinuitou; selhání = bez zápisu", () => {
    const cs = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");
    const pruchod = cs.indexOf("unset _klice_zapsane _tajne_z_minula");
    const doplneni = cs.indexOf('scripts/lib/provision-gate.mjs" --dopln-adresy-zavrenych "$TMP_ENV"');
    const dvakrat = cs.indexOf("_dvakrat=\"$(grep -oE");
    const kontinuita = cs.indexOf('scripts/lib/kontinuita-env.mjs" --minule "$ENV_COOLIFY" --nove "$TMP_ENV"');
    const zapis = cs.indexOf('env_zapis_atomicky "$TMP_ENV" "$ENV_COOLIFY"');
    expect(pruchod).toBeGreaterThan(0);
    // za průchodem: pin operátora ze zálohy je v souboru dřív, než se doplňuje prázdné
    expect(doplneni).toBeGreaterThan(pruchod);
    expect(dvakrat).toBeGreaterThan(doplneni);
    expect(kontinuita).toBeGreaterThan(dvakrat);
    expect(zapis).toBeGreaterThan(kontinuita);
    // nepodmíněné (i první založení: nic se nevrací, ale soubor nezávisí na historii) a fail-closed
    const blok = cs.slice(cs.lastIndexOf("\n", doplneni) + 1, dvakrat);
    expect(blok).toMatch(/^\s*if ! node "\$REPO_ROOT\/scripts\/lib\/provision-gate\.mjs" --dopln-adresy-zavrenych "\$TMP_ENV"; then[\s\S]*?rm -f "\$TMP_ENV"\s*\n\s*exit 1\s*\n\s*fi/);
  });
});
