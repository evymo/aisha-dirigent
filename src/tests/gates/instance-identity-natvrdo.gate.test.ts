/**
 * brána: identita instance nesmí být vepsaná natvrdo
 *
 * ⛔ NAMĚŘENO 2026-08-25. `coolify/netbird-management.json.template` měla realm
 * natvrdo `aisha` na OSMI místech a `${KEYCLOAK_REALM}` nepoužívala vůbec.
 * Management pak čekal vydavatele `.../realms/aisha`, kdežto token nesl
 * `.../realms/<instance>-realm` — NESHODA VYDAVATELE, tedy `no valid
 * authentication provided` na KAŽDÝ token. Řetěz: žádný účet → žádný setup key
 * → žádní peers → mesh nevznikla → api 502, extranet 404.
 *
 * Hláška mluvila o tokenu, příčinou byla identita instance ve sdílené šabloně.
 * Ruční grep to najde jednou; tahle brána pokaždé.
 *
 * Druhý test je SEBETEST měřidla. Detektor, který nikdy nic nenajde, je
 * k nerozeznání od detektoru, který je slepý — proto se tu na dočasném souboru
 * ověřuje, že vadu skutečně vidí a že cizího poskytovatele identity nechá být.
 *
 * Třetí test drží HRANICI měřidla. ⛔ NAMĚŘENO 2026-09-05: audit procházel i
 * vnořené repozitáře (submoduly), takže verdikt závisel na tom, jestli je cizí
 * repo náhodou vytažené. V hlavní kopii `packages/local-ingest` vytažený NENÍ
 * a brána byla zelená; v čerstvém `git worktree` se vytáhne a TÁŽ brána na
 * TOMTÉŽ commitu spadla na `container_name: aisha-local-ingest-local` — na
 * řádku, který patří jinému repu (a ten ho už opravoval na větvi
 * `fix/no-instance-literals`). Hranice je v tomhle repu zavedená jinde:
 * `verify-no-dev-codes` přeskakuje gitlinky s poznámkou „obsah žije v JINÉM
 * repu". Přeskok musí být VIDĚT ve výstupu, jinak by z něj byla slepá skvrna.
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(__dirname, "../../..");
const AUDIT = join(ROOT, "scripts/audit-instance-identity.mjs");

function spustit(cwd: string): { kod: number; vystup: string } {
  try {
    const vystup = execFileSync("node", [AUDIT, cwd], { encoding: "utf8", stdio: "pipe" });
    return { kod: 0, vystup };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { kod: err.status ?? 1, vystup: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("brána: identita instance nesmí být vepsaná natvrdo", () => {
  test("repozitář je čistý — realm ani běhové jméno nejsou konstanta", () => {
    const { kod, vystup } = spustit(ROOT);
    expect(kod, `audit-instance-identity nahlásil nálezy:\n${vystup}`).toBe(0);
  });

  test("sebetest měřidla: vadu vidí, cizího poskytovatele identity nechá být", () => {
    const dir = mkdtempSync(join(tmpdir(), "identita-"));
    try {
      // 1) přesně ta vada, co shodila fázi D
      writeFileSync(
        join(dir, "vadna.template"),
        '{"AuthIssuer": "https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/aisha",\n' +
          ' "AdminEndpoint": "${KEYCLOAK_URL_FROM_CLUSTER}/admin/realms/aisha"}\n',
      );
      // 2) běhové jméno bez identity instance
      writeFileSync(join(dir, "vadny.yml"), "services:\n  x:\n    container_name: aisha-neco\n");
      // 3) realm CIZÍHO poskytovatele — konstanta z jeho smlouvy, nemáme co dosadit
      writeFileSync(
        join(dir, "cizi.ts"),
        'const t = "https://login.eurowag.com/auth/realms/eurowag/protocol/openid-connect/token";\n',
      );

      const { kod, vystup } = spustit(dir);
      expect(kod, "měřidlo musí vadu ohlásit nenulovým kódem").toBe(1);
      expect(vystup, "musí vidět realm ve sdílené šabloně").toContain("vadna.template");
      expect(vystup, "musí vidět i tvar /admin/realms/ — tam mělo slepé místo").toContain(
        "/admin/realms/aisha",
      );
      expect(vystup, "musí vidět běhové jméno bez identity").toContain("vadny.yml");
      expect(vystup, "cizí IdP NESMÍ hlásit — nemáme čím ho dosadit").not.toContain("eurowag");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("vnořený repozitář se neskenuje — a přeskok je VIDĚT", () => {
    const dir = mkdtempSync(join(tmpdir(), "identita-submodul-"));
    try {
      // Táž vada dvakrát: jednou v našem stromu, jednou uvnitř vnořeného repa.
      mkdirSync(join(dir, "cizi-repo"), { recursive: true });
      writeFileSync(
        join(dir, "cizi-repo/docker-compose.local.yml"),
        "services:\n  x:\n    container_name: aisha-cizi-local\n",
      );

      // Bez značky vnořeného repa MUSÍ měřidlo vadu vidět — jinak by tenhle
      // test procházel i se slepým auditem a nic by nedokazoval.
      const bezZnacky = spustit(dir);
      expect(bezZnacky.kod, "bez `.git` je to náš strom — vada se hlásí").toBe(1);
      expect(bezZnacky.vystup).toContain("cizi-repo/docker-compose.local.yml");

      // `.git` uvnitř = obsah patří jinému repu → přeskočit, ale nahlas.
      writeFileSync(join(dir, "cizi-repo/.git"), "gitdir: /jinam\n");
      const seZnackou = spustit(dir);
      expect(seZnackou.kod, "vnořený repozitář se neskenuje").toBe(0);
      expect(seZnackou.vystup, "přeskok nesmí být tichý").toContain("cizi-repo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
