/**
 * n8n dostane balíček n8n-nodes-aisha z téhož commitu, a to tam, odkud ho
 * loader načte pod jménem, které čtou workflowy.
 *
 * ⛔ NAMĚŘENO 2026-09-17 (guru, n8n 1.79.0):
 *   · n8n neznal ani jeden typ `aisha*` (393 typů pověření, žádný aisha);
 *     `/home/node/.n8n/nodes` v kontejneru neexistoval — balíček do n8n
 *     nedoručovalo nic automaticky, jen ruční `npm run aisha:nodes:*`;
 *   · `N8N_CUSTOM_EXTENSIONS` mířil do neexistující cesty — a i kdyby existovala,
 *     CustomDirectoryLoader dává typům předponu `CUSTOM.`, kdežto workflowy
 *     čtou `n8n-nodes-aisha.aishaRpc`. Předponu balíčku dává jen loader nad
 *     `<nodesDownloadDir>/node_modules` (load-nodes-and-credentials.js v obrazu);
 *   · důsledek: provision-credentials skončil na první položce (neznámý typ),
 *     nevzniklo pověření „AISHA Webhook Auth“ ani ostatní a aktivní cron
 *     workflowy padaly ~2500× za 48 h na „Credentials not found“.
 *
 * ⭐ Měří se VLASTNOST nad parsovaným compose a CHOVÁNÍ skriptu doručení:
 *   1. každá služba s obrazem n8n čeká (service_completed_successfully) na init,
 *      který píše do TÉHOŽ svazku, jaký má n8n v /home/node/.n8n, a to do cesty
 *      `nodes/node_modules/<balíček>`;
 *   2. n8n nemá `N8N_CUSTOM_EXTENSIONS` (dvojí načtení pod `CUSTOM.*`);
 *   3. skript doručení nad skutečným manifestem balíčku vytvoří každý slíbený
 *      soubor a rozbitý balíček NENAHRADÍ funkční.
 *
 * Kompatibilitu uzlů s n8n-workflow nasazeného obrazu brána nezměří (starý
 * n8n-workflow v repu není) — tu měří za běhu scripts/n8n/overit-typy.mjs
 * proti běžícímu n8n a výsledek nese verdikt bootstrapu.
 */
import { afterAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(__dirname, "../../..");
const SKRIPT = join(ROOT, "infra/n8n/doruc-uzly-aisha.sh");
const BALICEK = join(ROOT, "packages/n8n-nodes-aisha/package.json");

type Svazek = string | { source?: string; target?: string };
type Sluzba = {
  image?: string;
  build?: { context?: string; dockerfile?: string };
  volumes?: Svazek[];
  environment?: string[] | Record<string, string>;
  depends_on?: string[] | Record<string, { condition?: string }>;
};

const N8N_DATA = "/home/node/.n8n";

function svazky(s: Sluzba): Array<{ zdroj: string; cil: string }> {
  return (s.volumes ?? []).flatMap((v) => {
    if (typeof v === "string") {
      const [zdroj, cil] = v.split(":");
      return zdroj && cil ? [{ zdroj, cil }] : [];
    }
    return v.source && v.target ? [{ zdroj: v.source, cil: v.target }] : [];
  });
}

function promenne(s: Sluzba): string[] {
  const env = s.environment ?? [];
  return Array.isArray(env) ? env.map((r) => r.split("=")[0]) : Object.keys(env);
}

/** CMD z posledního stage Dockerfile (JSON tvar). */
function posledniCmd(dockerfile: string): string[] | null {
  const radky = readFileSync(dockerfile, "utf8").split("\n").filter((r) => /^CMD\s+\[/.test(r));
  const posledni = radky.at(-1);
  return posledni ? (JSON.parse(posledni.replace(/^CMD\s+/, "")) as string[]) : null;
}

const SOUBORY = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f)).sort();

const N8N_SLUZBY = SOUBORY.flatMap((soubor) => {
  const dok = parseYaml(readFileSync(join(ROOT, soubor), "utf8"), { merge: true }) as {
    services?: Record<string, Sluzba>;
  };
  const sluzby = dok?.services ?? {};
  return Object.entries(sluzby)
    .filter(([, s]) => /\$\{IMAGE_N8N\}/.test(s?.image ?? ""))
    .map(([jmeno, s]) => ({ soubor, jmeno, sluzba: s, vsechny: sluzby }));
});

