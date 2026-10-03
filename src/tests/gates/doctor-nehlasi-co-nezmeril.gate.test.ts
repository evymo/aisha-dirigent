/**
 * Brána: doctor nehlásí to, co nezměřil.
 *
 * TŘÍDA VADY: preflight vydá VÝROK, na který nemá data — buď kontrolu přeskočí
 * („skipping"), nebo přizná neurčitost přímo v hlášce („buď — anebo"). Operátor
 * pak dostane žlutou, kterou nemá jak vyhodnotit, a naučí se ji přeskakovat.
 * Obojí naměřeno 2026-08-13 na riqu, oboje ve stejném běhu:
 *
 *   ⚠ FORGEJO_URL not set — skipping Forgejo reachability check
 *   ⚠ subnet NEODPOVÍDÁ odvození — buď vědomý override, nebo zděděná hodnota
 *
 * PRVNÍ: adresa Forgeja se čekala jako DEKLARACE. Chyběla, tak se kontrola
 * přeskočila — přestože Coolify staví všech 37 aplikací té instance právě
 * z toho Forgeja. Přeskočená kontrola nad POVINNOU závislostí je mlčení, ne
 * úspěch. Původ je přitom po ruce v `git remote`. Deklarace, kterou nikdo
 * nevyplní, je ozdoba; odvození je odpověď.
 *
 * DRUHÝ: kontrola porovnávala `.env.coolify` — NÁŠ VLASTNÍ výstup z minulého
 * běhu — proti odvození z identity, a rozdíl neuměla vysvětlit. Nemohla: k tomu
 * potřebuje vědět, jestli hodnotu někdo DEKLAROVAL, nebo jestli je to jen
 * setrvačnost, kterou týž běh o dvě fáze později přepíše. Pravidlo má domov
 * v generate-secrets (`declaredOverride`, #897) a teď ho sdílí i doctor.
 *
 * CO SE TU MĚŘÍ A CO JEN PINUJE — rovnou, ať zelená nevypadá jako důkaz víc,
 * než čím je:
 *   • obě rozhodnutí jsou čisté funkce a testují se SPUŠTĚNÍM (celá matice),
 *   • zapojení doctoru se pinuje textem (delegace na ty knihovny) — doctor je
 *     lineární skript, který se bez sítě a bez cizího REPO_ROOT nedá spustit
 *     po fázích.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { originHost } from "../../../scripts/lib/git-origin.mjs";
import { classifySubnetDrift } from "../../../scripts/lib/subnet-drift.mjs";
import { deriveSubnets } from "../../../scripts/lib/derive-subnets.mjs";

const ROOT = resolve(__dirname, "../../..");
const DOCTOR = join(ROOT, "scripts/cold-start-doctor.sh");

/** Reálné tvary, kterými git remote bývá zapsaný — včetně toho s tokenem. */
const REMOTES = [
  { url: "https://user:tajnytoken@repo.example.cz/org/repo.git", host: "https://repo.example.cz" },
  { url: "https://repo.example.cz/org/repo.git", host: "https://repo.example.cz" },
  { url: "https://repo.example.cz:8443/org/repo.git", host: "https://repo.example.cz:8443" },
  { url: "git@repo.example.cz:org/repo.git", host: "https://repo.example.cz" },
  { url: "ssh://git@repo.example.cz/org/repo.git", host: "ssh://repo.example.cz" },
  { url: "http://repo.example.cz/org/repo.git", host: "http://repo.example.cz" },
];

