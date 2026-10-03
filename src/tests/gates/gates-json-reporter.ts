/**
 * Custom Vitest reporter for gate/architecture/i18n tests.
 *
 * Generates a structured JSON report after test suite completion.
 * Output: docs/db-structure/gates-test-report.json
 *
 * Used by vitest.gates.config.ts — `reporters: ["default", "./src/tests/gates/gates-json-reporter.ts"]`
 *
 * @module
 */

import fs from "fs";
import path from "path";
import type { Reporter, File, Task, TaskResultPack } from "vitest";
import { getReportDir, getReportPath } from "../helpers/reportPaths";

interface ReportIssue {
  category: string;
  severity: "error" | "warning" | "info";
  type: string;
  suite: string;
  test: string;
  file: string;
  message: string;
}

interface GatesReport {
  timestamp: string;
  /**
   * ⛔ VERZE NODE PATŘÍ DO REPORTU. Naměřeno 2026-08-31: zastaralý PATH
   * ukazoval na Node 10, sada skončila kódem 7 a NULOVÝM výstupem — z
   * artefaktu pak nešlo poznat, čím to bylo. Verdikt se čte odtud, takže
   * v něm musí být i to, ČÍM byl pořízen.
   */
  node: string;
  summary: {
    totalFiles: number;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    /**
     * ⛔ PŘESKOČENO NENÍ PROŠLO. Souhrn dosud hlásil jen počty; soubor, jehož
     * brány se celé přeskočily (chybí jq, docker, DB, online), se v něm nedal
     * odlišit od souboru, který skutečně něco ověřil. Tady je jmenný seznam,
     * aby tiše prázdné ověření šlo najít.
     */
    skippedFiles: { file: string; skipped: number }[];
    duration: number;
    suites: Record<
      string,
      { total: number; passed: number; failed: number; skipped: number }
    >;
  };
  issues: ReportIssue[];
}

const REPORT_DIR = getReportDir();
const REPORT_PATH = getReportPath("gates-test-report.json");

// ── TEP BĚHU ─────────────────────────────────────────────────────────────────
// ⛔ ZÁVĚREČNÝ REPORT VZNIKÁ AŽ V `onFinished`, tedy PO doběhnutí všech testů.
// Dokud běh trvá, není po něm v souborech ANI STOPA — a hlídač v run-vitest.mjs
// pak nemá jiný důkaz o životě než výpis na obrazovku. Jenže právě výpis umí
// zamrznout (naměřeno 2026-08-03: poslední řádek `↓ … (skipped)` a pak hodinu
// nic), takže se běh bez postupu nedal odlišit od běhu, který jen mlčí.
//
// `gates-test-progress.json` je tep: přepisuje se při každé změně úlohy, nejvýš
// jednou za 2 s. Hlídač kouká na jeho mtime — dokud se hýbe, běh žije, i kdyby
// neřekl ani slovo. Když se zastaví, je to zamrznutí, ne pomalost.
//
// Zápis je atomický (tmp + rename) a CELÝ v try/catch: tep nesmí SHODIT běh,
// jehož zdraví má hlídat. Chyba tepu se projeví tak, že hlídač nemá důkaz —
// tedy NEZMĚŘENO, ne falešný pád.
const PROGRESS_PATH = getReportPath("gates-test-progress.json");
const TEP_NEJVYS_JEDNOU_ZA_MS = 2_000;
let tepPoslednizapis = 0;
let tepZmenUloh = 0;
let tepSouboruCelkem = 0;

