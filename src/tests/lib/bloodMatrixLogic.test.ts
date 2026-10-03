/**
 * Blood Matrix Logic Tests
 *
 * Tests for domain-pure scoring, assessment computation, and AI prompt generation.
 * No UI, no mocks — this verifies the core algorithm.
 *
 * @see src/lib/blood-matrix/bloodMatrixLogic.ts
 */

import { describe, it, expect } from "vitest";
import {
  BLOOD_MATRIX_CELL_KEYS,
  BLOOD_MATRIX_GRADES,
  BLOOD_MATRIX_AI_PRESET,
  createEmptyBloodMatrixMap,
  buildBloodMatrixAssessment,
  createBloodMatrixAiPrompt,
  type BloodMatrixMap,
  type BloodMatrixGrade,
  type BloodMatrixCellKey,
} from "@/lib/blood-matrix";

/* ── createEmptyBloodMatrixMap ────────────────────────────────── */

describe("createEmptyBloodMatrixMap", () => {
  it("returns a map with all 9 cells", () => {
    const map = createEmptyBloodMatrixMap();
    expect(Object.keys(map)).toHaveLength(9);
    for (const key of BLOOD_MATRIX_CELL_KEYS) {
      expect(map[key]).toBeDefined();
    }
  });

  it("all cells default to grade 0 with empty note", () => {
    const map = createEmptyBloodMatrixMap();
    for (const key of BLOOD_MATRIX_CELL_KEYS) {
      expect(map[key].grade).toBe("0");
      expect(map[key].note).toBe("");
    }
  });

  it("returns a new object each time (no shared reference)", () => {
    const a = createEmptyBloodMatrixMap();
    const b = createEmptyBloodMatrixMap();
    expect(a).not.toBe(b);
    a["1"].grade = "III";
    expect(b["1"].grade).toBe("0");
  });
});

/* ── buildBloodMatrixAssessment ───────────────────────────────── */

