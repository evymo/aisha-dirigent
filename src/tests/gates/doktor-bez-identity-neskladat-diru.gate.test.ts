/**
 * Env-doktor bez identity instance nezapíše cestu ani adresu S DÍROU.
 *
 * ⛔ NAMĚŘENO 2026-09-27 dry-runem nad trezorem <fork> (main ca68d4aa1), který
 * identitu (APP_NAME_PREFIX / AISHA_STORY) neukládá: doktor chtěl zapsat
 * `WEB_RENDER_STATIC_HOST_DIR = /var/lib//web-render/static` (totéž shell).
 * Šablona `/var/lib/${IDENTITY}/…` s prázdnou identitou dá NEPRÁZDNÝ řetězec,
 * takže kontrola `required-static` („musí být neprázdné") prošla — komentář
 * v kontraktu tvrdil fail-closed, kód ne. Tatáž díra: `/srv//base-repo`,
 * `http://-minio:9000`, `…@-db:5432`.
 *
 * Co se drží (měří se ZAPSANÝ soubor, ne výpis ani text kódu):
 *   1. s identitou se hodnoty z ní složí (kontrolní vzorek — jinak by brána
 *      „prošla" i doktoru, který nic nezapisuje);
 *   2. bez identity nemá ŽÁDNÁ hodnota v souboru díru po identitě (obecně, ne
 *      podle seznamu klíčů — zachytí i budoucí šablonu; první běh tak našel i
 *      `template` `http://${APP_NAME_PREFIX}-svc-ai-chat:3011` → `http://-svc-…`)
 *      a doktor identitně odvozené povinné klíče vypíše jako PRÁZDNÉ;
 *   3. šablona s prázdným vstupem v souboru LEŽÍ prázdná (ne chybí) a doktor
 *      chybějící vstup ohlásí sám — první verze opravy klíč vynechávala a brána
 *      `deklarace-v-compose-ma-zapisovatele` ho pak četla jako „bez zapisovatele".
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, test } from "vitest";
import { envDoktorDokoncil } from "./_env-doktor-dokoncil";

const ROOT = process.cwd();
const DOKTOR = join(ROOT, "scripts/aisha-env-doctor.mjs");

const IDENTITA = "zkouska";

/**
 * Díra = hodnota SLOŽENÁ z prázdné identity. Definice odvozením, ne vzorem textu:
 * s identitou hodnota identitu obsahuje, a bez ní je NEPRÁZDNÁ a rovná se téže
 * hodnotě s identitou vypuštěnou (`/var/lib/zkouska/…` → `/var/lib//…`,
 * `http://zkouska-svc-…` → `http://-svc-…`, `zkouska-db` → `-db`). Náhodná
 * tajemství se mezi běhy liší bez vztahu k identitě, takže je to nechytí (vzor
 * `^[-_]` je chytal: base64url tajemství občas začíná podtržítkem).
 */
function diry(sIdentitou: Map<string, string>, bezIdentity: Map<string, string>): string[] {
  return [...bezIdentity]
    .filter(([k, v]) => {
      const s = sIdentitou.get(k) ?? "";
      return v !== "" && s.includes(IDENTITA) && v === s.split(IDENTITA).join("");
    })
    .map(([k, v]) => `${k}=${v}`);
}

/** Doktor v APPLY nad dočasným souborem; `identita` = null → bez APP_NAME_PREFIX i AISHA_STORY. */
function behDoktora(identita: string | null): { vystup: string; hodnoty: Map<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "aisha-doktor-identita-"));
  const envFile = join(dir, "env.coolify");
  try {
    const { APP_NAME_PREFIX: _a, AISHA_STORY: _b, ...prostredi } = process.env;
    const beh = spawnSync("node", [DOKTOR, "--no-external"], {
      cwd: ROOT,
      env: {
        ...prostredi,
        ENV_FILE: envFile,
        AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi",
        ...(identita ? { APP_NAME_PREFIX: identita, AISHA_STORY: identita } : {}),
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    if (beh.error) throw beh.error;
    if (!envDoktorDokoncil(beh.status) || !existsSync(envFile)) {
      throw new Error(`env-doktor skončil ${beh.status}: ${(beh.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}`);
    }
    const hodnoty = new Map<string, string>();
    for (const radek of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(radek);
      if (m) hodnoty.set(m[1], m[2].replace(/^["']|["']$/g, ""));
    }
    return { vystup: stripVTControlCharacters(`${beh.stdout}\n${beh.stderr}`), hodnoty };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Soubory, ze kterých si doktor identitu umí vzít i bez prostředí. V CI nejsou;
// na vývojovém stroji by scénář „bez identity" identitu našel — pak ho brána
// VIDITELNĚ přeskočí (skip s důvodem), nemlčí.
const IDENTITA_Z_DISKU = [".env-prod-backup", ".env.local"].filter((f) => existsSync(join(ROOT, f)));

describe("env-doktor: prázdná identita = prázdná hodnota, ne cesta s dírou", () => {
  test("kontrolní vzorek: s identitou se cesty a adresy složí z ní", () => {
    const { hodnoty } = behDoktora(IDENTITA);
    expect({
      runs: hodnoty.get("AGENT_RUNS_DIR"),
      s3: hodnoty.get("S3_ENDPOINT"),
    }).toEqual({ runs: "/var/lib/zkouska/agent-runs", s3: "http://zkouska-minio:9000" });
  });

  test.skipIf(IDENTITA_Z_DISKU.length > 0)(
    `bez identity: žádná hodnota s dírou a povinné klíče nahlas prázdné${IDENTITA_Z_DISKU.length ? ` (PŘESKOČENO: identita leží v ${IDENTITA_Z_DISKU.join(", ")})` : ""}`,
    () => {
      const sIdentitou = behDoktora(IDENTITA).hodnoty;
      const { vystup, hodnoty } = behDoktora(null);
      // Měřidlo musí umět říct „ano": s identitou existují hodnoty, které ji nesou.
      expect([...sIdentitou.values()].filter((v) => v.includes(IDENTITA)).length).toBeGreaterThan(5);
      expect(diry(sIdentitou, hodnoty), "hodnota složená z prázdné identity").toEqual([]);
      // (WEB_RENDER_*_HOST_DIR tu byly do 2026-10-02; s předáním po síti zmizely.
      // AGENT_REPO_PATH — sdílený base-repo — zmizel s klonem per běh, fix/exec-klon-per-beh.)
      for (const k of ["AGENT_RUNS_DIR"]) {
        expect(hodnoty.get(k) ?? "", k).toBe("");
        expect(vystup, `${k} musí být vypsán jako prázdný povinný`).toMatch(new RegExp(`✗ ${k} \\(empty\\)`));
      }
      // Šablona s prázdným vstupem se zapíše PRÁZDNĚ, ne vynechá: prázdný `KEY=`
      // shodí `:?` v compose nahlas a brána zapisovatelů ho bez identity čte jako
      // „nezměřeno"; vynechaný klíč by četla jako „nikdo ho nezapisuje".
      for (const k of ["AI_CHAT_SERVICE_URL", "CLAMD_HOST", "LOCAL_INGEST_OUT_VOLUME"]) {
        expect(hodnoty.has(k), `${k} musí v souboru ležet (prázdný), ne chybět`).toBe(true);
        expect(hodnoty.get(k), k).toBe("");
        expect(vystup, `${k}: doktor sám ohlásí chybějící vstup`).toMatch(
          new RegExp(`aisha-env-doctor: ${k} se neodvodil \\(prázdný vstup šablony\\): APP_NAME_PREFIX`),
        );
      }
    },
  );
});
