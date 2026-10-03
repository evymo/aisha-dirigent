/**
 * Brána: řetěz deklarace identity má JEDEN domov — a měří se chováním.
 *
 * ── CO SE STALO (naměřeno 2026-08-13 na --wipe deployi) ─────────────────────
 * Otázka „která instance to je?" měla tři implementace, každou s jiným seznamem
 * kanálů a jiným pořadím:
 *
 *   aisha-cold-start.sh (bash prolog)  → prostředí, .env.local
 *   lib/coolify-instance-scope.mjs     → prostředí, .env.coolify
 *   generate-secrets.mjs firstNonEmpty → .env-prod-backup, prostředí, .env.coolify
 *
 * Instance, která identitu deklaruje v .env.coolify + .env-prod-backup a nemá
 * .env.local, pro bash prolog NEEXISTOVALA. STORY zůstalo prázdné, cesta
 * k manifestu vyšla „…/.manifest" a wipe skončil dřív, než cokoli udělal — přitom
 * chybová hláška o kus dál posílala operátora právě do .env.coolify. Obejít to
 * šlo jen ručním exportem, tedy krokem, který v autonomním cold-startu nesmí být.
 *
 * ── PROČ TO PŘEDCHOZÍ BRÁNA NECHYTILA ───────────────────────────────────────
 * Brána `verify-kanal-patri-fazi` tenhle stav CERTIFIKOVALA jako opravený.
 * Pinovala si literál `sed -n 's/^APP_NAME_PREFIX=//p' "$ENV_LOCAL"` a ověřovala,
 * že stojí před výpočtem STORY. Měřila tedy TVAR JEDNOHO KANÁLU, ne vlastnost
 * „identita je k dispozici dřív, než se z ní počítá". Sedmý případ — jiný kanál —
 * nikdy nedostala. Proto tahle brána nečte zdroják, ale SPOUŠTÍ obě strany
 * (node lib i bash helper) proti fixturám.
 *
 * MĚŘENÁ VLASTNOST
 *   1. každý deklarační kanál sám o sobě identitu vydá — v obou jazycích,
 *   2. nedeklarovaná identita je prázdná odpověď, ne dosazená,
 *   3. rozpor dvou kanálů je ODMÍTNUTÍ, ne volba vítěze,
 *   4. selhání nástroje se neplete s nálezem „nedeklarováno".
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const LIB = join(ROOT, "scripts/lib/coolify-instance-scope.mjs");
const SH = join(ROOT, "scripts/lib/instance-identity.sh");

/** Kanály, jimiž jde identitu deklarovat — každý musí sám o sobě stačit. */
const KANALY = [
  { soubor: ".env.local", hodnota: "zlokalu" },
  { soubor: ".env-prod-backup", hodnota: "zvaultu" },
  { soubor: ".env.coolify", hodnota: "zcoolify" },
] as const;

/** Fixtura = adresář s deklaračními soubory; identita se čte JEN z něj. */
function fixtura(soubory: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "aisha-identita-"));
  for (const [jmeno, obsah] of Object.entries(soubory)) {
    writeFileSync(join(dir, jmeno), obsah);
  }
  return dir;
}

/**
 * Prostředí bez zděděné identity. Bez tohohle by testy měřily shell, ve kterém
 * náhodou běží CI — a zelená by znamenala „exportováno", ne „odvozeno".
 */
function cisteProstredi(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, AISHA_IDENTITY_ROOT: root };
  delete env.APP_NAME_PREFIX;
  delete env.AISHA_STORY;
  delete env.ENV_FILE;
  delete env.ENV_PROD_BACKUP;
  return env;
}

