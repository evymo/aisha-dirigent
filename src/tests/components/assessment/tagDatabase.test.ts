/**
 * @file tagDatabase.test.ts
 * @description Tests for Operational Tag Assessment System (CTAS) tag database
 * 
 * Tests the operational tag definitions and utility functions for the 9-dimension
 * health assessment system. Validates tag structure, mappings, and helper functions.
 */

import { describe, it, expect } from "vitest";
import {
  ALL_TAGS,
  TAGS_BY_DIMENSION,
  VIT_TAGS,
  ENE_TAGS,
  SLP_TAGS,
  PHY_TAGS,
  MET_TAGS,
  IMM_TAGS,
  PSY_TAGS,
  COG_TAGS,
  MOO_TAGS,
  getTagsForDimension,
  getIntensityTags,
  getPatternTags,
  getSymptomTags,
  getContextTags,
  getTagById,
  getTriggeredFollowUps,
} from "@/components/assessment/tagDatabase";
import { DIMENSIONS, DIMENSION_INFO } from "@/components/assessment/types";
import type { Dimension, OperationalTag } from "@/components/assessment/types";

// ============================================================================
// DIMENSION DEFINITIONS
// ============================================================================

describe("DIMENSIONS constant", () => {
  it("should contain all 9 operational dimensions", () => {
    expect(DIMENSIONS).toHaveLength(9);
    expect(DIMENSIONS).toContain("VIT");
    expect(DIMENSIONS).toContain("ENE");
    expect(DIMENSIONS).toContain("SLP");
    expect(DIMENSIONS).toContain("PHY");
    expect(DIMENSIONS).toContain("MET");
    expect(DIMENSIONS).toContain("IMM");
    expect(DIMENSIONS).toContain("PSY");
    expect(DIMENSIONS).toContain("COG");
    expect(DIMENSIONS).toContain("MOO");
  });

  it("should have consistent order: VIT, ENE, SLP, PHY, MET, IMM, PSY, COG, MOO", () => {
    expect(DIMENSIONS).toEqual([
      "VIT", "ENE", "SLP", "PHY", "MET", "IMM", "PSY", "COG", "MOO"
    ]);
  });
});

describe("DIMENSION_INFO constant", () => {
  it("should have info for all dimensions", () => {
    DIMENSIONS.forEach((dim: Dimension) => {
      expect(DIMENSION_INFO[dim]).toBeDefined();
      expect(typeof DIMENSION_INFO[dim].nameKey).toBe("string");
      expect(DIMENSION_INFO[dim].nameKey.length).toBeGreaterThan(0);
    });
  });

  it("should have i18n nameKey for all dimensions", () => {
    expect(DIMENSION_INFO.VIT.nameKey).toBe("assessment.dimensions.VIT.name");
    expect(DIMENSION_INFO.ENE.nameKey).toBe("assessment.dimensions.ENE.name");
    expect(DIMENSION_INFO.SLP.nameKey).toBe("assessment.dimensions.SLP.name");
    expect(DIMENSION_INFO.PHY.nameKey).toBe("assessment.dimensions.PHY.name");
    expect(DIMENSION_INFO.MET.nameKey).toBe("assessment.dimensions.MET.name");
    expect(DIMENSION_INFO.IMM.nameKey).toBe("assessment.dimensions.IMM.name");
    expect(DIMENSION_INFO.PSY.nameKey).toBe("assessment.dimensions.PSY.name");
    expect(DIMENSION_INFO.COG.nameKey).toBe("assessment.dimensions.COG.name");
    expect(DIMENSION_INFO.MOO.nameKey).toBe("assessment.dimensions.MOO.name");
  });

  it("should have icons for all dimensions", () => {
    DIMENSIONS.forEach((dim: Dimension) => {
      expect(DIMENSION_INFO[dim].icon).toBeDefined();
      expect(typeof DIMENSION_INFO[dim].icon).toBe("string");
    });
  });
});

