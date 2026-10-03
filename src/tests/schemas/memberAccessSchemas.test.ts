import { describe, expect, it } from "vitest";

import {
  ConsentStatusSchema,
  DataCategoryPermissionSchema,
  DataCategorySchema,
  MemberAccessLevelSchema,
  MemberAccessSummarySchema,
  determineAccessLevel,
  getDefaultPermissions,
  getFullAccessPermissions,
} from "@/schemas/memberAccessSchemas";

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const STUDY_ID = "22222222-2222-4222-8222-222222222222";
const REGISTRATION_ID = "33333333-3333-4333-8333-333333333333";

describe("memberAccessSchemas", () => {
  it("validates enums and category permissions", () => {
    expect(MemberAccessLevelSchema.parse("full")).toBe("full");
    expect(ConsentStatusSchema.parse("granted")).toBe("granted");
    expect(DataCategorySchema.parse("lab_results")).toBe("lab_results");
    expect(DataCategoryPermissionSchema.parse({
      category: "documents",
      can_view: true,
      can_use_for_research: false,
      can_use_for_statistics: true,
    }).category).toBe("documents");
  });

  it("determines access level from consent and permissions", () => {
    const noneVisible = getDefaultPermissions();
    const fullVisible = getFullAccessPermissions();
    const limitedVisible = fullVisible.map((permission, index) => ({
      ...permission,
      can_view: index === 0,
    }));

    expect(determineAccessLevel("pending", fullVisible)).toBe("anonymized");
    expect(determineAccessLevel("granted", fullVisible)).toBe("full");
    expect(determineAccessLevel("granted", limitedVisible)).toBe("limited");
    expect(determineAccessLevel("granted", noneVisible)).toBe("anonymized");
  });

  it("creates default and full access permission sets for every data category", () => {
    const defaults = getDefaultPermissions();
    const full = getFullAccessPermissions();

    expect(defaults).toHaveLength(6);
    expect(defaults.every((permission) => !permission.can_view)).toBe(true);
    expect(defaults.every((permission) => permission.can_use_for_statistics)).toBe(true);
    expect(full).toHaveLength(6);
    expect(full.every((permission) => permission.can_view)).toBe(true);
    expect(full.every((permission) => permission.can_use_for_research)).toBe(true);
  });

  it("validates member access summaries", () => {
    const summary = MemberAccessSummarySchema.parse({
      member_id: MEMBER_ID,
      member_token: "anon-001",
      display_name: "Aisha Member",
      access_level: "limited",
      consent_status: "granted",
      consent_granted_at: "2026-04-01T00:00:00.000Z",
      consent_expires_at: "2027-04-01T00:00:00.000Z",
      study_id: STUDY_ID,
      study_name: "Longevity Study",
      study_code: "LONG-01",
      registration_id: REGISTRATION_ID,
      registration_status: "active",
      enrolled_at: "2026-03-01T00:00:00.000Z",
      permissions: getDefaultPermissions(),
      last_activity_at: "2026-04-02T00:00:00.000Z",
      member_since: "2026-01-01T00:00:00.000Z",
      total_check_ins: 10,
      total_documents: 2,
      has_recent_activity: true,
    });

    expect(summary.member_id).toBe(MEMBER_ID);
    expect(summary.permissions).toHaveLength(6);
  });

  it("rejects malformed member identifiers", () => {
    expect(() =>
      MemberAccessSummarySchema.parse({
        member_id: "not-a-uuid",
        access_level: "none",
        consent_status: "never_asked",
        permissions: [],
      }),
    ).toThrow();
  });
});
