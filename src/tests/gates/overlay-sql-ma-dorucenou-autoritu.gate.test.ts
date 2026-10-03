/**
 * Hromadný SQL import instance se aplikuje s DORUČENOU autoritou (CLASS gate)
 *
 * TŘÍDA VADY: skript aplikuje cizí SQL přes `psql` jako holý vlastník spojení
 * (`postgres`). Jenže autorizační pomocníci platformy nečtou databázovou roli —
 * čtou JWT claim nebo `role` GUC:
 *
 *   is_service_role() := get_jwt_role() = 'service_role'
 *                     OR current_setting('role', true) = 'service_role'
 *
 * Neinteraktivní psql nemá ANI JEDNO, takže `is_service_role()` vrátí false
 * i superuserovi. Každý trigger, který si žádá service_role, pak import shodí.
 *
 * NAMĚŘENO 2026-08-10 (aisha-core down): overlay `00_kb.sql` vkládal do
 * `expert_rules` → trigger `fn_notify_rule_change()` → `ensure_stack_default_story()`
 * (NENÍ SECURITY DEFINER) → `ERROR: Unauthorized: admin/staff or service_role
 * required` → hook exit=3 → kontejner `migrate` Exited(3) → gateway/web/
 * core-mesh-ingress zůstaly `Created` a core se nikdy nerozběhl.
 *
 * Živé ověření obou směrů na produkční DB:
 *   bez role                       → is_service_role() = f
 *   PGOPTIONS=-c role=service_role → is_service_role() = t
 *
 * PROČ TO NECHYTIL SEED: `db:seed` běží DŘÍV, než ty triggery vzniknou
 * (`feedback_coldstart_inline_trigger_rls_ordering`). „Seed applied successfully"
 * o autoritě pozdějších kroků nevypovídá NIC — přesně tvar „zelená, která měří
 * jinou otázku".
 *
 * INVARIANT: každé `psql … -f <soubor>`, které aplikuje SQL z instance-data
 * overlaye, běží s doručenou service_role autoritou (PGOPTIONS `role=service_role`,
 * PGnastavení, nebo explicitní `SET ROLE`).
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HOOK = join(ROOT, "scripts/deploy/instance-data-hook.sh");

/** Řádek spouští psql se souborem (`-f`), tedy aplikuje dávku SQL. */
function isPsqlFileApply(line: string): boolean {
  return /\bpsql\b/.test(line) && /\s-f\s/.test(line);
}

/** Nese ten samý řádek doručenou service_role autoritu? */
function carriesServiceRole(line: string): boolean {
  return (
    /PGOPTIONS=(["']?)[^"']*\brole=service_role\b/.test(line) ||
    /PGSETENV|--set=role=service_role/.test(line) ||
    /\bSET\s+(LOCAL\s+)?ROLE\s+service_role\b/i.test(line)
  );
}

export function findUnauthorizedApplies(content: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  content.split("\n").forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return; // komentář není vykonaný kód
    if (!isPsqlFileApply(raw)) return;
    if (carriesServiceRole(raw)) return;
    out.push({ line: i + 1, text: raw.trim() });
  });
  return out;
}

describe("overlay SQL se aplikuje s doručenou autoritou", () => {
  test("instance-data-hook.sh existuje (brána má co měřit)", () => {
    expect(existsSync(HOOK), `${HOOK} chybí — brána by tiše měřila prázdno`).toBe(true);
  });

  test("každé psql -f v hooku nese service_role", () => {
    const src = readFileSync(HOOK, "utf-8");
    const applies = src.split("\n").filter((l) => !/^\s*#/.test(l) && isPsqlFileApply(l));
    // Pojistka proti tiché prázdnotě: kdyby se apply přejmenoval, brána nesmí
    // zezelenat tím, že nic nenajde.
    expect(applies.length, "v hooku nebyl nalezen ŽÁDNÝ `psql -f` — změnil se tvar?").toBeGreaterThan(0);

    const bad = findUnauthorizedApplies(src);
    if (bad.length) {
      throw new Error(
        `Nalezeno ${bad.length} aplikací overlay SQL bez doručené autority.\n` +
          `psql se připojuje jako 'postgres', ale is_service_role() čte JWT claim / 'role' GUC —\n` +
          `bez nich vrátí false i superuserovi a trigger žádající service_role import shodí.\n` +
          `Použij PGOPTIONS="-c role=service_role".\n\n` +
          bad.map((b) => `  instance-data-hook.sh:${b.line}  ${b.text}`).join("\n"),
      );
    }
    expect(bad).toEqual([]);
  });

  // ── Negativní testy — brána, která nemůže padnout, není brána ──────────────
  test("holé psql -f je nález", () => {
    const s = `  psql "$AISHA_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"`;
    expect(findUnauthorizedApplies(s).length).toBe(1);
  });

  test("psql -f s PGOPTIONS role=service_role není nález", () => {
    const s = `  PGOPTIONS="-c role=service_role" psql "$AISHA_DB_URL" -q -f "$f"`;
    expect(findUnauthorizedApplies(s)).toEqual([]);
  });

  test("psql BEZ -f (dotaz, ne dávka) není nález", () => {
    const s = `  psql "$AISHA_DB_URL" -tAc "select 1"`;
    expect(findUnauthorizedApplies(s)).toEqual([]);
  });

  test("zakomentované psql -f není nález", () => {
    const s = `  # psql "$URL" -f "$f"   (dřívější tvar)`;
    expect(findUnauthorizedApplies(s)).toEqual([]);
  });

  test("SET ROLE service_role na témže řádku je v pořádku", () => {
    const s = `  psql "$URL" -c "SET ROLE service_role;" -f "$f"`;
    expect(findUnauthorizedApplies(s)).toEqual([]);
  });
});
