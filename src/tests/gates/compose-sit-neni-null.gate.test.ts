/**
 * Položka sítě v compose nesmí mít PRÁZDNOU hodnotu
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * V mapovém zápisu `networks:` musí mít každá síť hodnotu: `{}`, blok s
 * `aliases:`, nebo seznamový tvar `- jmeno`. Holé `sit:` (YAML null) je zakázané.
 *
 * ── PROČ (naměřeno 2026-08-13) ────────────────────────────────────────────────
 * Vanilla docker compose bere `coolify:` (null) jako platné připojení. Coolify
 * ale compose před nasazením PŘEPISUJE — a null položky přitom ZAHODÍ. Změřeno
 * na živých kontejnerech jednoho hostu:
 *
 *     gateway     zápis `coolify: {}`   → na síti coolify JE
 *     pki-auth    zápis `- coolify`     → na síti coolify JE
 *     pki-bridge  zápis `coolify:`      → na síti coolify NENÍ (a mesh-dns také ne)
 *
 * Důsledek: Traefik na pki-bridge nedosáhl (504 po 30 s), mesh-dns síť zůstala
 * „osiřelá", a protože kontejner sám byl Healthy, nic to nehlásilo. Compose
 * preflight to nechytí — pro vanilla compose je ten zápis validní. Tvar, který
 * projde validací a přesto se ZTRATÍ při nasazení, musí hlídat brána.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const ROOT = process.cwd();

function composeSoubory(): string[] {
  return execFileSync("git", ["ls-files", "docker-compose*.yml"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

type Nalez = { soubor: string; radek: number; text: string };

/**
 * Najdi null položky v SERVICE-level `networks:` mapách.
 *
 * Držíme se odsazení (6 mezer = položka mapy sítí služby), protože zajímavé
 * jsou jen dva tvary řádků. Top-level `networks:` (definice sítí, odsazení 2)
 * sem nepatří — tam holý klíč znamená „síť s výchozí konfigurací" a Coolify
 * ho nezahazuje.
 */
function nullSite(soubor: string): Nalez[] {
  const radky = readFileSync(path.join(ROOT, soubor), "utf8").split("\n");
  const out: Nalez[] = [];
  let vSitich = false;

  for (let i = 0; i < radky.length; i++) {
    const radek = radky[i];
    if (/^ {4}networks:\s*$/.test(radek)) {
      vSitich = true;
      continue;
    }
    if (!vSitich) continue;

    const orez = radek.trim();
    if (orez === "" || orez.startsWith("#")) continue;
    // Konec bloku: cokoliv s odsazením ≤ 4, co není položka mapy sítí.
    if (!/^ {6}/.test(radek)) {
      vSitich = false;
      continue;
    }
    // Položka mapy s hodnotou null: `      jmeno:` a NIC za dvojtečkou.
    const m = radek.match(/^ {6}([a-z][a-z0-9_-]*):\s*$/);
    if (!m) continue;
    // Má položka tělo? Další ne-komentářový řádek s hlubším odsazením = má.
    let maTelo = false;
    for (let j = i + 1; j < radky.length; j++) {
      const dalsi = radky[j];
      const d = dalsi.trim();
      if (d === "" || d.startsWith("#")) continue;
      maTelo = /^ {8}/.test(dalsi);
      break;
    }
    if (!maTelo) out.push({ soubor, radek: i + 1, text: orez });
  }
  return out;
}

describe("compose: síť služby nesmí být null", () => {
  const soubory = composeSoubory();

  it("sonda má co měřit", () => {
    expect(soubory.length, "žádné compose soubory — git ls-files neběží nad stromem").toBeGreaterThan(10);
  });

  it("žádná služba nedeklaruje síť s prázdnou hodnotou", () => {
    const nalezy = soubory.flatMap(nullSite);
    expect(
      nalezy.map((n) => `${n.soubor}:${n.radek} ${n.text}`).sort(),
      "Null položka sítě projde compose validací, ale Coolify ji při nasazení\n" +
        "ZAHODÍ — kontejner na síti prostě není a nic to nehlásí (pki-bridge,\n" +
        "2026-08-13: Traefik 504, mesh-dns osiřelá). Zapiš `sit: {}`, blok\n" +
        "s aliases, nebo seznamový tvar `- sit`.",
    ).toEqual([]);
  });
});
