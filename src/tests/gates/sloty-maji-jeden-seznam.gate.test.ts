/**
 * Sloty (role serverů) mají JEDEN seznam — a každý jeho opis se proti němu měří.
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Slot je klíč `servers` v `coolify/servers.json` (jeden domov: scripts/lib/
 * sloty-serveru.mjs). Všude jinde je slot OPIS, který musí sedět:
 *   • výčet umístění služby       config/services.schema.json  (bez build serveru)
 *   • vzor role v profilu          config/profiles.schema.json  (bez build serveru, + `local`)
 *   • výčet klíčů registru         coolify/servers.schema.json  (všechny sloty)
 *   • rozvod UUID serveru slotu    aisha-cold-start.sh + aisha-cold-start-env.sh
 *                                  (každé místo, které UUID slotu vede, vede VŠECHNY sloty)
 *   • smyčky přes sloty            žádná natvrdo zapsaná `require_loaded_env` smyčka,
 *                                  žádný částečný doslovný výčet (kromě VEDOME_CASTECNE
 *                                  s důvodem a pojistkou)
 *   • čtenáři                      cold-start, obal, doktor, discovery a drift-check
 *                                  volají lib/sloty-serveru.mjs
 *
 * Navíc PIN CHOVÁNÍ: povinné sloty (v provozu bez otevřených lan) a slot s výslovnou
 * vazbou jsou zapsané výčtem — ne odvozené z katalogu, který brána měří.
 *
 * ── PROČ (rešerše 2026-10-02 nad GPU uzlem) ───────────────────────────────────
 * Pátý slot (`gpu`) znamenal hledat opisy po stromu: tři výčty ve schématech,
 * ručně psaná mapa v drift-checku a osm míst rozvodu v cold-startu. Na co se
 * zapomene, to slot TIŠE přeskočí — drift-check u neznámého slotu vracel `null`
 * a server aplikace prostě neměřil. Proto podmínka revize: slot přidaný jen na
 * JEDNO místo musí bránu shodit (mutační testy dole).
 *
 * Brána měří VLASTNOST (opis == seznam, v obou směrech), ne vzorek jmen: přidá-li
 * někdo šestý slot jen do registru, spadne; přidá-li ho jen do schématu, spadne.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  klicUuidSlotu,
  nactiSloty,
  slotyKPripnuti,
  slotyServeru,
  slotyUmisteni,
  slotyVProvozu,
  uuidSlotu,
  vyzadujeVyslovnouVazbu,
} from "../../../scripts/lib/sloty-serveru.mjs";

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(join(ROOT, p), "utf8");
const json = (p: string) => JSON.parse(cti(p));

type Registr = Record<string, { is_build_server?: boolean; has_traefik?: boolean; has_gpu?: boolean }>;
type Json = Record<string, unknown>;
type Vstupy = {
  servers: Registr;
  servicesSchema: Json;
  profilesSchema: Json;
  serversSchema: Json;
  coldStart: string;
  coldStartEnv: string;
  doktor: string;
};

/** Uzel JSON stromu po cestě klíčů; chybějící článek = `undefined` (měřidlo to ohlásí). */
const uzel = (o: unknown, ...klice: string[]): unknown =>
  klice.reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Json)[k] : undefined), o);

/**
 * Role, kterou profil smí jmenovat, ač to není slot registru: `local` je lokální
 * zrcadlo (config/profiles/local-dev.json), ne server v Coolify. Jediná výjimka,
 * s pojistkou proti shnití níž (musí ji pořád používat aspoň jeden profil).
 */
const ROLE_MIMO_REGISTR = "local";

/**
 * Místa rozvodu UUID serveru slotu. Každé vydá MNOŽINU slotů, které vede; ta se
 * porovná se všemi sloty registru. Regulární výraz chytá TVAR řádku, ne jméno
 * slotu — nový slot se pod něj dostane sám.
 */