/** Spustí node CLI proti fixtuře. Vrací i chybu — pád JE jeden z měřených stavů. */
function ptejSeNode(root: string, env?: NodeJS.ProcessEnv) {
  try {
    const stdout = execFileSync("node", [LIB, "--identity-shell"], {
      env: env ?? cisteProstredi(root),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { kod: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { kod: err.status ?? -1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/** Spustí bash helper proti fixtuře — druhá polovina téže vlastnosti. */
function ptejSeBash(root: string, env?: NodeJS.ProcessEnv) {
  const skript = `
    set -uo pipefail
    INSTANCE_DECLARED=0
    . "${SH}"
    declare_instance_identity "${root}"; rc=$?
    echo "rc=\${rc}"
    echo "declared=\${INSTANCE_DECLARED}"
    echo "prefix=\${APP_NAME_PREFIX:-}"
    echo "story=\${AISHA_STORY:-}"
    echo "source=\${AISHA_IDENTITY_SOURCE:-}"
  `;
  const out = execFileSync("bash", ["-c", skript], {
    cwd: ROOT,
    env: env ?? cisteProstredi(root),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return Object.fromEntries(
    out
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  ) as Record<string, string>;
}

function hodnota(stdout: string, klic: string): string {
  for (const line of stdout.split("\n")) {
    if (line.startsWith(`${klic}=`)) return line.slice(klic.length + 1);
  }
  return "";
}

describe("identita instance má jeden domov — měřeno chováním", () => {
  test.each(KANALY)(
    "kanál $soubor sám o sobě identitu vydá (node)",
    ({ soubor, hodnota: očekáváno }) => {
      const root = fixtura({ [soubor]: `APP_NAME_PREFIX=${očekáváno}\n` });
      try {
        const r = ptejSeNode(root);
        expect(r.kod, `${soubor}: CLI selhalo — ${r.stderr}`).toBe(0);
        expect(
          hodnota(r.stdout, "APP_NAME_PREFIX"),
          `identita deklarovaná v ${soubor} musí být čitelná; kanál, který se nečte, ` +
            "je pro cold-start neexistující instance",
        ).toBe(očekáváno);
        expect(
          hodnota(r.stdout, "AISHA_IDENTITY_SOURCE"),
          "provenance patří k odpovědi — u wipe rozhoduje, čí aplikace se smažou",
        ).toBe(soubor);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  test.each(KANALY)(
    "kanál $soubor sám o sobě identitu vydá i v shellu",
    ({ soubor, hodnota: očekáváno }) => {
      const root = fixtura({ [soubor]: `APP_NAME_PREFIX=${očekáváno}\n` });
      try {
        const r = ptejSeBash(root);
        expect(r.rc, `${soubor}: helper selhal`).toBe("0");
        expect(r.prefix, `${soubor} musí naplnit APP_NAME_PREFIX v shellu`).toBe(očekáváno);
        expect(
          r.story,
          "STORY se z prefixu odvodí — na něm visí cesta k manifestu",
        ).toBe(očekáváno);
        expect(
          r.declared,
          "deklarovaná identita musí projít fail-closed kontrolou cold-startu",
        ).toBe("1");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  test("AISHA_STORY je plnohodnotný deklarační klíč, ne jen alias", () => {
    const root = fixtura({ ".env.local": "AISHA_STORY=jenstory\n" });
    try {
      const r = ptejSeBash(root);
      expect(r.story).toBe("jenstory");
      expect(
        r.prefix,
        "prefix se z story odvodí — jinak by deklarace přes AISHA_STORY nepojmenovala aplikace",
      ).toBe("jenstory");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("nedeklarovaná identita je prázdná odpověď, nikdy dosazená", () => {
    const root = mkdtempSync(join(tmpdir(), "aisha-identita-prazdno-"));
    try {
      const r = ptejSeNode(root);
      expect(r.kod, "prázdno není chyba tohohle volání — fail-closed patří cold-startu").toBe(0);
      expect(
        hodnota(r.stdout, "APP_NAME_PREFIX"),
        "dosazená identita by z běhu udělala zásah do cizí instance, u wipe nevratný",
      ).toBe("");
      const b = ptejSeBash(root);
      expect(b.declared, "nedeklarováno musí zůstat nedeklarováno i v shellu").toBe("0");
      expect(b.prefix).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dva kanály, dvě různé odpovědi = odmítnutí, ne vítěz", () => {
    const root = fixtura({
      ".env.local": "APP_NAME_PREFIX=alfa\n",
      ".env.coolify": "APP_NAME_PREFIX=beta\n",
    });
    try {
      const r = ptejSeNode(root);
      expect(r.kod, "rozpor musí selhat — na sdíleném Coolify je špatná odpověď cizí nájemník").not.toBe(0);
      expect(r.stderr).toMatch(/alfa/);
      expect(r.stderr, "hláška musí ukázat OBĚ tvrzení, jinak operátor neví, co srovnat").toMatch(/beta/);
      const b = ptejSeBash(root);
      expect(b.rc, "shell musí rozpor propustit jako pád, ne jako prázdnou identitu").toBe("3");
      expect(b.declared).toBe("0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("shodná deklarace ve víc kanálech není rozpor", () => {
    const root = fixtura({
      ".env.local": "APP_NAME_PREFIX=stejne\n",
      ".env-prod-backup": "APP_NAME_PREFIX=stejne\n",
      ".env.coolify": "APP_NAME_PREFIX=stejne\n",
    });
    try {
      const r = ptejSeBash(root);
      expect(r.rc, "tohle je stav KAŽDÉ živé instance — nesmí padat").toBe("0");
      expect(r.prefix).toBe("stejne");
      expect(
        r.source,
        "zdrojem se hlásí deklarace operátora, ne .env.coolify, který generujeme my",
      ).toBe(".env.local");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("chybějící node je selhání NÁSTROJE, ne nález „nedeklarováno“", () => {
    const root = fixtura({ ".env.local": "APP_NAME_PREFIX=nedosazitelne\n" });
    const prazdnyBin = mkdtempSync(join(tmpdir(), "aisha-bez-node-"));
    mkdirSync(join(prazdnyBin, "bin"), { recursive: true });
    try {
      // PATH bez node: měření se NEMÁ podařit. Kdyby to helper spolkl a vrátil
      // prázdno, vypadalo by selhání nástroje jako platná odpověď „nikdo nic
      // nedeklaroval" — a u wipe je ten rozdíl vším.
      // (bash se volá absolutní cestou, jinak by prázdné PATH neuměl najít ani jeho —
      //  a test by měřil svou vlastní chybu místo měřené vlastnosti.)
      const env = { ...cisteProstredi(root), PATH: join(prazdnyBin, "bin") };
      const r = execFileSync(
        "/bin/bash",
        ["-c", `set -uo pipefail; INSTANCE_DECLARED=0; . "${SH}"; declare_instance_identity "${root}"; echo "rc=$?"`],
        { cwd: ROOT, env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(r, "chybějící node musí být vlastní návratový kód, ne tichá nula").toMatch(/rc=4/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(prazdnyBin, { recursive: true, force: true });
    }
  });

});
