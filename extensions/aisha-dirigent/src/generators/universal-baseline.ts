/**
 * Universal baseline rules — framework-agnostic golden standards.
 *
 * Used as Tier 3 fallback when neither backend (MCP) nor local LLM
 * are available. Contains only universally applicable software engineering
 * principles — no framework-specific or project-specific rules.
 *
 * @module
 */

import type { InstructionPayload, ExpertRule } from "./registry";

/** Categories of universal baseline rules. */
const BASELINE_CATEGORIES = [
  "code_quality",
  "testing",
  "security",
  "architecture",
  "git_workflow",
] as const;

type BaselineCategory = typeof BASELINE_CATEGORIES[number];

const BASELINE_RULES: Record<BaselineCategory, ExpertRule[]> = {
  code_quality: [
    {
      slug: "baseline-no-regressions",
      title: "No Regressions",
      category: "code_quality",
      ai_instructions: [
        "Every change must be verified to not break existing functionality.",
        "Run the full test suite before committing. If a test fails, fix it before proceeding.",
        "Never comment out or skip failing tests to make a commit pass.",
      ].join("\n"),
    },
    {
      slug: "baseline-separation-of-concerns",
      title: "Separation of Concerns",
      category: "code_quality",
      ai_instructions: [
        "Each function, module, or class should have a single, well-defined responsibility.",
        "Extract reusable logic into dedicated functions or modules.",
        "Avoid mixing I/O, business logic, and presentation in a single unit.",
      ].join("\n"),
    },
    {
      slug: "baseline-naming-clarity",
      title: "Clear Naming",
      category: "code_quality",
      ai_instructions: [
        "Use descriptive, intention-revealing names for variables, functions, and types.",
        "Avoid abbreviations unless universally understood (e.g., `id`, `url`).",
        "Boolean variables should read as questions: `isActive`, `hasPermission`, `canEdit`.",
      ].join("\n"),
    },
    {
      slug: "baseline-dry-principle",
      title: "DRY — Don't Repeat Yourself",
      category: "code_quality",
      ai_instructions: [
        "Avoid duplicating logic. If the same pattern appears 3+ times, extract it.",
        "However, prefer duplication over premature abstraction — extract only when the pattern is stable.",
      ].join("\n"),
    },
  ],

  testing: [
    {
      slug: "baseline-test-new-code",
      title: "Test All New Code",
      category: "testing",
      ai_instructions: [
        "Every new function, endpoint, or feature must have corresponding tests.",
        "Tests should verify both the happy path and important edge cases / error conditions.",
        "Prefer small, focused tests over large integration tests.",
      ].join("\n"),
    },
    {
      slug: "baseline-test-stability",
      title: "Stable Tests",
      category: "testing",
      ai_instructions: [
        "Tests must be deterministic — no flaky tests that sometimes pass, sometimes fail.",
        "Avoid relying on external services, network, or timing in unit tests.",
        "Mock external dependencies at the boundary.",
      ].join("\n"),
    },
  ],

  security: [
    {
      slug: "baseline-no-secrets-in-code",
      title: "No Secrets in Code",
      category: "security",
      ai_instructions: [
        "Never commit passwords, API keys, tokens, or other credentials to the repository.",
        "Use environment variables or secret management services for sensitive values.",
        "Add sensitive file patterns to .gitignore (e.g., .env, *.pem, *.key).",
      ].join("\n"),
    },
    {
      slug: "baseline-input-validation",
      title: "Validate All Input",
      category: "security",
      ai_instructions: [
        "Validate and sanitize all input at system boundaries (API endpoints, form inputs, file uploads).",
        "Use parameterized queries or ORM methods — never construct SQL/queries from user input strings.",
        "Reject unexpected input shapes rather than trying to coerce them.",
      ].join("\n"),
    },
    {
      slug: "baseline-least-privilege",
      title: "Principle of Least Privilege",
      category: "security",
      ai_instructions: [
        "Grant only the minimum permissions necessary for each operation.",
        "Default to deny — require explicit permission grants.",
        "Service accounts and database roles should have scoped, minimal access.",
      ].join("\n"),
    },
  ],

  architecture: [
    {
      slug: "baseline-solid-principles",
      title: "SOLID Principles",
      category: "architecture",
      ai_instructions: [
        "**Single Responsibility:** Each module/class has one reason to change.",
        "**Open/Closed:** Open for extension, closed for modification.",
        "**Liskov Substitution:** Subtypes must be substitutable for base types.",
        "**Interface Segregation:** Prefer small, specific interfaces over large ones.",
        "**Dependency Inversion:** Depend on abstractions, not concrete implementations.",
      ].join("\n"),
    },
    {
      slug: "baseline-service-boundaries",
      title: "Service-Oriented Design",
      category: "architecture",
      ai_instructions: [
        "Structure the codebase as services or modules that communicate through well-defined interfaces.",
        "Keep coupling between modules low and cohesion within modules high.",
        "Document public API contracts — changes to interfaces require versioning or migration.",
      ].join("\n"),
    },
    {
      slug: "baseline-structural-self-consistency",
      title: "Structural Self-Consistency",
      category: "architecture",
      ai_instructions: [
        "Every cross-component binding must have both a producer and a consumer.",
        "An emitted event/channel needs a listener; a called route/RPC needs a handler; a referenced env var or config key needs a declaration — and vice versa.",
        "Orphan bindings (one side missing) are broken wires: an event nobody hears, a subscription that never fires, a route nobody calls.",
        "Catch drift with a deterministic check, not review attention — surface orphans as findings with both sides' locations.",
      ].join("\n"),
    },
  ],

  git_workflow: [
    {
      slug: "baseline-small-commits",
      title: "Small, Focused Commits",
      category: "git_workflow",
      ai_instructions: [
        "Each commit should represent a single logical change.",
        "Write clear commit messages: type(scope): short description.",
        "Avoid mixing unrelated changes in a single commit.",
      ].join("\n"),
    },
    {
      slug: "baseline-review-before-merge",
      title: "Review Before Merge",
      category: "git_workflow",
      ai_instructions: [
        "All code changes should be reviewed before merging to the main branch.",
        "Run the full test suite and build before pushing.",
        "Address review feedback before merging — don't defer fixes to later commits.",
      ].join("\n"),
    },
  ],
};

/**
 * Build an InstructionPayload from universal baseline rules.
 * This is a synthetic payload with no story/ruleset context.
 */
export function buildBaselinePayload(): InstructionPayload {
  const allRules: ExpertRule[] = [];

  for (const category of BASELINE_CATEGORIES) {
    for (const rule of BASELINE_RULES[category]) {
      allRules.push(rule);
    }
  }

  return {
    story: null,
    rules: allRules,
    ruleset: null,
    scope: "baseline",
    payload_version: 1,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Get baseline rules as categorized record (for config-writer fallback).
 */
export function getBaselineRules(): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const category of BASELINE_CATEGORIES) {
    const rules = BASELINE_RULES[category];
    result[category] = rules.map((r) => {
      const lines = (r.ai_instructions || r.summary || "").split("\n").filter(Boolean);
      return `**${r.title}**: ${lines[0] || ""}`;
    });
  }

  return result;
}
