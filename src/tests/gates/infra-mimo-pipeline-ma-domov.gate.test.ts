import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Co běží mimo pipeline, musí mít v repu aspoň DOMOV.
 *
 * ⛔ PROČ EXISTUJE
 * Sentry i CI runner se instalovaly ručně a žijí mimo Coolify deploy, takže
 * jejich konfigurace nikde nebyla. Projevilo se to dvakrát:
 *   · 2026-09-01 došlo místo na Sentry → Kafka spadla → 500 na vše autentizované
 *   · janitor runneru maže npm cache pod běžícími joby → NAHODILÉ pády testů
 * Druhá vada byla přitom POPSANÁ v `ci.yml` od 2026-08-19 — jen nešla opravit,
 * protože bydlela mimo repo. Znalost byla, konfigurace ne.
 *
 * ⚠️ Brána NEOVĚŘUJE, že nasazený stav odpovídá souboru — na to by musela na ty
 * stroje. Ověřuje, že soubor existuje a nese vlastnost, kvůli které vznikl.
 *
 * ⛔ DOMOV RUNNERU JE ODKAZ, NE KOPIE (2026-09-29). Definice runneru má vlastní
 * domov v katalogu Coolify aplikací (`apps/aisha-ci-runner/`), odkud se
 * nasazuje a kde janitor hlídá test, který ho SPOUŠTÍ. Kopie, která tu ležela,
 * se od živé služby rozešla a po parsování YAML by runner ani nespustila
 * (víceřádkový řetězec v uvozovkách se složí, komentář spolkne příkazy).
 * Tady se proto hlídá odkaz — a že se druhá kopie nevrátí.
 */
const ROOT = join(__dirname, "../../..");
const cti = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("infrastruktura mimo pipeline má v repu domov", () => {
  it("hostitel Sentry má idempotentní skript i runbook", () => {
    for (const f of ["infra/sentry/apply-host-config.sh", "infra/sentry/README.md"]) {
      expect(existsSync(join(ROOT, f)), `chybí ${f}`).toBe(true);
    }
    const sh = cti("infra/sentry/apply-host-config.sh");
    // Idempotence: každý krok se musí ptát, jestli už platí.
    expect(sh, "strop žurnálu se musí nastavovat podmíněně").toMatch(/grep -qE '\^SystemMaxUse=/);
    expect(sh, "swap se nesmí vytvářet, když už běží").toMatch(/swapon --show/);
    // Po změně retence je nutné převytvořit služby A restartovat nginx.
    expect(sh, "nginx si drží starou IP webu — bez restartu 502").toMatch(/restart nginx/);
  });

  it("runbook Sentry nese rozlišovací sondu na disk", () => {
    const md = cti("infra/sentry/README.md");
    expect(md, "chybí sonda 401 vs 500").toMatch(/vymyšlený token/i);
    expect(md, "chybí varování, že docker ps není měřidlo").toMatch(/docker ps/);
  });

  it("CI runner má v repu odkaz na domov definice, ne druhou kopii", () => {
    const md = cti("infra/ci-runner/README.md");
    expect(md, "README musí jmenovat compose v katalogu, odkud se runner nasazuje").toMatch(
      /apps\/aisha-ci-runner\/docker-compose\.yml/,
    );
    expect(md, "README musí jmenovat repozitář katalogu").toMatch(/`[A-Za-z0-9_.-]+\/coolify`/);
    expect(md, "chybí test janitoru, který vlastnost hlídá místo téhle brány").toMatch(
      /tests\/janitor-pod-tlakem\.sh/,
    );
    expect(md, "chybí varování, že joby na hostiteli `docker ps` neukáže").toMatch(/docker ps/);
    // Druhá kopie se rozejde vždycky, a ta, ze které se nenasazuje, zestárne
    // potichu — naměřeno 2026-09-29, viz hlavičku.
    const kopie = readdirSync(join(ROOT, "infra/ci-runner")).filter((f) => /\.ya?ml$/i.test(f));
    expect(
      kopie,
      "v infra/ci-runner/ je zase compose — definice runneru bydlí v katalogu; " +
        "sem patří jen odkaz (README), jinak se dvě kopie rozejdou",
    ).toEqual([]);
  });
});