describe("buildBloodMatrixAssessment", () => {
  it("empty matrix yields zero counts and low severity", () => {
    const map = createEmptyBloodMatrixMap();
    const result = buildBloodMatrixAssessment(map);

    expect(result.counts).toEqual({ I: 0, II: 0, III: 0 });
    expect(result.weighted_score).toBe(0);
    expect(result.flagged_cell_keys).toHaveLength(0);
    expect(result.severity.level).toBe("low");
    expect(result.severe_parasite_signal).toBe(false);
  });

  it("counts grades correctly", () => {
    const map = createEmptyBloodMatrixMap();
    map["1"].grade = "I";
    map["2"].grade = "I";
    map["3"].grade = "II";
    map["4"].grade = "III";

    const result = buildBloodMatrixAssessment(map);
    expect(result.counts).toEqual({ I: 2, II: 1, III: 1 });
  });

  it("computes weighted score (I=1, II=2, III=3)", () => {
    const map = createEmptyBloodMatrixMap();
    map["1"].grade = "I"; // 1
    map["2"].grade = "II"; // 2
    map["3"].grade = "III"; // 3
    // Total = 6

    const result = buildBloodMatrixAssessment(map);
    expect(result.weighted_score).toBe(6);
  });

  it("flags only cells with grade > 0", () => {
    const map = createEmptyBloodMatrixMap();
    map["3"].grade = "I";
    map["7"].grade = "III";

    const result = buildBloodMatrixAssessment(map);
    expect(result.flagged_cell_keys).toEqual(["3", "7"]);
  });

  describe("severity levels", () => {
    function makeMapWithGradeIIICount(count: number): BloodMatrixMap {
      const map = createEmptyBloodMatrixMap();
      const keys = BLOOD_MATRIX_CELL_KEYS.slice(0, count);
      for (const key of keys) {
        map[key].grade = "III";
      }
      return map;
    }

    it("low severity: 0-1 grade III cells", () => {
      expect(buildBloodMatrixAssessment(makeMapWithGradeIIICount(0)).severity.level).toBe("low");
      expect(buildBloodMatrixAssessment(makeMapWithGradeIIICount(1)).severity.level).toBe("low");
    });

    it("moderate severity: 2-3 grade III cells", () => {
      expect(buildBloodMatrixAssessment(makeMapWithGradeIIICount(2)).severity.level).toBe("moderate");
      expect(buildBloodMatrixAssessment(makeMapWithGradeIIICount(3)).severity.level).toBe("moderate");
    });

    it("elevated severity: 4-5 grade III cells", () => {
      expect(buildBloodMatrixAssessment(makeMapWithGradeIIICount(4)).severity.level).toBe("elevated");
      expect(buildBloodMatrixAssessment(makeMapWithGradeIIICount(5)).severity.level).toBe("elevated");
    });

    it("high severity: 6+ grade III cells", () => {
      expect(buildBloodMatrixAssessment(makeMapWithGradeIIICount(6)).severity.level).toBe("high");
      expect(buildBloodMatrixAssessment(makeMapWithGradeIIICount(9)).severity.level).toBe("high");
    });

    it("severity includes recommended days range", () => {
      const result = buildBloodMatrixAssessment(makeMapWithGradeIIICount(4));
      expect(result.severity.recommended_days_min).toBeGreaterThan(0);
      expect(result.severity.recommended_days_max).toBeGreaterThan(result.severity.recommended_days_min);
    });

    it("protocol step count scales with severity", () => {
      const low = buildBloodMatrixAssessment(makeMapWithGradeIIICount(0));
      const moderate = buildBloodMatrixAssessment(makeMapWithGradeIIICount(2));
      const elevated = buildBloodMatrixAssessment(makeMapWithGradeIIICount(4));
      const high = buildBloodMatrixAssessment(makeMapWithGradeIIICount(6));

      expect(low.severity.protocol_steps).toBe(1);
      expect(moderate.severity.protocol_steps).toBe(2);
      expect(elevated.severity.protocol_steps).toBe(3);
      expect(high.severity.protocol_steps).toBe(5);
    });
  });

  describe("product recommendations", () => {
    it("no products for empty matrix", () => {
      const result = buildBloodMatrixAssessment(createEmptyBloodMatrixMap());
      expect(result.product_recommendations).toHaveLength(0);
    });

    it("returns products for flagged cells", () => {
      const map = createEmptyBloodMatrixMap();
      map["1"].grade = "II"; // hydration_electrolytes, omega3, phosphatidylcholine

      const result = buildBloodMatrixAssessment(map);
      expect(result.product_recommendations.length).toBeGreaterThanOrEqual(1);

      const codes = result.product_recommendations.map((s) => s.code);
      expect(codes).toContain("hydration_electrolytes");
    });

    it("products are sorted by priority (core first)", () => {
      const map = createEmptyBloodMatrixMap();
      map["1"].grade = "II";

      const result = buildBloodMatrixAssessment(map);
      const priorities = result.product_recommendations.map((s) => s.priority);

      // Core items should come before support/optional
      const coreIdx = priorities.indexOf("core");
      const supportIdx = priorities.indexOf("support");
      if (coreIdx >= 0 && supportIdx >= 0) {
        expect(coreIdx).toBeLessThan(supportIdx);
      }
    });

    it("each product includes reason_cell_keys", () => {
      const map = createEmptyBloodMatrixMap();
      map["1"].grade = "I";
      map["7"].grade = "II";

      const result = buildBloodMatrixAssessment(map);
      for (const supp of result.product_recommendations) {
        expect(supp.reason_cell_keys.length).toBeGreaterThan(0);
        for (const key of supp.reason_cell_keys) {
          expect(BLOOD_MATRIX_CELL_KEYS).toContain(key);
        }
      }
    });

    it("hydration_electrolytes appears from cell 1 or 7 with merged cell keys", () => {
      const map = createEmptyBloodMatrixMap();
      map["1"].grade = "I";
      map["7"].grade = "II";

      const result = buildBloodMatrixAssessment(map);
      const hydration = result.product_recommendations.find(
        (s) => s.code === "hydration_electrolytes",
      );
      expect(hydration).toBeDefined();
      expect(hydration?.reason_cell_keys).toContain("1");
      expect(hydration?.reason_cell_keys).toContain("7");
    });
  });

  describe("severe_parasite_signal", () => {
    it("false when cells 6 and 9 are not grade III", () => {
      const map = createEmptyBloodMatrixMap();
      map["6"].grade = "II";
      map["9"].grade = "I";
      expect(buildBloodMatrixAssessment(map).severe_parasite_signal).toBe(false);
    });

    it("true when cell 6 is grade III", () => {
      const map = createEmptyBloodMatrixMap();
      map["6"].grade = "III";
      expect(buildBloodMatrixAssessment(map).severe_parasite_signal).toBe(true);
    });

    it("true when cell 9 is grade III", () => {
      const map = createEmptyBloodMatrixMap();
      map["9"].grade = "III";
      expect(buildBloodMatrixAssessment(map).severe_parasite_signal).toBe(true);
    });
  });

  it("protocol_step_keys is sliced from the standard list", () => {
    const map = createEmptyBloodMatrixMap();
    // moderate → 2 steps
    map["1"].grade = "III";
    map["2"].grade = "III";

    const result = buildBloodMatrixAssessment(map);
    expect(result.protocol_step_keys).toHaveLength(2);
    expect(result.protocol_step_keys[0]).toBe("hydration");
    expect(result.protocol_step_keys[1]).toBe("gut_support");
  });

  it("AI preset produces consistent assessment", () => {
    const result = buildBloodMatrixAssessment(BLOOD_MATRIX_AI_PRESET);

    // Preset has cells: 2→I, 3→II, 4→II, 5→III, 6→II, 7→I, 9→III = 2xI + 3xII + 2xIII
    expect(result.counts.I).toBe(2);
    expect(result.counts.II).toBe(3);
    expect(result.counts.III).toBe(2);
    expect(result.severity.level).toBe("moderate");
    expect(result.severe_parasite_signal).toBe(true); // cell 9 is III
    expect(result.product_recommendations.length).toBeGreaterThan(0);
  });
});

