/**
 * Override je DEKLARACE, ne OZVĚNA vlastního výstupu
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Hodnota, která se ODVOZUJE z identity instance, se nesmí dát přebít tím, že
 * se vrátí zpátky vlastním kanálem. Operátorská volba ano — setrvačnost ne.
 *
 * ── PROČ (naměřeno 2026-08-13) ────────────────────────────────────────────────
 * Cesta mesh-DNS subnetu tvořila uzavřený kruh:
 *
 *   generate-secrets → Coolify → coolify-pull-envs → .env-prod-backup
 *        → cold-start `load_env_file_keys … overwrite` → process.env
 *        → generate-secrets to čte jako „operátorský override"
 *
 * Odvození z identity (deterministické, volný rozsah) se tedy NIKDY nedostalo
 * ke slovu a zděděná hodnota byla nesmrtelná. Na varře už tentýž rozsah držel
 * cizí nájemník, takže `docker network create` padal na „Pool overlaps with
 * other one on this address space" — a mesh na experimental uzlu nevstal.
 *
 * Dvakrát se to už zavřít pokusili a pokaždé jinými dveřmi:
 *   1. z kódu zmizel LITERÁLNÍ default rozsahu („instanční kolizní past"),
 *   2. `preservedValue` dostal výslovnou výjimku, aby subnety NEzachovával.
 * Hodnota se přesto vrátila — třetími dveřmi, override kanálem. Proto brána
 * neměří TEXT (ten už dvakrát „seděl"), ale CHOVÁNÍ skutečného skriptu.
 *
 * ── CO SE MĚŘÍ ────────────────────────────────────────────────────────────────
 * 1. env == vault (ozvěna)  → hodnota se ODVODÍ z identity,
 * 2. env != vault (čerstvá deklarace) → hodnota se CTÍ,
 * 3. výslovný CLI argument → CTÍ SE VŽDY, i když se rovná vaultu,
 * 4. resolver NÁSLEDUJE subnet (nesmí zůstat mimo vlastní síť).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const ROOT = process.cwd();
const GENERATE = path.join(ROOT, "scripts/generate-secrets.mjs");

/** Identita, ze které se odvozuje — libovolná, jen musí být neprázdná a stabilní. */
const IDENTITA = "brana-ozvena";

/** Rozsah, který „drží cizí nájemník" — role zděděné hodnoty ve vaultu. */
const ZDEDENY_SUBNET = "10.99.0.0/24";
const ZDEDENY_RESOLVER = "10.99.0.250";
/** Rozsah, který operátor VOLÍ teď — musí se odlišit od zděděného. */
const DEKLAROVANY_SUBNET = "10.50.0.0/24";

/**
 * Spustí skutečný generate-secrets a vrátí jeho emitované klíče.
 *
 * Vault je dočasný soubor: brána nikdy nesmí číst ani psát provozní
 * `.env-prod-backup` — to je trezor instance, ne testovací přípravek.
 */