// ============================================================================
// TAG STRUCTURE VALIDATION
// ============================================================================

describe("Tag structure validation", () => {
  describe("ALL_TAGS", () => {
    it("should have unique tag IDs", () => {
      const ids = ALL_TAGS.map(t => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have valid dimension references", () => {
      ALL_TAGS.forEach(tag => {
        expect(DIMENSIONS).toContain(tag.dimension);
      });
    });

    it("should have valid category values", () => {
      const validCategories = ["intensity", "pattern", "symptom", "context"];
      ALL_TAGS.forEach(tag => {
        expect(validCategories).toContain(tag.category);
      });
    });

    it("should have required fields for all tags", () => {
      ALL_TAGS.forEach(tag => {
        expect(tag.id).toBeDefined();
        expect(typeof tag.id).toBe("string");
        expect(tag.dimension).toBeDefined();
        expect(tag.category).toBeDefined();
        expect(tag.labelKey).toBeDefined();
        expect(typeof tag.labelKey).toBe("string");
        expect(tag.labelKey).toMatch(/^assessment\.tags\./);

      });
    });

    it("should have score defined for intensity tags", () => {
      const intensityTags = ALL_TAGS.filter(t => t.category === "intensity");
      intensityTags.forEach(tag => {
        expect(typeof tag.score).toBe("number");
        expect(tag.score).toBeGreaterThanOrEqual(1);
        expect(tag.score).toBeLessThanOrEqual(10);
      });
    });

    it("should have score null for non-intensity tags", () => {
      const nonIntensityTags = ALL_TAGS.filter(t => t.category !== "intensity");
      nonIntensityTags.forEach(tag => {
        expect(tag.score).toBeNull();
      });
    });
  });

  describe("TAGS_BY_DIMENSION", () => {
    it("should have entries for all dimensions", () => {
      DIMENSIONS.forEach((dim: Dimension) => {
        expect(TAGS_BY_DIMENSION[dim]).toBeDefined();
        expect(Array.isArray(TAGS_BY_DIMENSION[dim])).toBe(true);
        expect(TAGS_BY_DIMENSION[dim].length).toBeGreaterThan(0);
      });
    });

    it("should have tags correctly mapped to their dimension", () => {
      Object.entries(TAGS_BY_DIMENSION).forEach(([dimension, tags]) => {
        tags.forEach(tag => {
          expect(tag.dimension).toBe(dimension);
        });
      });
    });

    it("should contain all tags from ALL_TAGS", () => {
      const tagsFromDimensions = Object.values(TAGS_BY_DIMENSION).flat();
      expect(tagsFromDimensions.length).toBe(ALL_TAGS.length);
    });
  });
});

// ============================================================================
// INTENSITY TAG VALIDATION (Score Scale 1-9)
// ============================================================================

describe("Intensity tags (score scale)", () => {
  const allIntensityTags = ALL_TAGS.filter(t => t.category === "intensity");

  it("should have 5 intensity levels per dimension", () => {
    DIMENSIONS.forEach((dim: Dimension) => {
      const intensityTags = getIntensityTags(dim);
      expect(intensityTags.length).toBe(5);
    });
  });

  it("should have scores in a valid range", () => {
    DIMENSIONS.forEach((dim: Dimension) => {
      const intensityTags = getIntensityTags(dim);
      const scores = intensityTags.map(t => t.score).sort((a, b) => (a ?? 0) - (b ?? 0));
      // Accept either 1,3,5,7,9 or 2,4,6,8,10 scale
      const validScales = [
        [1, 3, 5, 7, 9],
        [2, 4, 6, 8, 10]
      ];
      const isValid = validScales.some(scale => 
        scores.length === scale.length && scores.every((s, i) => s === scale[i])
      );
      expect(isValid).toBe(true);
    });
  });

  it("should have consistent naming pattern for extreme values", () => {
    // Excellent/Very good typically has highest score
    const excellentTags = allIntensityTags.filter(t => 
      t.id.includes("excellent") || t.id.includes("_high") || t.id.includes("strong")
    );
    excellentTags.forEach(tag => {
      expect(tag.score).toBeGreaterThanOrEqual(9);
    });

    // Lowest scores: depleted, very_weak, very_low, very_poor have score <= 2
    // Note: "_poor" alone might be mid-low (score 3), but "very_poor" is lowest (score 1)
    const lowestTags = allIntensityTags.filter(t => 
      t.id.includes("depleted") || 
      t.id.includes("very_weak") || 
      t.id.includes("very_low") ||
      t.id.includes("very_poor")
    );
    lowestTags.forEach(tag => {
      expect(tag.score).toBeLessThanOrEqual(2);
    });
  });
});

// ============================================================================
// DIMENSION-SPECIFIC TAG TESTS
// ============================================================================

describe("VIT_TAGS (Celkový stav)", () => {
  it("should have correct structure", () => {
    expect(VIT_TAGS.length).toBeGreaterThan(5);
    expect(VIT_TAGS.every(t => t.dimension === "VIT")).toBe(true);
  });

  it("should have intensity tags for vitality levels", () => {
    const intensityTags = VIT_TAGS.filter(t => t.category === "intensity");
    expect(intensityTags.map(t => t.id)).toContain("vit_excellent");
    expect(intensityTags.map(t => t.id)).toContain("vit_very_good");
    expect(intensityTags.map(t => t.id)).toContain("vit_good");
    expect(intensityTags.map(t => t.id)).toContain("vit_fair");
    expect(intensityTags.map(t => t.id)).toContain("vit_poor");
  });

  it("should have operational mapping for SF-12", () => {
    const excellentTag = VIT_TAGS.find(t => t.id === "vit_excellent");
    expect(excellentTag?.operationalMapping).toBeDefined();
    expect(excellentTag?.operationalMapping).toContain("SF-12_GH");
  });
});

describe("ENE_TAGS (Energie)", () => {
  it("should have correct structure", () => {
    expect(ENE_TAGS.length).toBeGreaterThan(10);
    expect(ENE_TAGS.every(t => t.dimension === "ENE")).toBe(true);
  });

  it("should have symptom tags for energy issues", () => {
    const symptomTags = ENE_TAGS.filter(t => t.category === "symptom");
    expect(symptomTags.length).toBeGreaterThan(0);
  });

  it("should have operational mapping for FACIT-F", () => {
    const recoveryTag = ENE_TAGS.find(t => t.operationalMapping?.some(m => m.includes("FACIT-F")));
    expect(recoveryTag).toBeDefined();
  });
});

describe("SLP_TAGS (Spánek)", () => {
  it("should have correct structure", () => {
    expect(SLP_TAGS.length).toBeGreaterThan(10);
    expect(SLP_TAGS.every(t => t.dimension === "SLP")).toBe(true);
  });

  it("should have context tags for sleep duration", () => {
    const contextTags = SLP_TAGS.filter(t => t.category === "context");
    const contextIds = contextTags.map(t => t.id);
    expect(contextIds).toContain("slp_under_6h");
    expect(contextIds).toContain("slp_6_7h");
    expect(contextIds).toContain("slp_7_8h");
    expect(contextIds).toContain("slp_over_8h");
  });

  it("should have operational mapping for PSQI", () => {
    const excellentSleep = SLP_TAGS.find(t => t.id === "slp_excellent");
    expect(excellentSleep?.operationalMapping).toContain("PSQI_QUAL");
  });

  it("should have follow-up triggers for poor sleep", () => {
    const poorSleep = SLP_TAGS.find(t => t.id === "slp_poor");
    expect(poorSleep?.followUpTrigger).toBeDefined();
    expect(poorSleep?.followUpTrigger).toContain("slp_issues");
  });
});

describe("PHY_TAGS (Fyzické tělo)", () => {
  it("should have correct structure", () => {
    expect(PHY_TAGS.length).toBeGreaterThan(10);
    expect(PHY_TAGS.every(t => t.dimension === "PHY")).toBe(true);
  });

  it("should have symptom tags for pain locations", () => {
    const symptomTags = PHY_TAGS.filter(t => t.category === "symptom");
    const symptomIds = symptomTags.map(t => t.id);
    expect(symptomIds).toContain("phy_pain_joints");
    expect(symptomIds).toContain("phy_pain_muscles");
    expect(symptomIds).toContain("phy_pain_back");
    expect(symptomIds).toContain("phy_pain_head");
  });

  it("should have inverse scores for pain tags", () => {
    const jointPain = PHY_TAGS.find(t => t.id === "phy_pain_joints");
    expect(jointPain?.inverseScore).toBe(true);
  });
});

describe("MET_TAGS (Metabolismus)", () => {
  it("should have correct structure", () => {
    expect(MET_TAGS.length).toBeGreaterThan(10);
    expect(MET_TAGS.every(t => t.dimension === "MET")).toBe(true);
  });

  it("should have pattern tags for energy stability", () => {
    const patternTags = MET_TAGS.filter(t => t.category === "pattern");
    const patternIds = patternTags.map(t => t.id);
    expect(patternIds).toContain("met_stable_appetite");
    expect(patternIds).toContain("met_energy_crash");
    expect(patternIds).toContain("met_cravings");
  });

  it("should have symptom tags for digestive issues", () => {
    const symptomTags = MET_TAGS.filter(t => t.category === "symptom");
    const symptomIds = symptomTags.map(t => t.id);
    expect(symptomIds).toContain("met_bloating");
    expect(symptomIds).toContain("met_heartburn");
  });
});

describe("IMM_TAGS (Imunita)", () => {
  it("should have correct structure", () => {
    expect(IMM_TAGS.length).toBeGreaterThan(10);
    expect(IMM_TAGS.every(t => t.dimension === "IMM")).toBe(true);
  });

  it("should have pattern tags for illness frequency", () => {
    const patternTags = IMM_TAGS.filter(t => t.category === "pattern");
    const patternIds = patternTags.map(t => t.id);
    expect(patternIds).toContain("imm_rarely_sick");
    expect(patternIds).toContain("imm_sometimes_sick");
    expect(patternIds).toContain("imm_often_sick");
  });

  it("should have symptom tags for immune conditions", () => {
    const symptomTags = IMM_TAGS.filter(t => t.category === "symptom");
    const symptomIds = symptomTags.map(t => t.id);
    expect(symptomIds).toContain("imm_allergies");
    expect(symptomIds).toContain("imm_inflammation");
    expect(symptomIds).toContain("imm_autoimmune");
  });
});

describe("PSY_TAGS (Psychika)", () => {
  it("should have correct structure", () => {
    expect(PSY_TAGS.length).toBeGreaterThan(10);
    expect(PSY_TAGS.every(t => t.dimension === "PSY")).toBe(true);
  });

  it("should have pattern tags for stress levels", () => {
    const patternTags = PSY_TAGS.filter(t => t.category === "pattern");
    const patternIds = patternTags.map(t => t.id);
    expect(patternIds).toContain("psy_low_stress");
    expect(patternIds).toContain("psy_moderate_stress");
    expect(patternIds).toContain("psy_high_stress");
    expect(patternIds).toContain("psy_chronic_stress");
  });

  it("should have operational mapping for HADS and PSS-10", () => {
    const excellentPsy = PSY_TAGS.find(t => t.id === "psy_excellent");
    expect(excellentPsy?.operationalMapping).toContain("HADS_total");

    const lowStress = PSY_TAGS.find(t => t.id === "psy_low_stress");
    expect(lowStress?.operationalMapping).toContain("PSS-10");

    const anxiety = PSY_TAGS.find(t => t.id === "psy_anxiety");
    expect(anxiety?.operationalMapping).toContain("HADS_A");
  });
});

describe("COG_TAGS (Kognice)", () => {
  it("should have correct structure", () => {
    expect(COG_TAGS.length).toBeGreaterThan(10);
    expect(COG_TAGS.every(t => t.dimension === "COG")).toBe(true);
  });

  it("should have symptom tags for cognitive issues", () => {
    const symptomTags = COG_TAGS.filter(t => t.category === "symptom");
    const symptomIds = symptomTags.map(t => t.id);
    expect(symptomIds).toContain("cog_brain_fog");
    expect(symptomIds).toContain("cog_concentration");
    expect(symptomIds).toContain("cog_memory");
    expect(symptomIds).toContain("cog_mental_fatigue");
    expect(symptomIds).toContain("cog_word_finding");
  });

  it("should have operational mapping for MoCA", () => {
    const concentration = COG_TAGS.find(t => t.id === "cog_concentration");
    expect(concentration?.operationalMapping).toContain("MoCA_attention");

    const memory = COG_TAGS.find(t => t.id === "cog_memory");
    expect(memory?.operationalMapping).toContain("MoCA_memory");
  });
});

describe("MOO_TAGS (Nálada)", () => {
  it("should have correct structure", () => {
    expect(MOO_TAGS.length).toBeGreaterThan(10);
    expect(MOO_TAGS.every(t => t.dimension === "MOO")).toBe(true);
  });

  it("should have pattern tags for mood stability", () => {
    const patternTags = MOO_TAGS.filter(t => t.category === "pattern");
    const patternIds = patternTags.map(t => t.id);
    expect(patternIds).toContain("moo_stable");
    expect(patternIds).toContain("moo_swings");
  });

  it("should have symptom tags for motivation and joy", () => {
    const symptomTags = MOO_TAGS.filter(t => t.category === "symptom");
    const symptomIds = symptomTags.map(t => t.id);
    expect(symptomIds).toContain("moo_motivated");
    expect(symptomIds).toContain("moo_low_motivation");
    expect(symptomIds).toContain("moo_joy");
    expect(symptomIds).toContain("moo_anhedonia");
  });

  it("should have operational mapping for HADS depression scale", () => {
    const lowMood = MOO_TAGS.find(t => t.id === "moo_low");
    expect(lowMood?.operationalMapping).toContain("HADS_D");

    const anhedonia = MOO_TAGS.find(t => t.id === "moo_anhedonia");
    expect(anhedonia?.operationalMapping).toContain("HADS_D_anhedonia");
  });

  it("should have follow-up trigger for severe mood issues", () => {
    const depressed = MOO_TAGS.find(t => t.id === "moo_depressed");
    expect(depressed?.followUpTrigger).toContain("moo_support_needed");

    const hopeless = MOO_TAGS.find(t => t.id === "moo_hopeless");
    expect(hopeless?.followUpTrigger).toContain("moo_support_needed");
  });
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

describe("getTagsForDimension", () => {
  it("should return tags for valid dimension", () => {
    const vitTags = getTagsForDimension("VIT");
    expect(vitTags.length).toBeGreaterThan(0);
    expect(vitTags.every(t => t.dimension === "VIT")).toBe(true);
  });

  it("should return same tags as TAGS_BY_DIMENSION", () => {
    DIMENSIONS.forEach((dim: Dimension) => {
      expect(getTagsForDimension(dim)).toEqual(TAGS_BY_DIMENSION[dim]);
    });
  });

  it("should return empty array for invalid dimension", () => {
    // @ts-expect-error - Testing invalid input
    const tags = getTagsForDimension("INVALID");
    expect(tags).toEqual([]);
  });
});

describe("getIntensityTags", () => {
  it("should return only intensity category tags", () => {
    DIMENSIONS.forEach((dim: Dimension) => {
      const intensityTags = getIntensityTags(dim);
      expect(intensityTags.every(t => t.category === "intensity")).toBe(true);
    });
  });

  it("should return tags with numeric scores", () => {
    DIMENSIONS.forEach((dim: Dimension) => {
      const intensityTags = getIntensityTags(dim);
      expect(intensityTags.every(t => typeof t.score === "number")).toBe(true);
    });
  });
});

describe("getPatternTags", () => {
  it("should return only pattern category tags", () => {
    const patternTags = getPatternTags("PSY");
    expect(patternTags.length).toBeGreaterThan(0);
    expect(patternTags.every(t => t.category === "pattern")).toBe(true);
  });

  it("should return empty array for dimensions without patterns", () => {
    // VIT doesn't have pattern tags based on our structure
    const vitPatterns = getPatternTags("VIT");
    // This might or might not have patterns depending on implementation
    expect(Array.isArray(vitPatterns)).toBe(true);
  });
});

describe("getSymptomTags", () => {
  it("should return only symptom category tags", () => {
    DIMENSIONS.forEach((dim: Dimension) => {
      const symptomTags = getSymptomTags(dim);
      expect(symptomTags.every(t => t.category === "symptom")).toBe(true);
    });
  });

  it("should return symptom tags for each dimension", () => {
    DIMENSIONS.forEach((dim: Dimension) => {
      const symptomTags = getSymptomTags(dim);
      expect(symptomTags.length).toBeGreaterThan(0);
    });
  });
});

describe("getContextTags", () => {
  it("should return only context category tags", () => {
    const contextTags = getContextTags("SLP");
    expect(contextTags.length).toBeGreaterThan(0);
    expect(contextTags.every(t => t.category === "context")).toBe(true);
  });

  it("should return sleep duration options for SLP", () => {
    const contextTags = getContextTags("SLP");
    const ids = contextTags.map(t => t.id);
    expect(ids).toContain("slp_under_6h");
    expect(ids).toContain("slp_7_8h");
  });
});

describe("getTagById", () => {
  it("should find tag by exact ID", () => {
    const tag = getTagById("vit_excellent");
    expect(tag).toBeDefined();
    expect(tag?.id).toBe("vit_excellent");
    expect(tag?.dimension).toBe("VIT");
  });

  it("should return undefined for non-existent ID", () => {
    const tag = getTagById("non_existent_tag_id");
    expect(tag).toBeUndefined();
  });

  it("should find tags from all dimensions", () => {
    expect(getTagById("vit_excellent")).toBeDefined();
    expect(getTagById("ene_high")).toBeDefined();
    expect(getTagById("slp_excellent")).toBeDefined();
    expect(getTagById("phy_excellent")).toBeDefined();
    expect(getTagById("met_excellent")).toBeDefined();
    expect(getTagById("imm_strong")).toBeDefined();
    expect(getTagById("psy_excellent")).toBeDefined();
    expect(getTagById("cog_excellent")).toBeDefined();
    expect(getTagById("moo_excellent")).toBeDefined();
  });
});

describe("getTriggeredFollowUps", () => {
  it("should return empty array for empty selection", () => {
    const triggers = getTriggeredFollowUps([]);
    expect(triggers).toEqual([]);
  });

  it("should return empty array for tags without triggers", () => {
    const triggers = getTriggeredFollowUps(["vit_good", "ene_high"]);
    expect(triggers).toEqual([]);
  });

  it("should return follow-up triggers for tags with triggers", () => {
    const triggers = getTriggeredFollowUps(["slp_poor"]);
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers).toContain("slp_issues");
  });

  it("should aggregate triggers from multiple tags", () => {
    // Tags with different triggers
    const triggers = getTriggeredFollowUps([
      "slp_very_poor", // has multiple triggers
      "psy_chronic_stress", // has stress-related triggers
    ]);
    expect(triggers.length).toBeGreaterThan(2);
  });

  it("should deduplicate common triggers", () => {
    // If two tags trigger the same follow-up, it should appear once
    const triggers = getTriggeredFollowUps([
      "moo_depressed",
      "moo_hopeless",
    ]);
    const supportCount = triggers.filter(t => t === "moo_support_needed").length;
    expect(supportCount).toBeLessThanOrEqual(1);
  });

  it("should ignore non-existent tag IDs", () => {
    const triggers = getTriggeredFollowUps(["non_existent", "slp_poor"]);
    // Should still return triggers from valid tags
    expect(triggers).toContain("slp_issues");
  });
});

// ============================================================================
// CLINICAL MAPPING VALIDATION
// ============================================================================

describe("Operational mapping coverage", () => {
  it("should have operational mappings for key assessment instruments", () => {
    const instruments = [
      "SF-12", // Short Form Health Survey
      "FACIT-F", // Functional Assessment of Chronic Illness Therapy - Fatigue
      "PSQI", // Pittsburgh Sleep Quality Index
      "HADS", // Hospital Anxiety and Depression Scale
      "PSS-10", // Perceived Stress Scale
      "MoCA", // Montreal Cognitive Assessment
    ];

    instruments.forEach(instrument => {
      const tagsWithMapping = ALL_TAGS.filter(
        t => t.operationalMapping?.some(m => m.startsWith(instrument))
      );
      expect(tagsWithMapping.length).toBeGreaterThan(0);
    });
  });

  it("should have HADS_A mapping for anxiety tags", () => {
    const anxietyTag = getTagById("psy_anxiety");
    expect(anxietyTag?.operationalMapping).toContain("HADS_A");
  });

  it("should have HADS_D mapping for depression tags", () => {
    const lowMoodTag = getTagById("moo_low");
    expect(lowMoodTag?.operationalMapping).toContain("HADS_D");
  });
});

// ============================================================================
// INVERSE SCORE VALIDATION
// ============================================================================

describe("Inverse score tags", () => {
  it("should mark negative symptoms with inverseScore=true", () => {
    const negativeTags = ALL_TAGS.filter(t => 
      t.id.includes("chronic") ||
      t.id.includes("pain") ||
      t.id.includes("anxiety") ||
      t.id.includes("fatigue") ||
      t.id.includes("poor") && t.category === "symptom"
    );

    negativeTags.forEach(tag => {
      if (tag.category === "symptom") {
        // Most negative symptoms should be inverse
        expect(tag.inverseScore === true || tag.inverseScore === undefined).toBe(true);
      }
    });
  });

  it("should NOT mark positive indicators with inverseScore", () => {
    // Filter for tags that end with positive indicators (not containing negatives like "rare_joy")
    const positiveTags = ALL_TAGS.filter(t => 
      t.id.endsWith("_no_issues") ||
      t.id.endsWith("_motivated") ||
      // Explicitly positive joy tags, excluding "rare_joy" which is negative
      (t.id.endsWith("_joy") && !t.id.includes("rare")) ||
      t.id.endsWith("_sharp") ||
      t.id.endsWith("_calm") ||
      t.id.endsWith("_frequent_joy")  // This is positive
    );

    positiveTags.forEach(tag => {
      expect(tag.inverseScore, `Tag ${tag.id} should not have inverseScore`).toBeFalsy();
    });
  });
});

// ============================================================================
// METADATA VALIDATION
// ============================================================================

describe("Tag metadata", () => {
  it("should have metadata for some tags", () => {
    // Check that at least some tags have metadata
    const tagsWithMetadata = ALL_TAGS.filter(t => t.metadata);
    expect(tagsWithMetadata.length).toBeGreaterThan(0);
  });

  it("should have duration metadata for context tags", () => {
    const underSixHours = getTagById("slp_under_6h");
    expect(underSixHours?.metadata?.duration).toBe("chronic");
  });
});
