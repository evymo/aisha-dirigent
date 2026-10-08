#!/usr/bin/env node
// =============================================================================
// brany-dotcene-spust.mjs — spustí brány dotčené změnou, nebo poctivě celou dráhu
// =============================================================================
// Tenká slupka nad `brany-dotcene.mjs`: ten rozhoduje CO, tenhle to spouští.
// Rozdělení je schválné — rozhodnutí se dá otestovat orákulem
// (`vyber-bran-je-fail-closed.gate.test.ts`) bez toho, aby se přitom pouštěly
// skutečné testy.
//
// ⛔ CO SE STANE PŘI POCHYBNOSTI: pustí se CELÁ lehká dráha (~53 s). Není to
// nouzový režim, je to POCTIVÁ odpověď — mapa, která neznámou cestu mlčky
// prohlásí za nedotčenou, vyrábí zelenou, která znamená NEMĚŘENO. Přesně to
// se v `.github/workflows/ci.yml` (dříve v CI na vlastním serveru) stalo třikrát.
//
// Použití:
//   node scripts/test/brany-dotcene-spust.mjs [--base=<sha>] [--head=<sha>]
// Bez --base se bere `origin/HEAD`, jinak první commit větve.
// =============================================================================
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const arg = (n) => {
  const p = process.argv.slice(2).find((a) => a.startsWith(`${n}=`));
  return p ? p.slice(n.length + 1) : null;
};

/** Základ srovnání: co je na serveru. Bez něj nemá smysl mluvit o „změně“. */
function zjistiZaklad() {
  const zadany = arg("--base");
  if (zadany) return zadany;
  for (const kandidat of ["origin/HEAD", "origin/main"]) {
    try {
      return execFileSync("git", ["rev-parse", "--verify", "--quiet", kandidat], {
        cwd: ROOT,
        encoding: "utf-8",
      }).trim();
    } catch (e) {
      // Nenalezený kandidát není chyba (větev nemusí mít origin/main), ale
      // MLČET se nesmí: když selžou oba, uživatel má vědět proč se pouští
      // celá dráha. Hlídá brána `silent-degradation`.
      process.stderr.write(`  (základ ${kandidat} není: ${String(e.message).split("\n")[0]})\n`);
    }
  }
  return null;
}

const BASE = zjistiZaklad();
const HEAD = arg("--head") ?? "HEAD";

if (!BASE) {
  // Nezjištěný základ NENÍ prázdná změna.
  process.stderr.write(
    "brany-dotcene-spust: základ srovnání se nepodařilo zjistit (origin/HEAD ani origin/main) —\n" +
      "  pouštím CELOU lehkou dráhu, protože „nevím, co se změnilo“ neznamená „nezměnilo se nic“.\n",
  );
}

let plan = { rezim: "VSE_LEHKE", brany: [] };
if (BASE) {
  const r = spawnSync(
    "node",
    [path.join(ROOT, "scripts/test/brany-dotcene.mjs"), `--base=${BASE}`, `--head=${HEAD}`],
    { cwd: ROOT, encoding: "utf-8" },
  );
  if (r.status === 0 && r.stdout) {
    try {
      plan = JSON.parse(r.stdout);
    } catch (e) {
      // Chyba se POJMENUJE. Prázdný `catch {}` je přesně to ticho, na které
      // dnes doplatilo několik nálezů: bez důvodu se nedá poznat, jestli
      // selektor vrátil nesmysl, nebo nespustil vůbec.
      process.stderr.write(
        `brany-dotcene-spust: výstup selektoru nešel přečíst (${String(e.message).split("\n")[0]}) ` +
          `— celá lehká dráha.\n`,
      );
    }
  } else {
    process.stderr.write(
      `brany-dotcene-spust: selektor selhal (${r.status}) — celá lehká dráha.\n${r.stderr ?? ""}`,
    );
  }
}

const bezneEnv = { ...process.env, AISHA_SKIP_ONLINE: "1" };
let vysledek;

if (plan.rezim === "vyber" && plan.brany.length > 0) {
  process.stderr.write(
    `\n▸ dotčené brány: ${plan.brany.length} (ze změny ${plan.zmenenoSouboru ?? "?"} souborů)\n`,
  );
  vysledek = spawnSync(
    "node",
    [
      "scripts/test/run-vitest.mjs",
      "--config",
      "vitest.gates.config.ts",
      "--default-dir",
      "src/tests/gates/",
      ...plan.brany,
    ],
    { cwd: ROOT, stdio: "inherit", env: { ...bezneEnv, AISHA_GATES_LANE: "all" } },
  );
} else if (plan.rezim === "vyber") {
  process.stderr.write("\n▸ změna se žádné brány nedotkla (jen ignorované cesty) — nic nespouštím.\n");
  process.exit(0);
} else {
  process.stderr.write(`\n▸ celá lehká dráha — ${plan.duvod ?? "základ neznámý"}\n`);
  // Vypsat KTERÉ cesty mapa nezná. Bez toho se nedá rozhodnout, jestli je má
  // smysl do mapy doplnit, nebo jestli fail-closed je u nich správná odpověď
  // (u změn testovací infrastruktury zpravidla ano — dotýkají se všeho).
  for (const c of plan.neznameCesty ?? []) process.stderr.write(`    neznámá cesta: ${c}\n`);
  vysledek = spawnSync(
    "node",
    [
      "scripts/test/run-vitest.mjs",
      "--config",
      "vitest.gates.config.ts",
      "--default-dir",
      "src/tests/gates/",
    ],
    { cwd: ROOT, stdio: "inherit", env: { ...bezneEnv, AISHA_GATES_LANE: "light" } },
  );
}

process.exit(vysledek.status ?? 1);