describe("doctor nehlásí to, co nezměřil", () => {
  describe("původ se ODVODÍ, nečeká se na deklaraci", () => {
    test.each(REMOTES)("$url → $host", ({ url, host }) => {
      expect(originHost(url)).toBe(host);
    });

    test("přihlašovací údaje se do odvozené adresy NIKDY nedostanou", () => {
      // Coolify má git_repository uložené i s tokenem a tahle hodnota jde do
      // logu cold-startu. Kdyby prošla, log by ho roznesl dál.
      for (const { url } of REMOTES) {
        const host = originHost(url);
        expect(host, `${url} → ${host}`).not.toMatch(/tajnytoken|@/);
      }
    });

    test("co není URL, nevydá adresu — a nesmí se tvářit jako úspěch", () => {
      for (const nesmysl of ["", "   ", "nejaky-text", "/cesta/na/disku"]) {
        expect(originHost(nesmysl)).toBe("");
      }
      // CLI to musí propustit návratovým kódem, aby to shell poznal.
      expect(() =>
        execFileSync("node", [join(ROOT, "scripts/lib/git-origin.mjs"), "nejaky-text"], {
          stdio: "pipe",
        }),
      ).toThrow();
    });

    test("doctor se ptá téhle knihovny a nemá vlastní kopii parsování", () => {
      const src = readFileSync(DOCTOR, "utf-8");
      expect(src, "Phase G musí delegovat na lib/git-origin.mjs").toMatch(/lib\/git-origin\.mjs/);
      expect(
        src,
        "chybějící FORGEJO_URL se nesmí „přeskočit“ — Coolify z toho Forgeja staví aplikace",
      ).not.toMatch(/skipping Forgejo/);
    });
  });

  describe("rozdíl v subnetu: DEKLARACE, nebo setrvačnost?", () => {
    const ID = "riq";
    const odvozene = deriveSubnets(ID);
    const stale = "10.99.0.0/24";

    test("zapsané sedí na odvození → OK", () => {
      const r = classifySubnetDrift({
        identity: ID,
        written: { MESH_DNS_SUBNET: odvozene.meshDns },
      });
      expect(r.verdikt).toBe("OK");
    });

    test("hodnota jen v .env.coolify = setrvačnost, kterou běh přepíše", () => {
      const r = classifySubnetDrift({ identity: ID, written: { MESH_DNS_SUBNET: stale } });
      expect(
        r.verdikt,
        "náš vlastní výstup z minulého běhu není operátorova volba — a tenhle běh ho přepíše",
      ).toBe("PREPISE");
      expect(r.polozky[0]).toContain(odvozene.meshDns);
    });

    test("prostředí SHODNÉ s vaultem je ozvěna, ne deklarace", () => {
      const r = classifySubnetDrift({
        identity: ID,
        written: { MESH_DNS_SUBNET: stale },
        vault: { MESH_DNS_SUBNET: stale },
        env: { MESH_DNS_SUBNET: stale },
      });
      expect(
        r.verdikt,
        "vault plníme my sami; hodnota, která se mu rovná, je ozvěna — totéž pravidlo jako v generate-secrets (#897)",
      ).toBe("PREPISE");
    });

    test("prostředí ODLIŠNÉ od vaultu je čerstvá deklarace — a ta se nasadí", () => {
      const r = classifySubnetDrift({
        identity: ID,
        written: { MESH_DNS_SUBNET: stale },
        vault: { MESH_DNS_SUBNET: stale },
        env: { MESH_DNS_SUBNET: "10.50.0.0/24" },
      });
      expect(r.verdikt).toBe("OVERRIDE");
      expect(r.polozky[0]).toContain("10.50.0.0/24");
    });

    test("bez identity se nic netvrdí", () => {
      expect(classifySubnetDrift({ identity: "", written: { MESH_DNS_SUBNET: stale } }).verdikt).toBe(
        "NEZMERENO",
      );
    });

    test("verdikt „buď — anebo“ z hlášek zmizel", () => {
      const src = readFileSync(DOCTOR, "utf-8");
      expect(
        src,
        "hláška, která přiznává, že kontrola nerozhodla, není nález — je to nedoměřená kontrola",
      ).not.toMatch(/buď vědomý override, nebo zděděná hodnota/);
      expect(src, "doctor musí delegovat na lib/subnet-drift.mjs").toMatch(/lib\/subnet-drift\.mjs/);
    });
  });
});