/* ── createBloodMatrixAiPrompt ────────────────────────────────── */

describe("createBloodMatrixAiPrompt", () => {
  it("includes all 9 cell grades in the output", () => {
    const map = createEmptyBloodMatrixMap();
    const prompt = createBloodMatrixAiPrompt({ matrix: map });

    for (const key of BLOOD_MATRIX_CELL_KEYS) {
      expect(prompt).toContain(`${key}:0`);
    }
  });

  it("includes grade and note for non-empty cells", () => {
    const map = createEmptyBloodMatrixMap();
    map["3"].grade = "II";
    map["3"].note = "mycotic_biofilm";

    const prompt = createBloodMatrixAiPrompt({ matrix: map });
    expect(prompt).toContain("3:II (mycotic_biofilm)");
  });

  it("includes analysis source", () => {
    const prompt = createBloodMatrixAiPrompt({
      matrix: createEmptyBloodMatrixMap(),
      analysis_source: "ai_photo",
    });
    expect(prompt).toContain("ai_photo");
  });

  it("includes summary note when provided", () => {
    const prompt = createBloodMatrixAiPrompt({
      matrix: createEmptyBloodMatrixMap(),
      summary_note: "User shows significant dehydration",
    });
    expect(prompt).toContain("User shows significant dehydration");
  });

  it("omits summary note line when empty", () => {
    const prompt = createBloodMatrixAiPrompt({
      matrix: createEmptyBloodMatrixMap(),
      summary_note: "",
    });
    expect(prompt).not.toContain("Poznámka terapeuta");
  });

  it("defaults analysis_source to manual", () => {
    const prompt = createBloodMatrixAiPrompt({
      matrix: createEmptyBloodMatrixMap(),
    });
    expect(prompt).toContain("manual");
  });
});

/* ── Constants / Types integrity ──────────────────────────────── */

describe("Constants integrity", () => {
  it("BLOOD_MATRIX_CELL_KEYS has exactly 9 entries", () => {
    expect(BLOOD_MATRIX_CELL_KEYS).toHaveLength(9);
  });

  it("BLOOD_MATRIX_GRADES has 4 grades: 0, I, II, III", () => {
    expect(BLOOD_MATRIX_GRADES).toEqual(["0", "I", "II", "III"]);
  });

  it("AI preset has valid grades for all 9 cells", () => {
    const validGrades: ReadonlyArray<BloodMatrixGrade> = BLOOD_MATRIX_GRADES;
    for (const key of BLOOD_MATRIX_CELL_KEYS) {
      const cell = BLOOD_MATRIX_AI_PRESET[key];
      expect(cell).toBeDefined();
      expect(validGrades).toContain(cell.grade);
    }
  });
});
