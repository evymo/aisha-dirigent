/**
 * Score Calculator Tests
 * 
 * Tests for the Longevity Score calculation logic including:
 * - Dimension score calculation
 * - Overall score calculation
 * - Interpretation functions
 * - Color/styling helpers
 * - Operational flag detection
 */

import { describe, it, expect } from "vitest";
import {
  calculateDimensionScore,
  calculateLongevityScore,
  getScoreInterpretation,
  getTrendInterpretation,
  getScoreColorClass,
  getScoreBgClass,
  getTrendColorClass,
  getTrendArrow,
  hasCriticalFlags,
  getPriorityDimensions,
} from "@/components/assessment/scoreCalculator";
import type { LongevityScore, Dimension } from "@/components/assessment/types";

describe("scoreCalculator", () => {
  describe("calculateDimensionScore", () => {
    it("should calculate score with only intensity tag", () => {
      const result = calculateDimensionScore("VIT", ["vit_excellent"]);

      expect(result.dimension).toBe("VIT");
      expect(result.rawScore).toBe(10);
      expect(result.normalizedScore).toBe(100);
      expect(result.tagCount).toBe(1);
      expect(result.hasNegativeIndicators).toBe(false);
    });

    it("should return default score when no tags selected", () => {
      const result = calculateDimensionScore("VIT", []);

      expect(result.rawScore).toBe(5); // Default average
      expect(result.normalizedScore).toBe(50);
      expect(result.tagCount).toBe(0);
    });

    it("should reduce score for negative symptoms", () => {
      // vit_limited and vit_struggling have inverseScore: true
      const result = calculateDimensionScore("VIT", ["vit_good", "vit_limited", "vit_struggling"]);

      // Base score 6 (vit_good) - 1.0 (2 negative symptoms * 0.5) = 5
      expect(result.rawScore).toBe(5);
      expect(result.hasNegativeIndicators).toBe(true);
    });

    it("should increase score for positive symptoms", () => {
      // vit_alive and vit_functioning are positive symptoms
      const result = calculateDimensionScore("VIT", ["vit_fair", "vit_alive", "vit_functioning"]);

      // Base score 4 (vit_fair) + 0.5 (2 positive symptoms * 0.25) = 4.5
      expect(result.rawScore).toBe(4.5);
    });

    it("should cap negative adjustment at -2.5", () => {
      // Even with many negative symptoms, cap at -2.5
      const result = calculateDimensionScore("VIT", [
        "vit_excellent",
        "vit_limited",
        "vit_struggling",
      ]);

      // Base 10 - 1.0 = 9 (only 2 negative symptoms available)
      expect(result.rawScore).toBeGreaterThanOrEqual(0);
      expect(result.rawScore).toBeLessThanOrEqual(10);
    });

    it("should collect operational flags from follow-up triggers", () => {
      // vit_poor and vit_limited have followUpTrigger
      const result = calculateDimensionScore("VIT", ["vit_poor", "vit_limited"]);

      expect(result.operationalFlags.length).toBeGreaterThan(0);
    });

    it("should handle ENE dimension correctly", () => {
      const result = calculateDimensionScore("ENE", ["ene_high"]);

      expect(result.dimension).toBe("ENE");
      expect(result.rawScore).toBeGreaterThan(0);
    });

    it("should handle SLP dimension correctly", () => {
      const result = calculateDimensionScore("SLP", ["slp_excellent"]);

      expect(result.dimension).toBe("SLP");
    });
  });

  describe("calculateLongevityScore", () => {
    it("should calculate overall score from all dimensions", () => {
      const selectedTags = {
        VIT: ["vit_excellent"],
        ENE: ["ene_high"],
        SLP: ["slp_excellent"],
        PHY: ["phy_excellent"],
        MET: ["met_excellent"],
        IMM: ["imm_excellent"],
        PSY: ["psy_excellent"],
        COG: ["cog_excellent"],
        MOO: ["moo_excellent"],
      };

      const result = calculateLongevityScore(selectedTags);

      expect(result.overall).toBeGreaterThan(0);
      expect(result.dimensions).toHaveLength(9);
      expect(result.interpretation).toBeDefined();
      expect(result.assessmentDate).toBeInstanceOf(Date);
    });

    it("should return excellent interpretation for high scores", () => {
      const selectedTags = {
        VIT: ["vit_excellent"],
        ENE: ["ene_high"],
        SLP: ["slp_excellent"],
        PHY: ["phy_excellent"],
        MET: ["met_excellent"],
        IMM: ["imm_excellent"],
        PSY: ["psy_excellent"],
        COG: ["cog_excellent"],
        MOO: ["moo_excellent"],
      };

      const result = calculateLongevityScore(selectedTags);

      expect(result.interpretation).toBe("excellent");
    });

    it("should return poor interpretation for low scores", () => {
      const selectedTags = {
        VIT: ["vit_poor"],
        ENE: ["ene_none"],
        SLP: ["slp_poor"],
        PHY: ["phy_poor"],
        MET: ["met_poor"],
        IMM: ["imm_poor"],
        PSY: ["psy_poor"],
        COG: ["cog_poor"],
        MOO: ["moo_poor"],
      };

      const result = calculateLongevityScore(selectedTags);

      expect(result.interpretation).toBe("poor");
    });

    it("should calculate alert flags for low dimensions", () => {
      const selectedTags = {
        VIT: ["vit_poor"],  // Low score
        ENE: ["ene_high"],  // High score
        SLP: ["slp_poor"],  // Low score
        PHY: ["phy_excellent"],
        MET: ["met_excellent"],
        IMM: ["imm_excellent"],
        PSY: ["psy_excellent"],
        COG: ["cog_excellent"],
        MOO: ["moo_excellent"],
      };

      const result = calculateLongevityScore(selectedTags);

      // Should flag dimensions below 40%
      expect(result.alertFlags).toContain("VIT");
      expect(result.alertFlags).toContain("SLP");
    });

    it("should calculate trend vs baseline when provided", () => {
      const baselineScore: LongevityScore = {
        overall: 50,
        dimensions: [],
        interpretation: "average",
        alertFlags: [],
        assessmentDate: new Date("2024-01-01"),
      };

      const selectedTags = {
        VIT: ["vit_excellent"],
        ENE: ["ene_high"],
        SLP: ["slp_excellent"],
        PHY: ["phy_excellent"],
        MET: ["met_excellent"],
        IMM: ["imm_excellent"],
        PSY: ["psy_excellent"],
        COG: ["cog_excellent"],
        MOO: ["moo_excellent"],
      };

      const result = calculateLongevityScore(selectedTags, baselineScore);

      expect(result.trendVsBaseline).toBeDefined();
      expect(result.trendVsBaseline).toBeGreaterThan(0); // Should improve
    });

    it("should handle empty selected tags", () => {
      const selectedTags = {
        VIT: [],
        ENE: [],
        SLP: [],
        PHY: [],
        MET: [],
        IMM: [],
        PSY: [],
        COG: [],
        MOO: [],
      };

      const result = calculateLongevityScore(selectedTags);

      // All dimensions default to 5 (50%) when no intensity selected
      expect(result.overall).toBe(50);
      expect(result.interpretation).toBe("average");
    });
  });

  describe("getScoreInterpretation", () => {
    it("should return 'Výborný stav' for scores >= 80", () => {
      expect(getScoreInterpretation(80)).toBe("Výborný stav");
      expect(getScoreInterpretation(90)).toBe("Výborný stav");
      expect(getScoreInterpretation(100)).toBe("Výborný stav");
    });

    it("should return 'Dobrý stav' for scores 60-79", () => {
      expect(getScoreInterpretation(60)).toBe("Dobrý stav");
      expect(getScoreInterpretation(70)).toBe("Dobrý stav");
      expect(getScoreInterpretation(79)).toBe("Dobrý stav");
    });

    it("should return 'Průměrný stav' for scores 40-59", () => {
      expect(getScoreInterpretation(40)).toBe("Průměrný stav");
      expect(getScoreInterpretation(50)).toBe("Průměrný stav");
      expect(getScoreInterpretation(59)).toBe("Průměrný stav");
    });

    it("should return 'Vyžaduje pozornost' for scores < 40", () => {
      expect(getScoreInterpretation(0)).toBe("Vyžaduje pozornost");
      expect(getScoreInterpretation(20)).toBe("Vyžaduje pozornost");
      expect(getScoreInterpretation(39)).toBe("Vyžaduje pozornost");
    });
  });

  describe("getTrendInterpretation", () => {
    it("should return appropriate trend descriptions", () => {
      expect(getTrendInterpretation(25)).toBe("Výrazné zlepšení");
      expect(getTrendInterpretation(15)).toBe("Zlepšení");
      expect(getTrendInterpretation(7)).toBe("Mírné zlepšení");
      expect(getTrendInterpretation(0)).toBe("Stabilní stav");
      expect(getTrendInterpretation(-7)).toBe("Mírné zhoršení");
      expect(getTrendInterpretation(-15)).toBe("Zhoršení");
      expect(getTrendInterpretation(-25)).toBe("Výrazné zhoršení");
    });
  });

  describe("getScoreColorClass", () => {
    it("should return green for high scores", () => {
      expect(getScoreColorClass(80)).toContain("green");
    });

    it("should return lime for good scores", () => {
      expect(getScoreColorClass(70)).toContain("lime");
    });

    it("should return yellow for average scores", () => {
      expect(getScoreColorClass(50)).toContain("yellow");
    });

    it("should return red for low scores", () => {
      expect(getScoreColorClass(20)).toContain("red");
    });
  });

  describe("getScoreBgClass", () => {
    it("should return background classes for all score ranges", () => {
      expect(getScoreBgClass(85)).toContain("green");
      expect(getScoreBgClass(65)).toContain("lime");
      expect(getScoreBgClass(45)).toContain("yellow");
      expect(getScoreBgClass(25)).toContain("red");
    });
  });

  describe("getTrendColorClass", () => {
    it("should return green for positive trends", () => {
      expect(getTrendColorClass(15)).toContain("green");
    });

    it("should return lime for slightly positive trends", () => {
      expect(getTrendColorClass(5)).toContain("lime");
    });

    it("should return yellow for negative trends", () => {
      expect(getTrendColorClass(-7)).toContain("yellow");
    });

    it("should return red for strongly negative trends", () => {
      expect(getTrendColorClass(-15)).toContain("red");
    });
  });

  describe("getTrendArrow", () => {
    it("should return correct icon names for trend values", () => {
      expect(getTrendArrow(15)).toBe("chevrons-up");
      expect(getTrendArrow(7)).toBe("chevron-up");
      expect(getTrendArrow(0)).toBe("arrow-right");
      expect(getTrendArrow(-7)).toBe("chevron-down");
      expect(getTrendArrow(-15)).toBe("chevrons-down");
    });
  });

  describe("hasCriticalFlags", () => {
    it("should return true when dimension score is below 20%", () => {
      const score: LongevityScore = {
        overall: 30,
        dimensions: [
          { dimension: "VIT" as Dimension, rawScore: 1, normalizedScore: 10, tagCount: 1, hasNegativeIndicators: true, operationalFlags: [] },
          { dimension: "ENE" as Dimension, rawScore: 5, normalizedScore: 50, tagCount: 1, hasNegativeIndicators: false, operationalFlags: [] },
        ],
        interpretation: "poor",
        alertFlags: ["VIT"],
        assessmentDate: new Date(),
      };

      expect(hasCriticalFlags(score)).toBe(true);
    });

    it("should return true when dimension has 3+ operational flags", () => {
      const score: LongevityScore = {
        overall: 60,
        dimensions: [
          { dimension: "VIT" as Dimension, rawScore: 6, normalizedScore: 60, tagCount: 5, hasNegativeIndicators: false, operationalFlags: ["flag1", "flag2", "flag3"] },
        ],
        interpretation: "good",
        alertFlags: [],
        assessmentDate: new Date(),
      };

      expect(hasCriticalFlags(score)).toBe(true);
    });

    it("should return false when no critical conditions", () => {
      const score: LongevityScore = {
        overall: 70,
        dimensions: [
          { dimension: "VIT" as Dimension, rawScore: 7, normalizedScore: 70, tagCount: 3, hasNegativeIndicators: false, operationalFlags: ["flag1"] },
        ],
        interpretation: "good",
        alertFlags: [],
        assessmentDate: new Date(),
      };

      expect(hasCriticalFlags(score)).toBe(false);
    });
  });

  describe("getPriorityDimensions", () => {
    it("should return dimensions with score below 50%, sorted by score", () => {
      const score: LongevityScore = {
        overall: 50,
        dimensions: [
          { dimension: "VIT" as Dimension, rawScore: 2, normalizedScore: 20, tagCount: 1, hasNegativeIndicators: true, operationalFlags: [] },
          { dimension: "ENE" as Dimension, rawScore: 3, normalizedScore: 30, tagCount: 1, hasNegativeIndicators: true, operationalFlags: [] },
          { dimension: "SLP" as Dimension, rawScore: 8, normalizedScore: 80, tagCount: 1, hasNegativeIndicators: false, operationalFlags: [] },
          { dimension: "PHY" as Dimension, rawScore: 4, normalizedScore: 40, tagCount: 1, hasNegativeIndicators: true, operationalFlags: [] },
        ],
        interpretation: "average",
        alertFlags: ["VIT", "ENE", "PHY"],
        assessmentDate: new Date(),
      };

      const priorities = getPriorityDimensions(score);

      // Should be sorted by score (lowest first) and limited to 3
      expect(priorities).toHaveLength(3);
      expect(priorities[0]).toBe("VIT"); // 20%
      expect(priorities[1]).toBe("ENE"); // 30%
      expect(priorities[2]).toBe("PHY"); // 40%
    });

    it("should return empty array when all dimensions are good", () => {
      const score: LongevityScore = {
        overall: 80,
        dimensions: [
          { dimension: "VIT" as Dimension, rawScore: 8, normalizedScore: 80, tagCount: 1, hasNegativeIndicators: false, operationalFlags: [] },
        ],
        interpretation: "excellent",
        alertFlags: [],
        assessmentDate: new Date(),
      };

      expect(getPriorityDimensions(score)).toHaveLength(0);
    });
  });
});
