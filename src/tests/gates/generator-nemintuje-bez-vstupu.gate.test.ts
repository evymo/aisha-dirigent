/**
 * Brána: generátor tajemství NEVYROBÍ stavový klíč nad existujícím stackem bez vstupu
 *
 * ⛔ NAMĚŘENO 2026-09-20/21 na nasazení jiné instance. Čerstvý worktree neměl ani
 * `.env.coolify`, ani `.env-prod-backup` (oba gitignored — v novém checkoutu prostě
 * nejsou). Generátor chybějící vstup přečetl jako „tajemství neexistují" a
 * vymintoval nové hodnoty: ze 197 spravovaných klíčů bylo 94 jiných, mezi nimi
 * PKI_SVAULT_KEY, COLUMN_ENCRYPTION_KEY, COSMOS_SIGNER_MNEMONIC, N8N_ENCRYPTION_KEY.
 * Klíč CA pak nešel dešifrovat („vault instance id does not match"), vydávání
 * certifikátů se zastavilo — a NIC NESPADLO. Generátor proběhl správně.
 *
 * Ochrana (`--preserve`) existovala, ale chrání jen hodnoty, které VIDÍ.
 * Závora proto stojí na VSTUPU: nad existujícím stackem je nepřítomný vstup
 * „nevím", ne „nic tam není".
 *
 * Měří se ČTYŘI konfigurace, protože každá brání jiné vadě:
 *   1. stack existuje + prázdný vstup → ODMÍTNOUT (a na stdout nesmí nic dorazit)
 *   2. čerstvá instalace             → vyrobit (jinak by závora zablokovala první nasazení)
 *   3. wipe nad stackem              → vyrobit (svazky jsou smazané, nic se nezničí)
 *   4. stack existuje + trezor       → ZACHOVAT (jinak by závora padala i tam, kde vstup je)
 * Bez 2–4 by šlo závoru „splnit" generátorem, který odmítá vždycky.
 * 5. VAPID pár se vyrábí MIMO `pg()` (posuzuje se naraz) → musí se k závoře hlásit
 *    sám; měří se, že bez vstupu odmítne a že pouhé odvození veřejného klíče ne.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const GEN = join(ROOT, "scripts", "generate-secrets.mjs");
const ARGS = [
  "--netbird-mgmt-host=host-gateway",
  "--mesh-tld=mesh.example.invalid",
  "--nocodb-admin-email=admin@example.test",
];

/** Prostředí bez všeho, co by verdikt řídilo zvenku — jen identita atrapy. */
function prostredi(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ["PATH", "HOME", "TMPDIR"]) if (process.env[k]) env[k] = process.env[k];
  env.APP_NAME_PREFIX = "zkouska";
  return env;
}