function zapisTep(stav: string, vynut = false): void {
  try {
    const ted = Date.now();
    if (!vynut && ted - tepPoslednizapis < TEP_NEJVYS_JEDNOU_ZA_MS) return;
    tepPoslednizapis = ted;
    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    const tmp = `${PROGRESS_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        stav,
        pid: process.pid,
        node: process.versions.node,
        lane: process.env.AISHA_GATES_LANE ?? null,
        updatedAt: new Date(ted).toISOString(),
        souboruCelkem: tepSouboruCelkem,
        zmenUloh: tepZmenUloh,
      }) + "\n",
    );
    fs.renameSync(tmp, PROGRESS_PATH);
  } catch {
    /* tep nesmí shodit běh, který hlídá */
  }
}

/**
 * Recursively flatten vitest Task tree into leaf test nodes.
 */
function flattenTasks(tasks: Task[]): Task[] {
  const result: Task[] = [];
  for (const task of tasks) {
    if (task.type === "suite" && "tasks" in task) {
      result.push(...flattenTasks(task.tasks));
    } else {
      result.push(task);
    }
  }
  return result;
}

/**
 * Walk ancestors to build the full suite path, e.g. "SQL indexes > index header"
 */
function getSuitePath(task: Task): string {
  const parts: string[] = [];
  let cur: Task | undefined = task.suite as Task | undefined;
  while (cur) {
    if (cur.name) parts.unshift(cur.name);
    cur = (cur as unknown as { suite?: Task }).suite;
  }
  return parts.join(" > ");
}

/**
 * Extract a concise failure message from task result errors.
 */
function extractFailureMessage(task: Task): string {
  const result = task.result;
  if (!result?.errors?.length) return "Unknown failure";

  // Take the first error message, truncate to avoid sensitive data leaks
  const firstError = result.errors[0];
  const msg =
    firstError.message ?? firstError.stack?.split("\n")[0] ?? "Unknown";

  // Truncate to prevent giant messages in report
  return msg.length > 500 ? msg.slice(0, 500) + "..." : msg;
}

export default class GatesJsonReporter implements Reporter {
  onInit(): void {
    zapisTep("start", true);
  }

  onPathsCollected(paths?: string[]): void {
    tepSouboruCelkem = paths?.length ?? 0;
    zapisTep("sbírá soubory", true);
  }

  onTaskUpdate(packs?: TaskResultPack[]): void {
    tepZmenUloh += packs?.length ?? 1;
    zapisTep("běží");
  }

  // ⛔ DVA ZDROJE TEPU SCHVÁLNĚ. `onTaskUpdate` je ve vitestu 3 označený jako
  // zastaralý a ve verzi 4 zmizí — tep by tichounce ustal a hlídač by po
  // upgradu ztratil důkaz o postupu, aniž by se cokoli viditelně rozbilo.
  // `onTestCaseResult` je jeho nástupce a už teď existuje; dvojí počítání
  // ničemu nevadí, protože tep měří POHYB, ne počty.
  onTestCaseResult(): void {
    tepZmenUloh += 1;
    zapisTep("běží");
  }

  onFinished(files?: File[]): void {
    zapisTep("dopsáno", true);
    if (!files?.length) return;

    const report: GatesReport = {
      timestamp: new Date().toISOString(),
      node: process.versions.node,
      summary: {
        totalFiles: files.length,
        totalTests: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        skippedFiles: [],
        duration: 0,
        suites: {},
      },
      issues: [],
    };

    for (const file of files) {
      const relPath = path.relative(process.cwd(), file.filepath);
      const allTests = flattenTasks(file.tasks);

      report.summary.duration += file.result?.duration ?? 0;

      // ⛔ CENSUS PŘESKOČENÝCH, PO SOUBORECH. Počet sám neřekne, KDE se
      // neměřilo. Soubor, jehož všechny brány se přeskočily, projde souhrnem
      // jako bezchybný — a přitom neověřil nic. Jmenný seznam to zviditelní.
      const preskoceno = allTests.filter(
        (t) => t.type === "test" && (t.result?.state === "skip" || t.mode === "skip" || t.mode === "todo"),
      ).length;
      if (preskoceno > 0) {
        report.summary.skippedFiles.push({ file: relPath, skipped: preskoceno });
      }

      for (const task of allTests) {
        if (task.type !== "test") continue;

        report.summary.totalTests++;

        const topSuite = getSuitePath(task).split(" > ")[0] || relPath;

        // Initialize suite stats
        if (!report.summary.suites[topSuite]) {
          report.summary.suites[topSuite] = {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
          };
        }
        report.summary.suites[topSuite].total++;

        const state = task.result?.state;

        if (state === "pass") {
          report.summary.passed++;
          report.summary.suites[topSuite].passed++;
        } else if (state === "fail") {
          report.summary.failed++;
          report.summary.suites[topSuite].failed++;

          report.issues.push({
            category: topSuite,
            severity: "error",
            type: "TEST_FAILURE",
            suite: getSuitePath(task),
            test: task.name,
            file: relPath,
            message: extractFailureMessage(task),
          });
        } else {
          report.summary.skipped++;
          report.summary.suites[topSuite].skipped++;
        }
      }
    }

    // Write report
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

    console.log(`\n📋 Gates test report: ${REPORT_PATH}`);
  }
}
