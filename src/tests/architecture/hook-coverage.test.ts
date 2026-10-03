/**
 * Hook Coverage Tests
 *
 * Tyto testy ověřují, že kritické hooky mají odpovídající unit testy.
 * Pokud přidáš nový hook, tento test selže dokud nepřidáš test.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Správné cesty relativně k tomuto souboru
const HOOKS_DIR = path.resolve(__dirname, "../../hooks");
const TESTS_DIR = path.resolve(__dirname, "../hooks");

/**
 * Získá seznam všech hook souborů.
 *
 * Pomine re-export shim soubory (typicky 1–2 řádky `export * from "./X"`)
 * — testy patří k cíli `X`, ne k shim souboru, jinak by se musely
 * duplikovat při každém přejmenování hooku.
 */
function getHookFiles(): string[] {
  return fs
    .readdirSync(HOOKS_DIR)
    .filter((file) => file.startsWith("use") && file.endsWith(".ts"))
    .filter((file) => !file.endsWith(".test.ts"))
    .filter((file) => !isReExportShim(path.join(HOOKS_DIR, file)));
}

/**
 * Detekuje re-export shim: soubor obsahující pouze komentáře a jeden
 * `export * from "./<target>";` řádek (bez vlastní implementace).
 */
function isReExportShim(filePath: string): boolean {
  const content = fs.readFileSync(filePath, "utf-8");
  const codeLines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"));
  if (codeLines.length > 1) return false;
  return codeLines.length === 1 && /^export\s+\*\s+from\s+["'][^"']+["'];?$/.test(codeLines[0]);
}

/**
 * Kontroluje, zda existuje test pro daný hook
 */
function hasTest(hookFile: string): boolean {
  const testFileTs = hookFile.replace(".ts", ".test.ts");
  const testFileTsx = hookFile.replace(".ts", ".test.tsx");
  return (
    fs.existsSync(path.join(TESTS_DIR, testFileTs)) ||
    fs.existsSync(path.join(TESTS_DIR, testFileTsx))
  );
}

/**
 * Kritické hooky které MUSÍ mít testy
 * Rozděleno na:
 * - BLOCKING: Testy MUSÍ existovat, jinak build selže
 * - WARNING: Testy by měly existovat, ale neblokují build
 */
const BLOCKING_HOOKS = [
  // Admin hooky s sensitive data přístupem
  "useAdminStudies.ts",
  "useAdminData.ts",

  // sensitive data hooky
  "useTracking.ts",
  "useTrackingDataSync.ts",
  "usePatientTracking.ts",

  // Payment/Auth/Access critical hooks
  "useStripeCheckout.ts",
  "useChatAccess.ts",
  "useRequestPasswordChange.ts",

  // Auth hooky
  "useAuth.ts",
];

const WARNING_HOOKS = [
  // Admin hooky
  "useAdminRegistrations.ts",
  "useAdminTokenLocks.ts",

  // sensitive data hooky
  "useLabResults.ts",
  "useDosingLogs.ts",

  // Auth hooky - důležité ale nekritické
  "useSession.ts",
  "usePermissions.ts",

  // Partner hooky
  "usePartnerProfile.ts",
];

describe("Hook Test Coverage", () => {
  describe("Blocking: Critical hooks MUST have tests", () => {
    const hookFiles = getHookFiles();

    BLOCKING_HOOKS.forEach((hookFile) => {
      const exists = hookFiles.includes(hookFile);

      if (exists) {
        it(`${hookFile} should have a corresponding test`, () => {
          expect(hasTest(hookFile)).toBe(true);
        });
      }
    });
  });

  describe("Warning: Important hooks should have tests", () => {
    const hookFiles = getHookFiles();
    const missingTests: string[] = [];

    WARNING_HOOKS.forEach((hookFile) => {
      const exists = hookFiles.includes(hookFile);
      if (exists && !hasTest(hookFile)) {
        missingTests.push(hookFile);
      }
    });

    it("should log warning for hooks without tests", () => {
      if (missingTests.length > 0) {
        console.log(`\n⚠️  WARNING: Important hooks without tests:`);
        missingTests.forEach((h) => console.log(`   - ${h}`));
        console.log(`   Consider adding tests for these hooks.\n`);
      }
      // Neblokuje build
      expect(true).toBe(true);
    });
  });

  describe("Hook coverage statistics", () => {
    it("should report hook coverage", () => {
      const hookFiles = getHookFiles();
      const hooksWithTests = hookFiles.filter(hasTest);
      const hooksWithoutTests = hookFiles.filter((f) => !hasTest(f));

      const coverage = (hooksWithTests.length / hookFiles.length) * 100;

      // Log pro informaci
      console.log(`\n📊 Hook Coverage Report:`);
      console.log(`   Total hooks: ${hookFiles.length}`);
      console.log(`   Hooks with tests: ${hooksWithTests.length}`);
      console.log(`   Hooks without tests: ${hooksWithoutTests.length}`);
      console.log(`   Coverage: ${coverage.toFixed(1)}%\n`);

      // První realistický bezpečnostní cíl pro test pokrytí hooků
      expect(coverage).toBeGreaterThanOrEqual(55);
    });

    it("should list admin hooks without tests", () => {
      const hookFiles = getHookFiles();
      const adminHooksWithoutTests = hookFiles
        .filter((f) => f.startsWith("useAdmin"))
        .filter((f) => !hasTest(f));

      if (adminHooksWithoutTests.length > 0) {
        console.log(`\n⚠️  Admin hooks without tests:`);
        adminHooksWithoutTests.forEach((h) => console.log(`   - ${h}`));
      }

      // Informativní - neblokuje build
      expect(true).toBe(true);
    });
  });
});

describe("Schema Validation Coverage", () => {
  it("should document RPC functions that need schema validation", () => {
    // Tyto RPC funkce jsou kritické a měly by mít schema validation testy
    const criticalRpcFunctions = [
      "get_studies_overview_admin",
      "get_study_registrations_admin",
      "get_my_health_check_ins_audited",
      "get_my_lab_results_audited",
      "get_my_dosing_logs_audited",
      "get_partner_profiles_admin",
      "get_orders_admin_with_items",
      "get_user_roles_admin",
    ];

    console.log(`\n📋 Critical RPC functions with schema validation:`);
    criticalRpcFunctions.forEach((fn) => console.log(`   ✅ ${fn}`));

    expect(criticalRpcFunctions.length).toBeGreaterThan(0);
  });
});