function spust(vstup: string, zaloha: string, extra: string[]) {
  const r = spawnSync(process.execPath, [GEN, `--env-coolify=${vstup}`, `--env-backup=${zaloha}`, ...ARGS, ...extra], {
    encoding: "utf8",
    env: prostredi(),
    maxBuffer: 16 * 1024 * 1024,
  });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const hodnota = (out: string, klic: string) => out.match(new RegExp(`^${klic}='([^']*)'$`, "m"))?.[1];

describe("generátor nevyrobí stavový klíč nad existujícím stackem bez vstupu", () => {
  const dir = mkdtempSync(join(tmpdir(), "generator-zavora-"));
  const prazdny = join(dir, "prazdny.env");
  const neni = join(dir, "neexistuje.env");
  writeFileSync(prazdny, "");

  it("1) stack existuje + prázdný vstup → odmítne a na stdout nic nepustí", () => {
    const r = spust(prazdny, neni, ["--stack-exists=1"]);
    expect(r.rc, `generátor měl odmítnout:\n${r.err.slice(-600)}`).toBe(3);
    // cold-start stdout `eval`uje — částečný výstup by část klíčů přepsal i tak.
    expect(r.out, "odmítnutí nesmí nic vypsat na stdout").toBe("");
    const dotcene = r.err.match(/Dotčené klíče: (.*)/)?.[1] ?? "";
    expect(dotcene, "hláška musí vyjmenovat stavové klíče").toMatch(/\bPKI_SVAULT_KEY\b/);
    expect(dotcene).toMatch(/\bCOLUMN_ENCRYPTION_KEY\b/);
    expect(dotcene).toMatch(/\bCOSMOS_SIGNER_MNEMONIC\b/);
    // Bezstavový JWT_SECRET se smí vyrobit kdykoli — mezi dotčenými být nesmí.
    expect(dotcene, "bezstavový klíč nesmí závoru spouštět").not.toMatch(/\bJWT_SECRET\b/);
    expect(r.err, "odmítnutí musí říct, odkud obnovit").toMatch(/trezor/i);
  });

  it("2) čerstvá instalace → vyrobí (závora nesmí zablokovat první nasazení)", () => {
    const r = spust(prazdny, neni, []);
    expect(r.rc, r.err.slice(-600)).toBe(0);
    expect(hodnota(r.out, "PKI_SVAULT_KEY"), "čerstvá instalace musí klíč dostat").toMatch(/.{16,}/);
  });

  it("3) wipe nad existujícím stackem → vyrobí (svazky jsou smazané)", () => {
    const r = spust(prazdny, neni, ["--stack-exists=1", "--strength-floor=1"]);
    expect(r.rc, r.err.slice(-600)).toBe(0);
    expect(hodnota(r.out, "PKI_SVAULT_KEY")).toMatch(/.{16,}/);
  });

  it("4) stack existuje + klíče v trezoru → ZACHOVÁ (závora nesmí padat tam, kde vstup je)", () => {
    const prvni = spust(prazdny, neni, []);
    expect(prvni.rc).toBe(0);
    const trezor = join(dir, "trezor.env");
    writeFileSync(trezor, prvni.out);
    const r = spust(prazdny, trezor, ["--stack-exists=1"]);
    expect(r.rc, `se vstupem v trezoru nemá odmítat:\n${r.err.slice(-600)}`).toBe(0);
    expect(hodnota(r.out, "PKI_SVAULT_KEY"), "stavový klíč se musí ZACHOVAT, ne vyměnit")
      .toBe(hodnota(prvni.out, "PKI_SVAULT_KEY"));
    expect(hodnota(r.out, "COLUMN_ENCRYPTION_KEY")).toBe(hodnota(prvni.out, "COLUMN_ENCRYPTION_KEY"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("5) VAPID pár (vyrábí se MIMO pg()) → nad existujícím stackem bez vstupu taky odmítne", () => {
    // Pár se posuzuje naraz (`lib/vapid-par.mjs`), ne přes `pg()` — kdyby se k závoře
    // nehlásil sám, vymintoval by nad živým stackem nový pár a odběry v prohlížečích
    // by tiše zanikly. Trezor nese VŠECHNO kromě páru, takže závoru spustí JEN on.
    const d = mkdtempSync(join(tmpdir(), "generator-zavora-vapid-"));
    try {
      const prazdnyVstup = join(d, "prazdny.env");
      writeFileSync(prazdnyVstup, "");
      const prvni = spust(prazdnyVstup, join(d, "neexistuje.env"), []);
      expect(prvni.rc, prvni.err.slice(-600)).toBe(0);
      const bezParu = prvni.out.split("\n").filter((r) => !/^WEB_PUSH_VAPID_(PUBLIC|PRIVATE)_KEY=/.test(r));
      const trezor = join(d, "trezor-bez-paru.env");
      writeFileSync(trezor, bezParu.join("\n"));

      const r = spust(prazdnyVstup, trezor, ["--stack-exists=1"]);
      expect(r.rc, `pár bez vstupu nad existujícím stackem měl závoru spustit:\n${r.err.slice(-600)}`).toBe(3);
      expect(r.out, "odmítnutí nesmí nic vypsat na stdout").toBe("");
      const dotcene = (r.err.match(/Dotčené klíče: (.*)/)?.[1] ?? "").split(", ").sort();
      expect(dotcene, "závoru má spustit PRÁVĚ pár — nic jiného v trezoru nechybí")
        .toEqual(["WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_PUBLIC_KEY"]);

      // Kontrola, že závora nepadá vždy: se soukromým klíčem v trezoru se veřejný
      // jen ODVODÍ — nic nového nevzniká, takže se nemá odmítat.
      const soukromy = prvni.out.split("\n").find((r2) => /^WEB_PUSH_VAPID_PRIVATE_KEY=/.test(r2)) ?? "";
      writeFileSync(trezor, [...bezParu, soukromy].join("\n"));
      const odvozeni = spust(prazdnyVstup, trezor, ["--stack-exists=1"]);
      expect(odvozeni.rc, `odvození veřejného klíče není mintování:\n${odvozeni.err.slice(-600)}`).toBe(0);
      expect(hodnota(odvozeni.out, "WEB_PUSH_VAPID_PUBLIC_KEY")).toBe(hodnota(prvni.out, "WEB_PUSH_VAPID_PUBLIC_KEY"));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("neznámá hodnota přepínače (true/yes/překlep) → odmítne, nevyrobí", () => {
    // Bezpečnostní přepínač, který by `true` tiše přečetl jako „neexistuje",
    // by závoru vypnul právě tomu, kdo ji chtěl zapnout.
    for (const h of ["true", "yes", "01"]) {
      const r = spust(prazdny, neni, [`--stack-exists=${h}`]);
      expect(r.rc, `--stack-exists=${h}: ${r.err.slice(-300)}`).toBe(2);
      expect(r.out, "odmítnutí nesmí nic vypsat na stdout").toBe("");
    }
  });

  it("cold-start předává generátoru, že stack existuje (--skip-create)", () => {
    // Závora, kterou nikdo nezapojí, je ozdoba: bez tohohle by generátor nikdy
    // nevěděl, že nad existujícím stackem běží, a vyráběl by dál.
    const cs = readFileSync(join(ROOT, "scripts", "aisha-cold-start.sh"), "utf8");
    expect(cs).toMatch(/--stack-exists="\$SKIP_CREATE"/);
  });
});
