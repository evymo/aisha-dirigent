import { afterAll, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { jmenaReferenci, povinneZaBehu, referenceCompose } from "./compose-env-refs.mjs";
import {
  hodnotyZCoolifyEnvs,
  kdoDoplni,
  nedorucene,
  popisNedorucenych,
  povinneSouboru,
  povinneZReferenci,
} from "./povinne-promenne.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(ROOT, "scripts/lib/povinne-promenne.mjs");
const TMP = mkdtempSync(join(tmpdir(), "povinne-promenne-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// Fixtura nese všechny tvary, na kterých se textový extraktor s compose rozcházel.
const COMPOSE = `services:
  app:
    image: \${IMAGE_APP:-cache.example.test/app:1}
    entrypoint: |
      # upstream *.\${IN_BLOCK_SCALAR:?}  ← pro YAML hodnota, compose interpoluje
      LOCAL=$\${ESCAPED_LOCAL:?}
      echo \\\${BACKSLASH_REQUIRED:?}
    environment:
      NONEMPTY: \${NONEMPTY:?nesmí být prázdné}
      SET_ONLY: \${SET_ONLY?stačí nastavené}
      STRICTEST: \${STRICTEST?první výskyt je mírný}
      STRICTEST_AGAIN: \${STRICTEST:?druhý přísný}
      BARE: \${BARE}
      DEFAULTED: \${DEFAULTED:-x}
      MAGIC: \${SERVICE_FQDN_APP:?}
      trailing: value  # \${ONLY_IN_COMMENT:?}
`;
const composeSoubor = join(TMP, "compose.yml");
writeFileSync(composeSoubor, COMPOSE);

describe("co je povinné, rozhoduje YAML — ne text", () => {
  const reference = referenceCompose(COMPOSE);
  const povinne = povinneZReferenci(reference);
  const jmena = povinne.map((p) => p.jmeno);

  test("block-scalar řádek s # i \\${X} jsou reference, $$ a komentář za hodnotou ne", () => {
    expect(jmena).toContain("IN_BLOCK_SCALAR");
    expect(jmena).toContain("BACKSLASH_REQUIRED");
    expect(jmena).not.toContain("ESCAPED_LOCAL");
    expect(jmena).not.toContain("ONLY_IN_COMMENT");
  });

  test("holé a defaultované nejsou povinné; SERVICE_* si doplní Coolify", () => {
    expect(jmena).not.toContain("BARE");
    expect(jmena).not.toContain("DEFAULTED");
    expect(jmena).not.toContain("IMAGE_APP");
    expect(jmena).not.toContain("SERVICE_FQDN_APP");
  });

  test("`:?` chce neprázdné, `?` jen nastavené, a rozhoduje nejpřísnější výskyt", () => {
    const podle = Object.fromEntries(povinne.map((p) => [p.jmeno, p.neprazdna]));
    expect(podle.NONEMPTY).toBe(true);
    expect(podle.SET_ONLY).toBe(false);
    expect(podle.STRICTEST).toBe(true);
  });

  test("režim bez-defaultu = holé i povinné; neznámý režim je chyba, ne prázdný výsledek", () => {
    const bezDefaultu = jmenaReferenci(reference, "bez-defaultu");
    expect(bezDefaultu).toContain("BARE");
    expect(bezDefaultu).toContain("NONEMPTY");
    expect(bezDefaultu).not.toContain("DEFAULTED");
    expect(() => jmenaReferenci(reference, "preklep")).toThrow(/neznámý režim/);
  });

  test("nevalidní YAML je výjimka — prázdný seznam by znamenal „nic nechybí“", () => {
    expect(() => referenceCompose("services:\n  a: [\n")).toThrow(/není validní YAML/);
  });
});

describe("doručeno × chybí × prázdné", () => {
  const povinne = [
    { jmeno: "A", neprazdna: true },
    { jmeno: "B", neprazdna: false },
    { jmeno: "C", neprazdna: true },
  ];

  test("chybí = klíč tam není; prázdné = je, ale `:?` ho odmítne; `?` prázdné přijme", () => {
    const v = nedorucene(povinne, new Map([["A", ""], ["B", ""]]));
    expect(v).toEqual({ chybi: ["C"], prazdne: ["A"], ok: false });
    expect(popisNedorucenych(v)).toBe("chybí C; prázdné A");
  });

  test("sonda musí jít zezelenat", () => {
    expect(nedorucene(povinne, new Map([["A", "1"], ["B", ""], ["C", "x"]])).ok).toBe(true);
  });

  test("envy Coolify: jen produkční záznamy, neprázdná hodnota nezmizí pod prázdnou", () => {
    const h = hodnotyZCoolifyEnvs([
      { key: "A", value: "", is_preview: false },
      { key: "A", value: "tajne", is_preview: false },
      { key: "P", value: "jen-preview", is_preview: true },
      { key: "N", value: null },
    ]);
    expect(h.get("A")).toBe("tajne");
    expect(h.has("P")).toBe(false);
    expect(h.get("N")).toBe("");
  });

  test("nepole z API NENÍ „aplikace nemá proměnné“ — je to neměřeno", () => {
    expect(() => hodnotyZCoolifyEnvs({ message: "Too Many Attempts." })).toThrow(/NEJDE změřit/);
  });

  test("náprava rozliší, co umí sync a co musí dodat env-doktor", () => {
    const sot = new Map([["V_SOT", "x"], ["PRAZDNY_V_SOT", ""]]);
    expect(kdoDoplni(["V_SOT", "PRAZDNY_V_SOT", "NIKDE"], sot)).toEqual({
      kSyncu: ["V_SOT"],
      kDoktorovi: ["PRAZDNY_V_SOT", "NIKDE"],
    });
    expect(kdoDoplni(["V_SOT"], null)).toEqual({ kSyncu: [], kDoktorovi: ["V_SOT"] });
  });
});

describe("CLI: kód odliší doručeno / nedoručeno / neměřeno", () => {
  const spust = (args, input) =>
    spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input, cwd: ROOT });
  const uplne = JSON.stringify(
    ["IN_BLOCK_SCALAR", "BACKSLASH_REQUIRED", "NONEMPTY", "SET_ONLY", "STRICTEST"].map((key) => ({
      key,
      value: key === "SET_ONLY" ? "" : "v",
      is_preview: false,
    })),
  );

  test("0 — vše doručeno (i prázdné `?`)", () => {
    const r = spust(["--compose", composeSoubor, "--coolify-envs", "-", "--app", "fixture"], uplne);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  test("1 — nedoručeno; hodnoty se nevypisují, jen jména", () => {
    const envs = JSON.parse(uplne).filter((e) => e.key !== "NONEMPTY");
    envs.find((e) => e.key === "STRICTEST").value = "";
    const r = spust(["--compose", composeSoubor, "--coolify-envs", "-", "--app", "fixture"], JSON.stringify(envs));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("chybí NONEMPTY");
    expect(r.stdout).toContain("prázdné STRICTEST");
    expect(r.stdout).not.toMatch(/\bv\b/);
  });

  test("1 + --sot — řekne, kterým příkazem to doručit", () => {
    const sot = join(TMP, "sot.env");
    writeFileSync(sot, "NONEMPTY=je-v-sot\n");
    const envs = JSON.parse(uplne).filter((e) => e.key !== "NONEMPTY");
    const r = spust(["--compose", composeSoubor, "--coolify-envs", "-", "--app", "fixture", "--sot", sot], JSON.stringify(envs));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("KEYS=NONEMPTY bash scripts/coolify-sync-envs.sh fixture");
    expect(r.stdout).not.toContain("je-v-sot");
  });

  test("2 — cizí tělo z API, nebo chybný vstup", () => {
    expect(spust(["--compose", composeSoubor, "--coolify-envs", "-"], "<html>").status).toBe(2);
    expect(spust(["--compose", composeSoubor, "--coolify-envs", "-"], '{"message":"x"}').status).toBe(2);
    expect(spust(["--compose", composeSoubor]).status).toBe(2);
    expect(spust(["--prepinac"]).status).toBe(2);
  });

  test("env soubor: prázdný řádek se počítá jako PRÁZDNÉ, ne jako chybějící", () => {
    const env = join(TMP, "local.env");
    writeFileSync(env, "IN_BLOCK_SCALAR=v\nBACKSLASH_REQUIRED=v\nNONEMPTY=\nSET_ONLY=\nSTRICTEST=v\n");
    const r = spust(["--compose", composeSoubor, "--env-file", env]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("prázdné NONEMPTY");
    expect(r.stdout).not.toContain("chybí");
  });
});

describe("povinné za běhu: `x-aisha-povinne-za-behu` (bez `:?`, tedy mimo build-time množinu)", () => {
  const ZA_BEHU = `x-aisha-povinne-za-behu: [KLIC_ZA_BEHU]
services:
  app:
    environment:
      KLIC_ZA_BEHU: "\${KLIC_ZA_BEHU}"
      PARSOVANI: "\${PARSOVANI:?}"
`;

  test("deklarované jméno je povinné a NEPRÁZDNÉ, i když ho compose interpoluje holé", () => {
    expect(povinneZaBehu(ZA_BEHU)).toEqual(["KLIC_ZA_BEHU"]);
    const soubor = join(TMP, "za-behu.yml");
    writeFileSync(soubor, ZA_BEHU);
    expect(povinneSouboru(soubor)).toEqual([
      { jmeno: "KLIC_ZA_BEHU", neprazdna: true },
      { jmeno: "PARSOVANI", neprazdna: true },
    ]);
  });

  test("bez pole se nic nemění (kontrola měřidla: holé `${X}` samo povinné NENÍ)", () => {
    const bez = ZA_BEHU.replace(/^x-aisha-povinne-za-behu:.*\n/, "");
    expect(povinneZaBehu(bez)).toEqual([]);
    expect(povinneZReferenci(referenceCompose(bez)).map((p) => p.jmeno)).toEqual(["PARSOVANI"]);
  });

  test("mrtvá deklarace (compose jméno neinterpoluje) i špatný tvar jsou výjimka, ne prázdno", () => {
    expect(() => povinneZaBehu(ZA_BEHU.replace("[KLIC_ZA_BEHU]", "[NIKDE]"))).toThrow(/neinterpoluje/);
    expect(() => povinneZaBehu(ZA_BEHU.replace("[KLIC_ZA_BEHU]", "KLIC_ZA_BEHU"))).toThrow(/seznam jmen/);
    expect(() => povinneZaBehu(ZA_BEHU.replace("[KLIC_ZA_BEHU]", "[\"s mezerou\"]"))).toThrow(/seznam jmen/);
  });

  // ⛔ Rollout klíče trezoru relací (ADR-004): po sloučení Deploy restartuje broker
  // na KAŽDÉ instanci s aplikací source-broker. Instance, která klíč ještě nemá,
  // musí skončit na PŘEDLETU s návodem — ne zeleným nasazením a mrtvým brokerem.
  describe("skutečný compose brokeru: instance bez FEDERATION_VAULT_KEY", () => {
    const BROKER = "docker-compose.coolify-source-broker.yml";
    const spust = (args, input) =>
      spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input, cwd: ROOT });
    const envyBez = (klic) =>
      povinneSouboru(BROKER)
        .filter((p) => p.jmeno !== "FEDERATION_VAULT_KEY")
        .map((p) => ({ key: p.jmeno, value: "v", is_preview: false }))
        .concat(klic === undefined ? [] : [{ key: "FEDERATION_VAULT_KEY", value: klic, is_preview: false }]);

    test("klíč tam není → předlet 1 a náprava přes env-doktora (ani SoT ho nemá)", () => {
      const sot = join(TMP, "sot-bez-klice.env");
      writeFileSync(sot, "SOURCE_API_URL=https://zdroj.invalid\n");
      const r = spust(
        ["--compose", BROKER, "--coolify-envs", "-", "--app", "source-broker", "--sot", sot],
        JSON.stringify(envyBez(undefined)),
      );
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout).toContain("chybí FEDERATION_VAULT_KEY");
      expect(r.stdout).toMatch(/aisha-env-doctor\.mjs/);
    });

    test("klíč v SoT je, jen nedoručený → náprava je sync jen toho klíče", () => {
      const sot = join(TMP, "sot-s-klicem.env");
      writeFileSync(sot, `FEDERATION_VAULT_KEY=${"ab".repeat(32)}\n`);
      const r = spust(
        ["--compose", BROKER, "--coolify-envs", "-", "--app", "source-broker", "--sot", sot],
        JSON.stringify(envyBez("")),
      );
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("prázdné FEDERATION_VAULT_KEY");
      expect(r.stdout).toContain("KEYS=FEDERATION_VAULT_KEY bash scripts/coolify-sync-envs.sh source-broker");
      expect(r.stdout).not.toContain("ab".repeat(32));
    });

    test("klíč doručený → předlet 0 (kontrola měřidla)", () => {
      const r = spust(
        ["--compose", BROKER, "--coolify-envs", "-", "--app", "source-broker"],
        JSON.stringify(envyBez("cd".repeat(32))),
      );
      expect(r.status, r.stdout + r.stderr).toBe(0);
    });
  });
});

// ⛔ Univerzum předletu = aplikace, které instance MÁ, ne každý compose ve stromu (třída #1077). Deploy guru
// nesmí spadnout na FEDERATION_VAULT_KEY brokeru, který na guru vůbec není. Tatáž cesta jako doktor fáze P
// (`--coolify --prefix`) nad falešným Coolify: projekt připnutý, aplikace z pole, envy doručené.
describe("celý projekt instance: aplikace, kterou instance nemá, se neměří", () => {
  const PROJEKT = "proj-guru-fixtura";
  const aplikaceInstance = [
    ["core", "docker-compose.coolify.yml"],
    ["admin", "docker-compose.coolify-admin.yml"],
    ["ai-chat", "docker-compose.coolify-ai-chat.yml"],
  ];
  const BROKER = ["source-broker", "docker-compose.coolify-source-broker.yml"];

  function envyPro(compose, bez = []) {
    return povinneSouboru(compose)
      .filter((p) => !bez.includes(p.jmeno))
      .map((p) => ({ key: p.jmeno, value: "v", is_preview: false }));
  }

  async function predlet(aplikace, envyBrokeru) {
    const apps = aplikace.map(([kratke, compose], i) => ({
      uuid: `app${i}uuid0000`, name: `aisha-${kratke}`, environment_id: 1, docker_compose_location: `/${compose}`,
    }));
    const server = createServer((req, res) => {
      const url = String(req.url);
      let telo;
      if (url === `/api/v1/projects/${PROJEKT}`) telo = { uuid: PROJEKT, environments: [{ id: 1 }] };
      else if (url === "/api/v1/applications") telo = apps;
      else {
        const m = url.match(/^\/api\/v1\/applications\/(app\d+uuid0000)\/envs$/);
        const app = m && apps.find((a) => a.uuid === m[1]);
        if (app) telo = app.name === "aisha-source-broker" ? envyBrokeru : envyPro(app.docker_compose_location.slice(1));
      }
      res.writeHead(telo ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(telo ?? { message: "not found" }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    try {
      return await new Promise((resolve) => {
        const p = spawn(process.execPath, [CLI, "--coolify", "--prefix", "aisha"], {
          cwd: ROOT,
          env: {
            PATH: process.env.PATH, HOME: process.env.HOME,
            COOLIFY_BASE_URL: `http://127.0.0.1:${port}`, COOLIFY_API_TOKEN: "fixtura",
            COOLIFY_PROJECT_UUID: PROJEKT, APP_NAME_PREFIX: "aisha", AISHA_ENV: "production",
          },
        });
        let out = "";
        p.stdout.on("data", (d) => (out += d));
        p.stderr.on("data", (d) => (out += d));
        p.on("close", (status) => resolve({ status, out }));
      });
    } finally {
      server.close();
    }
  }

  test("instance BEZ source-broker (jako guru): předlet 0, klíč trezoru nezmíní", async () => {
    const r = await predlet(aplikaceInstance);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`${aplikaceInstance.length}/${aplikaceInstance.length} aplikací`);
    expect(r.out).not.toContain("FEDERATION_VAULT_KEY");
  });

  test("kontrola měřidla: tatáž instance S brokerem bez klíče → předlet 1 a jmenuje klíč", async () => {
    const r = await predlet([...aplikaceInstance, BROKER], envyPro(BROKER[1], ["FEDERATION_VAULT_KEY"]));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("source-broker");
    expect(r.out).toContain("chybí FEDERATION_VAULT_KEY");
  });
});

describe("sync: funkce nad read-backem opravdu shazuje aplikaci", () => {
  // Měří se TÁŽ funkce, kterou sync volá — vyříznutá ze skriptu, ne přepsaná.
  const sync = readFileSync(join(ROOT, "scripts/coolify-sync-envs.sh"), "utf8");
  const funkce = /^over_povinne_na_aplikaci\(\) \{[\s\S]*?^\}/m.exec(sync)?.[0];
  const zavolej = (envsJson) =>
    spawnSync(
      "bash",
      ["-c", `R=; N=; ROOT="$1"; ENV_FILE="$2"\n${funkce}\nover_povinne_na_aplikaci "$3" "$4" fixture`, "_",
        ROOT, join(TMP, "sot.env"), envsJson, composeSoubor],
      { encoding: "utf8" },
    );

  test("funkce ve skriptu je", () => {
    expect(funkce, "over_povinne_na_aplikaci() ze sync skriptu zmizela").toBeTruthy();
  });

  test("nedoručená povinná → návrat 1 a výpis jmen", () => {
    const r = zavolej("[]");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("COMPOSE PŘI NASAZENÍ SPADNE");
    expect(r.stdout).toContain("NONEMPTY");
  });

  test("nečitelný read-back → návrat 2, NE úspěch", () => {
    expect(zavolej("").status).toBe(2);
  });

  test("vše doručeno → 0", () => {
    const envs = ["IN_BLOCK_SCALAR", "BACKSLASH_REQUIRED", "NONEMPTY", "SET_ONLY", "STRICTEST"].map((key) => ({ key, value: "v" }));
    expect(zavolej(JSON.stringify(envs)).status).toBe(0);
  });
});