describe("n8n dostane balíček n8n-nodes-aisha (brána)", () => {
  test("univerzum: měřidlo vidí služby s obrazem n8n (hlavní i worker)", () => {
    expect(N8N_SLUZBY.length, "žádná služba s ${IMAGE_N8N} — měřidlo přestalo vidět").toBeGreaterThanOrEqual(2);
  });

  test("⛔ každá služba n8n čeká na init, který balíček zapíše do jejího svazku pod nodes/node_modules", () => {
    const jmenoBalicku = (JSON.parse(readFileSync(BALICEK, "utf8")) as { name: string }).name;
    const vady: string[] = [];
    for (const { soubor, jmeno, sluzba, vsechny } of N8N_SLUZBY) {
      const data = svazky(sluzba).find((v) => v.cil === N8N_DATA);
      if (!data) {
        vady.push(`${soubor}:${jmeno} — bez svazku v ${N8N_DATA}`);
        continue;
      }
      const deps = sluzba.depends_on;
      const hotove = Array.isArray(deps)
        ? []
        : Object.entries(deps ?? {})
            .filter(([, d]) => d?.condition === "service_completed_successfully")
            .map(([j]) => j);
      const doruceni = hotove.filter((init) => {
        const s = vsechny[init];
        const dockerfile = s?.build?.dockerfile;
        if (!s || !dockerfile) return false;
        const pripojeni = svazky(s).find((v) => v.zdroj === data.zdroj);
        const cmd = existsSync(join(ROOT, dockerfile)) ? posledniCmd(join(ROOT, dockerfile)) : null;
        if (!pripojeni || !cmd) return false;
        // CMD: [skript, zdroj-balíčku, kořen-svazku] — kořen musí být místo, kam je svazek připojen.
        return cmd[0]?.endsWith("/doruc-uzly-aisha.sh") && cmd.at(-1) === pripojeni.cil;
      });
      if (doruceni.length === 0) {
        vady.push(`${soubor}:${jmeno} — nečeká na init, který zapíše ${jmenoBalicku} do svazku ${data.zdroj}`);
      }
    }
    expect(vady, vady.join("\n")).toEqual([]);
  });

  test("⛔ n8n nemá N8N_CUSTOM_EXTENSIONS — loader by typy načetl podruhé pod předponou CUSTOM.", () => {
    const vady = N8N_SLUZBY.filter(({ sluzba }) => promenne(sluzba).includes("N8N_CUSTOM_EXTENSIONS")).map(
      ({ soubor, jmeno }) => `${soubor}:${jmeno}`,
    );
    expect(vady, vady.join("\n")).toEqual([]);
  });

  describe("skript doručení nad skutečným manifestem balíčku", () => {
    const tmp = mkdtempSync(join(tmpdir(), "n8n-uzly-"));
    afterAll(() => rmSync(tmp, { recursive: true, force: true }));

    /** Falešný sestavený balíček: skutečný package.json, prázdné soubory na slíbených cestách. */
    function sestav(adresar: string, vynech?: string) {
      const manifest = JSON.parse(readFileSync(BALICEK, "utf8")) as { n8n: { nodes: string[]; credentials: string[] } };
      mkdirSync(adresar, { recursive: true });
      cpSync(BALICEK, join(adresar, "package.json"));
      for (const soubor of [...manifest.n8n.nodes, ...manifest.n8n.credentials]) {
        if (soubor === vynech) continue;
        mkdirSync(join(adresar, soubor, ".."), { recursive: true });
        writeFileSync(join(adresar, soubor), "");
      }
      return [...manifest.n8n.nodes, ...manifest.n8n.credentials];
    }
    const spust = (zdroj: string, koren: string) =>
      spawnSync("sh", [SKRIPT, zdroj, koren], { encoding: "utf8" });

    test("jq je na PATH — skript manifest čte přes jq (obraz init ho instaluje, CI krok „Install jq“)", () => {
      const r = spawnSync("sh", ["-c", "command -v jq"], { encoding: "utf8" });
      expect(r.status, "jq chybí — brána spouští skutečný skript doručení, bez jq nic nezměří").toBe(0);
    });

    test("platný balíček → každý slíbený soubor leží v <kořen>/nodes/node_modules/n8n-nodes-aisha", () => {
      const slibene = sestav(join(tmp, "zdroj-ok"));
      const koren = join(tmp, "svazek");
      const r = spust(join(tmp, "zdroj-ok"), koren);
      expect(r.status, r.stderr).toBe(0);
      const cil = join(koren, "nodes/node_modules/n8n-nodes-aisha");
      expect(slibene.length).toBeGreaterThan(5);
      for (const soubor of slibene) expect(existsSync(join(cil, soubor)), soubor).toBe(true);
      expect(existsSync(`${cil}.novy`) || existsSync(`${cil}.stary`)).toBe(false);
    });

    test("⛔ balíček, kterému chybí slíbený soubor, se NEDORUČÍ a funkční verze zůstane", () => {
      const koren = join(tmp, "svazek");
      const cil = join(koren, "nodes/node_modules/n8n-nodes-aisha");
      const manifest = JSON.parse(readFileSync(BALICEK, "utf8")) as { n8n: { nodes: string[] } };
      const obet = manifest.n8n.nodes[0];
      expect(existsSync(join(cil, obet)), "předchozí test měl doručit funkční verzi").toBe(true);
      sestav(join(tmp, "zdroj-rozbity"), obet);
      const r = spust(join(tmp, "zdroj-rozbity"), koren);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(obet);
      expect(existsSync(join(cil, obet)), "rozbitý balíček přepsal funkční").toBe(true);
    });
  });
});