const MISTA_ROZVODU: Array<{ kde: string; soubor: "coldStart" | "coldStartEnv"; vzor: RegExp; alternace?: boolean }> = [
  { kde: "cold-start heredoc (.env.coolify)", soubor: "coldStart", vzor: /^COOLIFY_SERVER_UUID_([A-Z0-9_]+)=\$\{COOLIFY_SERVER_UUID_\1:-\}$/gm },
  { kde: "cold-start REGEN_KEY_PATTERNS", soubor: "coldStart", vzor: /SERVER_UUID_\(([A-Z0-9_|]+)\)/g, alternace: true },
  { kde: "cold-start export pro story-init", soubor: "coldStart", vzor: /^export COOLIFY_SERVER_UUID_([A-Z0-9_]+)\b/gm },
  { kde: "cold-start most COOLIFY_PROD_", soubor: "coldStart", vzor: /COOLIFY_PROD_SERVER_UUID_([A-Z0-9_]+):=\$\{COOLIFY_SERVER_UUID_\1:-\}/g },
  { kde: "cold-start-env get_env_var", soubor: "coldStartEnv", vzor: /^COOLIFY_SERVER_UUID_([A-Z0-9_]+)=\$\(get_env_var "SERVER_UUID_\1"/gm },
  { kde: "cold-start-env read_backup_key", soubor: "coldStartEnv", vzor: /COOLIFY_SERVER_UUID_([A-Z0-9_]+)=\$\(read_backup_key COOLIFY_SERVER_UUID_\1\)/g },
  { kde: "cold-start-env export", soubor: "coldStartEnv", vzor: /^export COOLIFY_SERVER_UUID_([A-Z0-9_]+)\s*$/gm },
  { kde: "cold-start-env export prostředí", soubor: "coldStartEnv", vzor: /^export "\$\{_slot_prefix\}SERVER_UUID_([A-Z0-9_]+)=\$COOLIFY_SERVER_UUID_\1"/gm },
];

function slotyNaMiste(text: string, misto: (typeof MISTA_ROZVODU)[number]): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(misto.vzor)) {
    for (const s of misto.alternace ? m[1].split("|") : [m[1]]) if (s) out.add(s);
  }
  return out;
}

/** Literální alternativy vzoru `^(a|b|…|\$\{…\})$` — jen jména, ne odkaz na proměnnou. */
function literalyVzoru(vzor: string): string[] {
  const vnitrek = /^\^\((.*)\)\$$/.exec(vzor)?.[1] ?? "";
  return vnitrek.split("|").filter((x) => /^[a-z][a-z0-9-]*$/.test(x));
}

const rozdilMnozin = (kde: string, cekano: Iterable<string>, je: Iterable<string>): string[] => {
  const c = new Set(cekano);
  const j = new Set(je);
  return [
    ...[...c].filter((x) => !j.has(x)).map((x) => `${kde}: chybí slot '${x}'`),
    ...[...j].filter((x) => !c.has(x)).map((x) => `${kde}: slot '${x}' registr nezná`),
  ];
};

/**
 * Smyčky přes DOSLOVNÉ jméno proměnné slotu (`for x in COOLIFY_SERVER_UUID_A …; do`).
 * Seznam slotů v bash smyčce je opis registru: smí být jen ÚPLNÝ (všechny sloty —
 * pak ho hlídá parita) a nikdy nesmí řídit `require_loaded_env`. Kterým slotům se
 * má UUID vyžadovat, rozhoduje registr + lane (`sloty-serveru.mjs --v-provozu`);
 * natvrdo zapsaná smyčka byla přesně to, co by nový slot tiše přeskočilo (nebo
 * naopak vyžadovalo i na instanci, která ho nemá).
 */
