/**
 * vault-reverse-sync.gate.test.ts — the credential-vault durability contract.
 *
 * The ONLY durable copy of the stack-internal secrets is otherwise the gitignored
 * local vault; a --wipe that regenerates lost secrets is unrecoverable (encryption
 * keys, validator identity). coolify-pull-envs.mjs REVERSE-SYNCs the live Coolify
 * store (a durable server-side copy) back into .env-prod-backup so generate-secrets'
 * firstNonEmpty() preserves the SAME values.
 *
 * This gate enforces that the tool is a DRY EXTENSION of the existing single-sources
 * (no re-implemented Coolify I/O) and is SCOPED to managed secrets — never derived
 * config, whose stale copy in the vault would deploy old images/domains.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const PULL = join(ROOT, "scripts/coolify-pull-envs.mjs");
const STORE = join(ROOT, "scripts/lib/coolify-env-store.mjs");

describe("vault reverse-sync — durability contract", () => {
  test("generate-secrets --print-keys is the managed-secret SoT (secrets in, derived config out)", () => {
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/generate-secrets.mjs"), "--print-keys"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const keys = new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    expect(keys.size, "managed-secret set should be substantial").toBeGreaterThan(80);
    // Durability-critical secrets MUST be in the managed set (so they get preserved/recovered).
    for (const k of ["POSTGRES_PASSWORD", "JWT_SECRET", "VAULT_ENCRYPTION_KEY", "COLUMN_ENCRYPTION_KEY", "COSMOS_SIGNER_MNEMONIC", "AISHA_PKI_ISSUER_CLIENT_SECRET"]) {
      expect(keys.has(k), `${k} must be a managed secret (durability-critical)`).toBe(true);
    }
    // Derived/volatile config MUST NOT be managed — else a stale reverse-synced copy
    // in the highest-precedence vault would deploy old images/domains on a wipe.
    for (const k of ["GIT_SHA", "LOG_LEVEL", "KEYCLOAK_DOMAIN", "NOCODB_DOMAIN", "REGISTRY_PROXY", "IMAGE_NOCODB"]) {
      expect(keys.has(k), `${k} is derived config — must NOT be a managed secret (stale-deploy risk)`).toBe(false);
    }
  });

  /**
   * Hodnoty počítané z identity: „managed" být MUSÍ (generate-secrets je emituje),
   * do vaultu se ale dostat NESMÍ.
   *
   * ── PROČ ZVLÁŠŤ ───────────────────────────────────────────────────────────────
   * Test výš měří tutéž vlastnost VZORKEM šesti ručně vypsaných jmen. To stačí,
   * dokud je odvozená hodnota mimo `--print-keys`. Jenže subnety generate-secrets
   * sám počítá a sám emituje — jsou tedy „managed" i „derived" zároveň a skrz
   * vzorek propadly. NAMĚŘENO 2026-08-13: MESH_DNS_SUBNET přežil ve vaultu,
   * přebil odvození a mesh na varře nevstal („Pool overlaps").
   *
   * Proto se tady iteruje CELÁ rodina z jejího jediného domova, ne výběr jmen.
   */
  test("hodnoty odvozené z identity se nesmějí zpětně synchronizovat do vaultu", async () => {
    const { DERIVED_NETWORK_KEYS } = await import(
      /* @vite-ignore */ join(ROOT, "scripts/lib/derive-subnets.mjs")
    );
    expect(DERIVED_NETWORK_KEYS.length, "seznam odvozených klíčů je prázdný — nic se neměří").toBeGreaterThan(0);

    const out = execFileSync(process.execPath, [join(ROOT, "scripts/generate-secrets.mjs"), "--print-keys"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const managed = new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    const js = readFileSync(PULL, "utf-8");

    for (const k of DERIVED_NETWORK_KEYS) {
      // Kdyby klíč z emise vypadl, seznam by shnil a brána by hlídala prázdno.
      expect(
        managed.has(k),
        `${k} už generate-secrets neemituje — seznam DERIVED_NETWORK_KEYS je zastaralý`,
      ).toBe(true);
    }

    // Vyloučení musí být VLASTNOSTÍ kódu, ne shodou jmen: reverse-sync ten seznam
    // importuje ze stejného domova, kde hodnoty vznikají.
    expect(
      /DERIVED_NETWORK_KEYS/.test(js),
      "coolify-pull-envs nezná rodinu odvozených klíčů — zpětná synchronizace by je\n" +
        "vrátila do vaultu, odkud přebijí odvození (zděděný rozsah je pak nesmrtelný)",
    ).toBe(true);
    expect(js).toMatch(/from ["']\.\/lib\/derive-subnets\.mjs["']/);
  });

  test("coolify-pull-envs.mjs is a DRY extension (reuses shared libs, does not re-implement Coolify I/O)", () => {
    const js = readFileSync(PULL, "utf-8");
    expect(js).toMatch(/from ["']\.\/lib\/coolify-env-store\.mjs["']/);
    expect(js).toMatch(/createProjectScope/); // fail-loud tenant boundary
    expect(js).toMatch(/productionRealValue/); // real_value-first coalescing (shared)
    // Must scope the pull to the managed-secret SoT (generate-secrets --print-keys).
    expect(js).toMatch(/--print-keys/);
    expect(
      /managedSecretKeys|managed\.has/.test(js),
      "reverse-sync MUST filter pulled keys to the managed-secret set",
    ).toBe(true);
    // Must not print secret VALUES (only fingerprints/keys) and must write mode 600.
    expect(js).toMatch(/0o600|mode:\s*0o600|chmod/);
  });

  // ⛔ PŘEPSÁNO 2026-09-18. Dřív se tu hledal TEXT `real_value ?? value` uvnitř
  // productionRealValue. Jenže `real_value` je tvar pro .env (literál v `'…'`,
  // jinak escapovaný — Coolify 4.3.16 realValue), takže přesně ten text vracel
  // trezoru apostrofy navíc. Vlastnost, kterou brána drží: reverse-sync vrátí
  // SKUTEČNOU hodnotu — real_value má přednost (maskované value ji nezahodí),
  // a je dekódovaný.
  test("productionRealValue vrací skutečnou hodnotu: real_value přednostně a dekódovaný", async () => {
    const { productionRealValue } = await import(STORE);
    const envs = [
      { key: "LIT", value: "", real_value: "'tajne'", is_literal: true, is_preview: false },
      { key: "LIT", value: "", real_value: "", is_literal: true, is_preview: true },
      { key: "ESC", value: "", real_value: 'a\\"b', is_literal: false, is_preview: false },
      { key: "JEN_VALUE", value: "v", real_value: "", is_preview: false },
    ];
    expect(productionRealValue(envs, "LIT"), "maskované value nesmí zahodit real_value; apostrofy pryč").toBe("tajne");
    expect(productionRealValue(envs, "ESC")).toBe('a"b');
    expect(productionRealValue(envs, "JEN_VALUE")).toBe("v");
    expect(productionRealValue(envs, "CHYBI")).toBeNull();
  });
});
