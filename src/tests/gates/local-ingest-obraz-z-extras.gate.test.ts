/**
 * Obraz local-ingest nese závislosti všech extrakčních lan — z pyproject extras enginu.
 *
 * ⛔ NAMĚŘENO 2026-09-15 v produkci forku: 77 z 79 chyb běhu ingestu bylo
 * „XLSX extraction needs openpyxl". Engine extra `xlsx` deklaroval, ale obraz
 * se staví z TOHOTO vendorovaného `Dockerfile.local-ingest`, a ten instaloval
 * ručně psaný seznam balíčků — třetí kopii (vedle `Dockerfile` a
 * `Dockerfile.advisory-cpu` enginu), ze které openpyxl vypadl. Nikdo seznamy
 * neporovnával; hláška „pip install '.[xlsx]'" radila do prázdna.
 *
 * Od opravy obraz instaluje přes `packages/local-ingest/scripts/image_extras.py
 * requirements <extra>…` a engine nese i měřidlo (`image_extras.py check`), které
 * z `INPUT_EXT` + `route()` + `LANE_EXTRAS/LANE_SYSTEM` odvodí, co lane potřebují.
 * Brána tu nepíše druhý seznam — spouští měřidlo enginu nad souborem stacku.
 *
 * CI brány checkoutují BEZ submodulů (viz ci.yml, job „Web: Tests"). Proto:
 *   - zákaz ručního `pip install` platí vždy (nepotřebuje engine),
 *   - plná kontrola běží všude, kde engine JE (lokální stack-smoke, plné klony),
 *     a bez něj řekne nahlas, co neprohlédla.
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const DOCKERFILE = join(ROOT, "Dockerfile.local-ingest");
const ENGINE = join(ROOT, "packages/local-ingest");
const MERIDLO = join(ENGINE, "scripts/image_extras.py");

/** Tvar z doby incidentu — ručně psaný seznam, ze kterého openpyxl vypadl. */
const RUCNI = [
  "FROM python:3.12-slim-bookworm",
  "RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ces",
  "RUN pip install --no-cache-dir pymupdf python-docx Pillow tiktoken numpy",
  "",
].join("\n");

/** RUN instrukce se spojenými pokračovacími řádky. */
function runy(text: string): string[] {
  const spojene = text.replace(/\\\r?\n/g, " ");
  return spojene.split(/\r?\n/).filter((l) => /^\s*RUN\s/i.test(l));
}

/** `pip install <balík>` bez `-r` — ruční seznam (nezávislé na enginu). */
function rucniPip(text: string): string[] {
  const nalezy: string[] = [];
  for (const run of runy(text)) {
    for (const cmd of run.replace(/^\s*RUN\s+/i, "").split(/&&|\|\||;|\|/)) {
      const tok = cmd.trim().split(/\s+/);
      const i = tok.indexOf("install");
      if (i < 0 || !tok.slice(0, i).some((t) => /(^|\/)pip3?$/.test(t))) continue;
      const args = tok.slice(i + 1);
      for (let j = 0; j < args.length; j++) {
        if (["-r", "--requirement", "-c", "--constraint"].includes(args[j])) { j++; continue; }
        if (args[j].startsWith(">")) break;
        if (!args[j].startsWith("-")) nalezy.push(args[j].replace(/^["']|["']$/g, ""));
      }
    }
  }
  return nalezy;
}

function python3(args: string[]) {
  const verze = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 11))"], { encoding: "utf8" });
  if (verze.error || verze.stdout.trim() !== "True") {
    throw new Error(
      "měřidlo obrazu potřebuje python3 ≥ 3.11 (tomllib) na PATH — nalezeno: " +
        (verze.error?.message ?? verze.stdout.trim()) + ". Vada prostředí, ne nález o obrazu.",
    );
  }
  return spawnSync("python3", args, { encoding: "utf8" });
}

describe("obraz local-ingest z extras enginu (brána)", () => {
  test("Dockerfile.local-ingest neinstaluje python balíčky ručně", () => {
    const rucne = rucniPip(readFileSync(DOCKERFILE, "utf8"));
    expect(
      rucne,
      "Dockerfile.local-ingest instaluje ručně: " + rucne.join(", ") +
        "\nPatří do extra v packages/local-ingest/pyproject.toml a do obrazu přes " +
        "`image_extras.py requirements <extra>`. Ruční seznam se rozejde — openpyxl 2026-09-15.",
    ).toEqual([]);
  });

  test("kontrolní vzorek: ruční seznam z doby incidentu je nález", () => {
    expect(rucniPip(RUCNI)).toEqual(["pymupdf", "python-docx", "Pillow", "tiktoken", "numpy"]);
    expect(rucniPip('RUN pip install --no-cache-dir -r /tmp/deps/r.txt > /dev/null\n')).toEqual([]);
  });

  test("obraz nese extras i systémové balíčky všech lan enginu", () => {
    if (!existsSync(join(ENGINE, "pyproject.toml"))) {
      console.warn(
        "local-ingest-obraz-z-extras: submodul packages/local-ingest není v checkoutu — " +
          "NEPROHLÉDNUTO, zda obraz nese závislosti lan (ruční pip hlídá test výš).",
      );
      return;
    }
    expect(existsSync(MERIDLO), "engine je v checkoutu, ale nemá scripts/image_extras.py — posuň gitlink").toBe(true);
    const r = python3([MERIDLO, "check", DOCKERFILE]);
    expect(r.status, `${r.stderr}${r.stdout}`).toBe(0);

    // Měřidlo musí umět říct „ne": tentýž soubor s ručním seznamem neprojde.
    const dir = mkdtempSync(join(tmpdir(), "obraz-extras-"));
    try {
      writeFileSync(join(dir, "Dockerfile"), RUCNI);
      const vzorek = python3([MERIDLO, "check", join(dir, "Dockerfile")]);
      expect(vzorek.status, "měřidlo nepoznalo ruční seznam bez openpyxl").toBe(1);
      expect(vzorek.stderr).toContain("lane 'xlsx'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