export function nalezySmycek(texty: Record<string, string>, vsechnySloty: string[]): string[] {
  const out: string[] = [];
  for (const [kde, text] of Object.entries(texty)) {
    const spojeny = text.replace(/\\\n/g, " ");
    // Hledá se jen HLAVIČKA smyčky a tělo se dočte do nejbližšího `done` zvlášť:
    // regulár „hlavička…tělo…done" by tělo smyčky s `done` na stejném řádku
    // natáhl přes celé následující smyčky a ty by z měření zmizely (naměřeno
    // na vlastní mutaci 2026-10-03 — vložená smyčka nebyla vidět).
    for (const m of spojeny.matchAll(/^[ \t]*for\s+\w+\s+in\s+([^;\n]*?)\s*;\s*do\b/gm)) {
      const sloty = [...m[1].matchAll(/\bCOOLIFY_SERVER_UUID_([A-Z0-9_]+)\b/g)].map((x) => x[1]);
      if (sloty.length === 0) continue;
      const zacatek = (m.index ?? 0) + m[0].length;
      const konec = spojeny.slice(zacatek).search(/\bdone\b/);
      const telo = konec < 0 ? spojeny.slice(zacatek) : spojeny.slice(zacatek, zacatek + konec);
      const ukazka = m[1].replace(/\s+/g, " ").slice(0, 100);
      if (/require_loaded_env/.test(telo)) out.push(`${kde}: natvrdo zapsaná smyčka require_loaded_env přes sloty (${ukazka}) — odvoď z --v-provozu`);
      else if (vsechnySloty.some((x) => !sloty.includes(x))) out.push(`${kde}: částečný doslovný výčet slotů ve smyčce (${ukazka})`);
    }
    for (const m of text.matchAll(/^[^#\n]*require_loaded_env\s+"?COOLIFY_SERVER_UUID_([A-Z0-9_]+)/gm)) {
      out.push(`${kde}: require_loaded_env natvrdo na slot ${m[1]} — odvoď z --v-provozu`);
    }
  }
  return out;
}

/**
 * VĚDOMĚ ČÁSTEČNÉ výčty slotů — místa, kde chybějící slot nic neztratí. Každé nese
 * DŮVOD a pojistku, že důvod pořád platí; jinak by to byla schovaná výjimka.
 */
const VEDOME_CASTECNE = [
  {
    soubor: "config/coolify-environments.env",
    vzor: /^COOLIFY_(?:PROD|STAGING)_SERVER_(?:UUID|NAME)_([A-Z0-9_]+)=\$\{COOLIFY_(?:PROD|STAGING)_SERVER_(?:UUID|NAME)_\1:-\}$/gm,
    duvod:
      "šablona jen ZRCADLÍ proměnnou prostředí (X=${X:-}). Discovery čte " +
      "${ENV_PREFIX}SERVER_NAME_<SLOT> i SERVER_UUID_<SLOT> přímo z prostředí pro KAŽDÝ slot " +
      "registru, takže slot, který v šabloně chybí (build u stagingu, gpu), se tím neztratí.",
    pojistka: () => {
      const kod = cti("scripts/generate-coolify-context.mjs");
      return (
        kod.includes("process.env[`${ENV_PREFIX}SERVER_NAME_${slotUpper}`]") &&
        kod.includes("process.env[`${ENV_PREFIX}SERVER_UUID_${slotUpper}`]")
      );
    },
  },
];

/** Všechny rozdíly opisů proti registru. Prázdné = sedí. Čistá funkce — mutace ji krmí upravenými vstupy. */
export function rozdilySlotu(v: Vstupy): string[] {
  const vsechny = slotyServeru(v.servers);
  const umisteni = slotyUmisteni(v.servers);
  const out: string[] = [];

  const placement = uzel(v.servicesSchema, "definitions", "Service", "properties", "placement", "enum");
  if (!Array.isArray(placement)) out.push("services.schema.json: výčet placement nenalezen — měřidlo ztratilo cíl");
  else out.push(...rozdilMnozin("services.schema.json placement", umisteni, placement as string[]));

  const role = uzel(v.profilesSchema, "definitions", "Role", "pattern");
  if (typeof role !== "string") out.push("profiles.schema.json: vzor Role nenalezen — měřidlo ztratilo cíl");
  else out.push(...rozdilMnozin("profiles.schema.json Role", umisteni, literalyVzoru(role).filter((r) => r !== ROLE_MIMO_REGISTR)));

  const klice = uzel(v.serversSchema, "properties", "servers", "propertyNames", "enum");
  if (!Array.isArray(klice)) out.push("servers.schema.json: výčet propertyNames slotů nenalezen — měřidlo ztratilo cíl");
  else out.push(...rozdilMnozin("servers.schema.json propertyNames", vsechny, klice as string[]));

  const velka = vsechny.map((s) => s.toUpperCase());
  for (const misto of MISTA_ROZVODU) {
    const nalezeno = slotyNaMiste(v[misto.soubor], misto);
    if (nalezeno.size === 0) out.push(`${misto.kde}: místo rozvodu nenalezeno — měřidlo ztratilo cíl`);
    else out.push(...rozdilMnozin(misto.kde, velka, nalezeno));
  }

  out.push(...nalezySmycek({ coldStart: v.coldStart, coldStartEnv: v.coldStartEnv, doktor: v.doktor }, velka));
  return out;
}

const realne = (): Vstupy => ({
  servers: nactiSloty(ROOT),
  servicesSchema: json("config/services.schema.json"),
  profilesSchema: json("config/profiles.schema.json"),
  serversSchema: json("coolify/servers.schema.json"),
  coldStart: cti("scripts/aisha-cold-start.sh"),
  coldStartEnv: cti("scripts/aisha-cold-start-env.sh"),
  doktor: cti("scripts/cold-start-doctor.sh"),
});

const klon = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("sloty mají jeden seznam (registr coolify/servers.json)", () => {
  test("měřidlo má co měřit — registr i opisy jsou neprázdné", () => {
    const v = realne();
    expect(slotyUmisteni(v.servers).length, "registr bez slotů pro umístění").toBeGreaterThanOrEqual(3);
    for (const misto of MISTA_ROZVODU) {
      expect(slotyNaMiste(v[misto.soubor], misto).size, `${misto.kde}: nic nenalezeno`).toBeGreaterThanOrEqual(4);
    }
  });

  test("žádný opis se s registrem nerozešel", () => {
    expect(rozdilySlotu(realne())).toEqual([]);
  });

  test(`výjimka '${ROLE_MIMO_REGISTR}' ve vzoru Role pořád něco nese (jinak je to shnilá výjimka)`, () => {
    const profily = ["config/profiles/local-dev.json", "config/profiles/cloud-single.json", "config/profiles/cloud-multi.json"]
      .filter((p) => existsSync(join(ROOT, p)))
      .map((p) => json(p));
    expect(profily.some((p) => (p.servers ?? []).includes(ROLE_MIMO_REGISTR))).toBe(true);
    expect(Object.keys(nactiSloty(ROOT))).not.toContain(ROLE_MIMO_REGISTR);
  });
});

describe("vědomě částečné výčty mají důvod, který pořád platí", () => {
  for (const c of VEDOME_CASTECNE) {
    test(`${c.soubor}: místo existuje, nezná cizí slot a důvod platí`, () => {
      const nalezeno = new Set([...cti(c.soubor).matchAll(c.vzor)].map((m) => m[1]));
      expect(nalezeno.size, "výjimka bez místa = shnilá výjimka").toBeGreaterThan(0);
      const velka = slotyServeru(nactiSloty(ROOT)).map((x) => x.toUpperCase());
      expect([...nalezeno].filter((x) => !velka.includes(x)), "slot, který registr nezná").toEqual([]);
      expect(c.pojistka(), `důvod přestal platit: ${c.duvod}`).toBe(true);
    });
  }
});

describe("čtenáři registru volají jeho jediný domov (lib/sloty-serveru.mjs)", () => {
  /** Kód bez komentářových řádků — zmínka v poznámce není volání. */
  const kodBash = (p: string) => cti(p).split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");
  const kodJs = (p: string) => cti(p).split("\n").filter((r) => !/^\s*\/\//.test(r)).join("\n");
  const CTENARI_BASH: Array<{ soubor: string; prepinace: string[] }> = [
    // po discovery vyžaduje sloty v provozu; rozvod z prefixu, načtení a pin podle registru
    { soubor: "scripts/aisha-cold-start.sh", prepinace: ["--v-provozu", "--vsechny", "--pripnutelne"] },
    // varování o nenastaveném UUID jen pro sloty v provozu
    { soubor: "scripts/aisha-cold-start-env.sh", prepinace: ["--v-provozu"] },
    // fáze A (vstupy identity) a F (discovery) nad sloty v provozu; rozvod z prefixu podle registru
    { soubor: "scripts/cold-start-doctor.sh", prepinace: ["--v-provozu", "--vsechny"] },
  ];
  for (const c of CTENARI_BASH) {
    test(`${c.soubor} volá sloty-serveru.mjs ${c.prepinace.join(" ")}`, () => {
      const kod = kodBash(c.soubor);
      for (const p of c.prepinace) {
        expect(kod, `${c.soubor} nevolá sloty-serveru.mjs ${p}`).toMatch(new RegExp(`scripts/lib/sloty-serveru\\.mjs"?\\s+${p}\\b`));
      }
    });
  }

  test("generate-coolify-context.mjs bere sloty z registru, GPU slot nehádá a nemá vlastní kopii", () => {
    const kod = kodJs("scripts/generate-coolify-context.mjs");
    expect(kod).toMatch(/from '\.\/lib\/sloty-serveru\.mjs'/);
    expect(kod, "registr se čte jedním domovem").toMatch(/nactiSloty\(REPO_ROOT\)/);
    expect(kod, "hlášení nenamapovaných slotů jen pro sloty v provozu").toMatch(/slotyVProvozu\(/);
    expect(kod, "GPU slot vyžaduje výslovnou vazbu").toMatch(/vyzadujeVyslovnouVazbu\(slotDef\)/);
    expect(kod, "vestavěná kopie slotů by tiše nahradila nečitelný registr").not.toMatch(/DEFAULT_SLOT_DEFS/);
  });
});

describe("PIN chování: povinné sloty a sloty s výslovnou vazbou", () => {
  test("bez otevřených lan jsou v provozu PŘESNĚ frontend, backend, experimental", () => {
    // ⛔ ZMĚNA = VĚDOMÁ ZMĚNA POVINNÝCH SLOTŮ. Tenhle výčet se neodvozuje z katalogu,
    // který brána měří — je to pin chování: cold-start po discovery vyžaduje UUID
    // právě těchto slotů a doktor fáze F je měří. Kdo ho mění, mění to, co musí mít
    // každá instance (i ta bez GPU), a má to napsat sem i do zprávy commitu.
    expect([...slotyVProvozu({ servers: nactiSloty(ROOT), cti: () => undefined })].sort()).toEqual(
      ["backend", "experimental", "frontend"],
    );
  });

  test("výslovnou vazbu (has_gpu) vyžaduje PŘESNĚ slot gpu a pin ho nikdy nepřišpendlí", () => {
    // ⛔ Změna = vědomá změna toho, který slot discovery nesmí hádat.
    const s = nactiSloty(ROOT);
    expect(slotyServeru(s).filter((x) => vyzadujeVyslovnouVazbu(s[x]))).toEqual(["gpu"]);
    expect(slotyKPripnuti(s)).not.toContain("gpu");
    expect([...slotyKPripnuti(s)].sort()).toEqual(slotyServeru(s).filter((x) => x !== "gpu").sort());
  });
});

describe("mutace: slot přidaný jen na JEDNO místo bránu shodí", () => {
  const ZKUSEBNI = "zkusebni";

  test("jen do registru (coolify/servers.json)", () => {
    const v = realne();
    v.servers = { ...v.servers, [ZKUSEBNI]: { is_build_server: false } };
    const r = rozdilySlotu(v);
    expect(r.some((x) => x.startsWith("services.schema.json placement") && x.includes(ZKUSEBNI))).toBe(true);
    expect(r.some((x) => x.startsWith("profiles.schema.json Role") && x.includes(ZKUSEBNI))).toBe(true);
    expect(r.some((x) => x.startsWith("servers.schema.json propertyNames") && x.includes(ZKUSEBNI))).toBe(true);
    expect(r.filter((x) => x.includes(ZKUSEBNI.toUpperCase())).length, "rozvod v cold-startu").toBe(MISTA_ROZVODU.length);
  });

  test("jen do výčtu umístění (services.schema.json)", () => {
    const v = realne();
    v.servicesSchema = klon(v.servicesSchema);
    (uzel(v.servicesSchema, "definitions", "Service", "properties", "placement", "enum") as string[]).push(ZKUSEBNI);
    expect(rozdilySlotu(v)).toEqual([`services.schema.json placement: slot '${ZKUSEBNI}' registr nezná`]);
  });

  test("jen do vzoru Role (profiles.schema.json)", () => {
    const v = realne();
    v.profilesSchema = klon(v.profilesSchema);
    const role = uzel(v.profilesSchema, "definitions", "Role") as { pattern: string };
    role.pattern = role.pattern.replace("^(", `^(${ZKUSEBNI}|`);
    expect(rozdilySlotu(v)).toEqual([`profiles.schema.json Role: slot '${ZKUSEBNI}' registr nezná`]);
  });

  test("jen do výčtu klíčů registru (servers.schema.json)", () => {
    const v = realne();
    v.serversSchema = klon(v.serversSchema);
    (uzel(v.serversSchema, "properties", "servers", "propertyNames", "enum") as string[]).push(ZKUSEBNI);
    expect(rozdilySlotu(v)).toEqual([`servers.schema.json propertyNames: slot '${ZKUSEBNI}' registr nezná`]);
  });

  test("slot vypadlý z jednoho místa rozvodu (heredoc .env.coolify)", () => {
    const v = realne();
    v.coldStart = v.coldStart.replace(/^COOLIFY_SERVER_UUID_GPU=\$\{COOLIFY_SERVER_UUID_GPU:-\}\n/m, "");
    expect(rozdilySlotu(v)).toEqual(["cold-start heredoc (.env.coolify): chybí slot 'GPU'"]);
  });

  test("⛔ natvrdo zapsaná smyčka require_loaded_env přes sloty (tvar do 2026-10-02) = červená", () => {
    const v = realne();
    v.coldStart +=
      "\nfor required_target_key in \\\n  COOLIFY_PROJECT_UUID \\\n  COOLIFY_SERVER_UUID_FRONTEND \\\n" +
      "  COOLIFY_SERVER_UUID_BACKEND \\\n  COOLIFY_SERVER_UUID_EXPERIMENTAL; do\n  require_loaded_env \"$required_target_key\"\ndone\n";
    expect(rozdilySlotu(v).some((x) => x.includes("natvrdo zapsaná smyčka require_loaded_env"))).toBe(true);
  });

  test("⛔ require_loaded_env přímo na doslovný slot = červená", () => {
    const v = realne();
    v.doktor += "\nrequire_loaded_env COOLIFY_SERVER_UUID_GPU\n";
    expect(rozdilySlotu(v)).toEqual(["doktor: require_loaded_env natvrdo na slot GPU — odvoď z --v-provozu"]);
  });

  test("⛔ částečný doslovný výčet slotů ve smyčce (tvar doktora fáze A do 2026-10-02) = červená", () => {
    const v = realne();
    v.doktor +=
      "\nfor uuid_var in COOLIFY_SERVER_UUID_FRONTEND COOLIFY_SERVER_UUID_BACKEND COOLIFY_SERVER_UUID_EXPERIMENTAL; do\n" +
      "  [[ -n \"${!uuid_var:-}\" ]] && _uuid_override=1\ndone\n";
    expect(rozdilySlotu(v).some((x) => x.startsWith("doktor: částečný doslovný výčet slotů"))).toBe(true);
  });
});

describe("drift-check bere UUID slotu z knihovny, ne z opisu", () => {
  test("každý slot registru má UUID pod COOLIFY_SERVER_UUID_<SLOT>, neznámý slot je null", () => {
    const servers = nactiSloty(ROOT);
    for (const slot of slotyServeru(servers)) {
      expect(uuidSlotu(slot, { [klicUuidSlotu(slot)]: `uuid-${slot}` }, servers)).toBe(`uuid-${slot}`);
      expect(uuidSlotu(slot, {}, servers), `${slot} bez proměnné`).toBeNull();
    }
    expect(uuidSlotu("neznamy", { COOLIFY_SERVER_UUID_NEZNAMY: "x" }, servers)).toBeNull();
  });

  test("mutace: slot přidaný do registru drift-check změří bez zásahu do něj", () => {
    const servers = { ...nactiSloty(ROOT), novy: {} };
    expect(uuidSlotu("novy", { COOLIFY_SERVER_UUID_NOVY: "u" }, servers)).toBe("u");
  });

  test("coolify-drift-check.mjs nemá vlastní mapu slotů a nepřeskočí nezměřené mlčky", () => {
    const kod = cti("scripts/coolify-drift-check.mjs")
      .split("\n")
      .filter((r) => !/^\s*\/\//.test(r))
      .join("\n");
    expect(kod, "drift-check musí brát UUID z lib/sloty-serveru.mjs").toMatch(/from "\.\/lib\/sloty-serveru\.mjs"/);
    expect(kod, "opsané jméno proměnné slotu = druhý domov seznamu").not.toMatch(/COOLIFY_SERVER_UUID_[A-Z]/);
    expect(kod, "nezměřený server aplikace se musí vypsat").toMatch(/serverUnmeasured\.push/);
  });
});

describe("sloty v provozu — volitelný slot jen se svou lane", () => {
  const servers = () => nactiSloty(ROOT);
  const katalog = () => json("config/services.json").services as Record<string, { placement?: string; provision_when_env?: string | string[] }>;

  test("slot s povinnou službou (bez provision_when_env) je v provozu vždy", () => {
    const sluzby = katalog();
    const povinne = new Set(
      Object.values(sluzby)
        .filter((s) => s.placement && !s.provision_when_env)
        .map((s) => s.placement as string),
    );
    expect(povinne.size, "katalog nemá povinnou službu — vzorek nemá co měřit").toBeGreaterThan(0);
    const vProvozu = slotyVProvozu({ servers: servers(), sluzby, cti: () => undefined });
    for (const slot of povinne) expect(vProvozu).toContain(slot);
  });

  test("slot obsazený jen opt-in službami je v provozu právě tehdy, když je jejich lane otevřená", () => {
    const sluzby = katalog();
    const jenOptIn = slotyUmisteni(servers()).filter((slot) => {
      const tam = Object.values(sluzby).filter((s) => s.placement === slot);
      return tam.length > 0 && tam.every((s) => Boolean(s.provision_when_env));
    });
    expect(jenOptIn, "registr nemá volitelný slot — vzorek nemá co měřit").toContain("gpu");
    for (const slot of jenOptIn) {
      const priznaky = new Set(
        Object.values(sluzby)
          .filter((s) => s.placement === slot)
          .flatMap((s) => (Array.isArray(s.provision_when_env) ? s.provision_when_env : [s.provision_when_env as string])),
      );
      const zapnuto = (k: string) => (priznaky.has(k) ? "1" : undefined);
      const vypnuto = (k: string) => (priznaky.has(k) ? "false" : undefined);
      expect(slotyVProvozu({ servers: servers(), sluzby, cti: () => undefined })).not.toContain(slot);
      expect(slotyVProvozu({ servers: servers(), sluzby, cti: vypnuto }), "výslovné false je vypínač").not.toContain(slot);
      expect(slotyVProvozu({ servers: servers(), sluzby, cti: zapnuto })).toContain(slot);
    }
  });

  test("build server není nikdy slot umístění", () => {
    const s = servers();
    for (const slot of slotyServeru(s).filter((x) => s[x]?.is_build_server === true)) {
      expect(slotyUmisteni(s)).not.toContain(slot);
    }
  });
});