function spustGenerator(opts: {
  vault: Record<string, string>;
  env: Record<string, string>;
  args?: string[];
}): Map<string, string> {
  const dir = mkdtempSync(path.join(tmpdir(), "aisha-ozvena-"));
  try {
    const vaultPath = path.join(dir, "vault.env");
    writeFileSync(
      vaultPath,
      Object.entries(opts.vault)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
    );

    const out = execFileSync("node", [GENERATE, ...(opts.args ?? [])], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        APP_NAME_PREFIX: IDENTITA,
        ENV_PROD_BACKUP: vaultPath,
        // Výstupní soubor NEnastavujeme — skript emituje na stdout a nesmí
        // sáhnout na žádný sledovaný soubor v repu.
        ENV_COOLIFY: "",
        ...opts.env,
      },
    });

    const map = new Map<string, string>();
    for (const line of out.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)='?([^']*)'?$/);
      if (m) map.set(m[1], m[2]);
    }
    return map;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("override je deklarace, ne ozvěna", () => {
  it("hodnota z prostředí SHODNÁ s vaultem je ozvěna — odvodí se z identity", () => {
    const emitted = spustGenerator({
      vault: { MESH_DNS_SUBNET: ZDEDENY_SUBNET, MESH_DNS_RESOLVER_IP: ZDEDENY_RESOLVER },
      env: { MESH_DNS_SUBNET: ZDEDENY_SUBNET, MESH_DNS_RESOLVER_IP: ZDEDENY_RESOLVER },
    });

    const subnet = emitted.get("MESH_DNS_SUBNET");
    expect(subnet, "generate-secrets nevydal MESH_DNS_SUBNET — brána nic neměřila").toBeTruthy();
    expect(
      subnet,
      "Zděděný rozsah z vaultu přebil odvození. To je ten kruh:\n" +
        "  generate-secrets → Coolify → coolify-pull-envs → vault → env → „override\".\n" +
        "Na sdíleném hostiteli tak instance dostane rozsah, který už drží někdo jiný,\n" +
        "a `docker network create` padne na „Pool overlaps\" — mesh nevstane.",
    ).not.toBe(ZDEDENY_SUBNET);

    // Resolver musí následovat subnet. Kdyby zůstal zděděný, mířil by MIMO
    // vlastní síť a Docker to ohlásí až u startu kontejneru — nejdál od příčiny.
    const resolver = emitted.get("MESH_DNS_RESOLVER_IP") ?? "";
    expect(resolver, "resolver zůstal na zděděné adrese mimo odvozenou síť").not.toBe(
      ZDEDENY_RESOLVER,
    );
    expect(
      resolver.split(".").slice(0, 3).join("."),
      `resolver ${resolver} neleží uvnitř ${subnet}`,
    ).toBe(String(subnet).split(".").slice(0, 3).join("."));
  });

  it("hodnota z prostředí ODLIŠNÁ od vaultu je čerstvá deklarace — ctí se", () => {
    // Bez tohohle směru by „oprava" byla jen zrušením override kanálu. Operátor,
    // který rozsah SKUTEČNĚ volí (dvě instance na jednom hostu), ho dostat musí.
    const emitted = spustGenerator({
      vault: { MESH_DNS_SUBNET: ZDEDENY_SUBNET },
      env: { MESH_DNS_SUBNET: DEKLAROVANY_SUBNET },
    });

    expect(
      emitted.get("MESH_DNS_SUBNET"),
      "Čerstvá deklarace se zahodila — override kanál je tím fakticky mrtvý",
    ).toBe(DEKLAROVANY_SUBNET);
  });

  it("výslovný CLI argument vyhrává i tehdy, když se rovná vaultu", () => {
    // Operátor smí vědomě potvrdit i hodnotu, kterou vault nese: `--mesh-dns-subnet`
    // je jednoznačný úmysl, ne setrvačnost. Bez téhle větve by nešlo zvolit rozsah,
    // který stack už jednou používal.
    const emitted = spustGenerator({
      vault: { MESH_DNS_SUBNET: ZDEDENY_SUBNET },
      env: { MESH_DNS_SUBNET: ZDEDENY_SUBNET },
      args: ["--mesh-dns-subnet", ZDEDENY_SUBNET],
    });

    expect(
      emitted.get("MESH_DNS_SUBNET"),
      "CLI argument neprošel — výslovná volba operátora se ztrácí",
    ).toBe(ZDEDENY_SUBNET);
  });

  it("prázdný vault + prázdné prostředí → odvození (základní stav forku)", () => {
    // Nová instance nemá vault ani exporty. Musí dostat rozsah z identity —
    // a shodný s tím, co dostane po ozvěně, jinak by se stack po prvním
    // pull-envs přestěhoval na jinou síť.
    const cisty = spustGenerator({ vault: {}, env: {} });
    const poOzvene = spustGenerator({
      vault: { MESH_DNS_SUBNET: ZDEDENY_SUBNET },
      env: { MESH_DNS_SUBNET: ZDEDENY_SUBNET },
    });

    expect(cisty.get("MESH_DNS_SUBNET"), "čistý běh nevydal rozsah").toBeTruthy();
    expect(
      poOzvene.get("MESH_DNS_SUBNET"),
      "táž identita dala po ozvěně JINÝ rozsah než načisto — odvození není deterministické",
    ).toBe(cisty.get("MESH_DNS_SUBNET"));
  });
});
