/**
 * Extension Participant — Unit tests for intent detection and routing logic.
 *
 * Tests detectIntent(), parseCheckTypes(), and command routing from
 * extensions/aisha-dirigent/src/participant.ts.
 *
 * Uses extracted logic pattern to avoid vscode module dependency.
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AishaIntent =
  | "code_review"
  | "test_strategy"
  | "compliance"
  | "debug"
  | "knowledge"
  | "estimate"
  | "delivery"
  | "general";

interface MinimalWorkspaceContext {
  diagnosticSummary: string | null;
  activeSelection: string | null;
}

// ---------------------------------------------------------------------------
// Extracted pure functions from participant.ts
// ---------------------------------------------------------------------------

function detectIntent(prompt: string, ctx: MinimalWorkspaceContext): AishaIntent {
  const p = prompt.toLowerCase();

  // Error/debug signals
  if (
    ctx.diagnosticSummary ||
    /\b(error|bug|chyb|nefunguje|fails?|broken|debug|fix)\b/.test(p)
  ) {
    return "debug";
  }
  // Test signals
  if (/\b(test|testy?|coverage|vitest|spec|mock)\b/.test(p)) {
    return "test_strategy";
  }
  // Compliance / PR signals
  if (/\b(compliance|pr|pull.?request|review|gate|lint|audit)\b/.test(p)) {
    return "compliance";
  }
  // Delivery / story signals
  if (/\b(deliver|deploy|release|story|sprint|status|ship)\b/.test(p)) {
    return "delivery";
  }
  // Estimate signals
  if (/\b(estimat|odhad|effort|complex|story.?point|jak.?dlouho|how.?long)\b/.test(p)) {
    return "estimate";
  }
  // Knowledge signals
  if (/\b(jak|how|what|where|kde|proč|why|explain|docs?|dokumentac|architektur|pattern)\b/.test(p)) {
    return "knowledge";
  }
  // Code review — if user has code selected or is talking about a file
  if (ctx.activeSelection || /\b(quality|kvalit|refactor|clean|code)\b/.test(p)) {
    return "code_review";
  }

  return "general";
}

function parseCheckTypes(prompt: string): string[] {
  const known = [
    "rpc_pattern",
    "security",
    "types",
    "i18n",
    "error_handling",
    "testing",
    "performance",
    "accessibility",
  ];
  const found = known.filter(
    (t) =>
      prompt.toLowerCase().includes(t.replace("_", " ")) ||
      prompt.toLowerCase().includes(t),
  );

  return found.length > 0
    ? found
    : ["rpc_pattern", "security", "types", "error_handling"];
}

// ---------------------------------------------------------------------------
// Source parity
// ---------------------------------------------------------------------------

describe("Source parity", () => {
  const sourcePath = path.resolve(
    __dirname,
    "../../../extensions/aisha-dirigent/src/participant.ts",
  );
  const source = fs.readFileSync(sourcePath, "utf-8");

  it("detectIntent return type matches source AishaIntent", () => {
    const intents: AishaIntent[] = [
      "code_review",
      "test_strategy",
      "compliance",
      "debug",
      "knowledge",
      "estimate",
      "delivery",
      "general",
    ];
    for (const intent of intents) {
      expect(source).toContain(`"${intent}"`);
    }
  });

  it("parseCheckTypes known list matches source", () => {
    const known = [
      "rpc_pattern",
      "security",
      "types",
      "i18n",
      "error_handling",
      "testing",
      "performance",
      "accessibility",
    ];
    for (const k of known) {
      expect(source).toContain(`"${k}"`);
    }
  });

  it("COMMAND_HANDLERS exists in source", () => {
    expect(source).toContain("COMMAND_HANDLERS");
  });
});

// ---------------------------------------------------------------------------
// detectIntent tests
// ---------------------------------------------------------------------------

describe("detectIntent", () => {
  const defaultCtx: MinimalWorkspaceContext = {
    diagnosticSummary: null,
    activeSelection: null,
  };

  describe("debug intent", () => {
    it("detects 'error' keyword", () => {
      expect(detectIntent("I have an error in my code", defaultCtx)).toBe("debug");
    });

    it("detects 'bug' keyword", () => {
      expect(detectIntent("There is a bug", defaultCtx)).toBe("debug");
    });

    it("detects Czech 'chyb' keyword (standalone word boundary)", () => {
      // \b requires word boundary — 'chyb' matches as standalone (genitive plural)
      expect(detectIntent("Mám pět chyb", defaultCtx)).toBe("debug");
    });

    it("detects Czech 'nefunguje' keyword", () => {
      expect(detectIntent("Hook nefunguje správně", defaultCtx)).toBe("debug");
    });

    it("detects 'fails' keyword", () => {
      expect(detectIntent("The test fails", defaultCtx)).toBe("debug");
    });

    it("detects 'broken' keyword", () => {
      expect(detectIntent("Something is broken", defaultCtx)).toBe("debug");
    });

    it("detects 'fix' keyword", () => {
      expect(detectIntent("Please fix this", defaultCtx)).toBe("debug");
    });

    it("triggers on diagnosticSummary presence", () => {
      const ctx: MinimalWorkspaceContext = {
        diagnosticSummary: "3 errors found",
        activeSelection: null,
      };
      expect(detectIntent("Help me with this", ctx)).toBe("debug");
    });

    it("diagnosticSummary overrides other signals", () => {
      const ctx: MinimalWorkspaceContext = {
        diagnosticSummary: "1 error",
        activeSelection: null,
      };
      // Even with test keyword, diagnostic should win (debug is checked first)
      expect(detectIntent("test", ctx)).toBe("debug");
    });
  });

  describe("test_strategy intent", () => {
    it("detects 'test' keyword", () => {
      expect(detectIntent("Write a test for useMyHook", defaultCtx)).toBe("test_strategy");
    });

    it("detects 'testy' (Czech)", () => {
      expect(detectIntent("Potřebuji testy", defaultCtx)).toBe("test_strategy");
    });

    it("detects 'coverage' keyword", () => {
      expect(detectIntent("Check coverage for this module", defaultCtx)).toBe("test_strategy");
    });

    it("detects 'vitest' keyword", () => {
      expect(detectIntent("How do I configure vitest", defaultCtx)).toBe("test_strategy");
    });

    it("detects 'mock' keyword", () => {
      expect(detectIntent("How to mock supabase", defaultCtx)).toBe("test_strategy");
    });
  });

  describe("compliance intent", () => {
    it("detects 'compliance' keyword", () => {
      expect(detectIntent("Run compliance check", defaultCtx)).toBe("compliance");
    });

    it("detects 'PR' keyword", () => {
      expect(detectIntent("Is this ready for PR", defaultCtx)).toBe("compliance");
    });

    it("detects 'pull request' keyword", () => {
      expect(detectIntent("Review my pull request", defaultCtx)).toBe("compliance");
    });

    it("detects 'gate' keyword", () => {
      expect(detectIntent("Do gate tests pass", defaultCtx)).toBe("compliance");
    });

    it("detects 'lint' keyword", () => {
      expect(detectIntent("Run lint on my code", defaultCtx)).toBe("compliance");
    });

    it("detects 'audit' keyword", () => {
      expect(detectIntent("Do a security audit", defaultCtx)).toBe("compliance");
    });
  });

  describe("delivery intent", () => {
    it("detects 'deploy' keyword", () => {
      expect(detectIntent("How to deploy this", defaultCtx)).toBe("delivery");
    });

    it("detects 'release' keyword", () => {
      expect(detectIntent("Prepare for release", defaultCtx)).toBe("delivery");
    });

    it("detects 'story' keyword", () => {
      expect(detectIntent("What is our story status", defaultCtx)).toBe("delivery");
    });

    it("detects 'ship' keyword", () => {
      expect(detectIntent("Let's ship it", defaultCtx)).toBe("delivery");
    });
  });

  describe("estimate intent", () => {
    it("detects 'estimate' keyword", () => {
      expect(detectIntent("Estimate the effort", defaultCtx)).toBe("estimate");
    });

    it("detects Czech 'odhad' keyword", () => {
      expect(detectIntent("Dej mi odhad", defaultCtx)).toBe("estimate");
    });

    it("detects 'effort' keyword", () => {
      expect(detectIntent("What is the effort needed", defaultCtx)).toBe("estimate");
    });

    it("detects Czech 'jak dlouho' keyword", () => {
      expect(detectIntent("Jak dlouho to bude trvat", defaultCtx)).toBe("estimate");
    });

    it("detects 'how long' keyword", () => {
      expect(detectIntent("How long will this take", defaultCtx)).toBe("estimate");
    });
  });

  describe("knowledge intent", () => {
    it("detects 'how' keyword", () => {
      expect(detectIntent("How does RPC work", defaultCtx)).toBe("knowledge");
    });

    it("detects 'what' keyword", () => {
      expect(detectIntent("What is the architecture", defaultCtx)).toBe("knowledge");
    });

    it("detects Czech 'jak' keyword", () => {
      expect(detectIntent("Jak funguje RLS", defaultCtx)).toBe("knowledge");
    });

    it("detects 'explain' keyword", () => {
      // Avoid 'audit' which triggers compliance (higher priority)
      expect(detectIntent("Explain the RPC pattern", defaultCtx)).toBe("knowledge");
    });

    it("detects 'docs' keyword", () => {
      expect(detectIntent("Show me the docs", defaultCtx)).toBe("knowledge");
    });

    it("detects 'pattern' keyword", () => {
      expect(detectIntent("What pattern should I use", defaultCtx)).toBe("knowledge");
    });

    it("detects 'architektur' keyword (Czech standalone genitive plural)", () => {
      // \b requires word boundary — 'architektur' standalone works
      expect(detectIntent("Přehled architektur", defaultCtx)).toBe("knowledge");
    });
  });

  describe("code_review intent", () => {
    it("detects 'quality' keyword", () => {
      expect(detectIntent("Check quality", defaultCtx)).toBe("code_review");
    });

    it("detects 'refactor' keyword", () => {
      expect(detectIntent("Refactor this code", defaultCtx)).toBe("code_review");
    });

    it("triggers when activeSelection is present", () => {
      const ctx: MinimalWorkspaceContext = {
        diagnosticSummary: null,
        activeSelection: "const x = 1;",
      };
      expect(detectIntent("Take a look", ctx)).toBe("code_review");
    });
  });

  describe("general intent (fallback)", () => {
    it("returns general for unrecognized prompts", () => {
      expect(detectIntent("hello there", defaultCtx)).toBe("general");
    });

    it("returns general for empty prompt", () => {
      expect(detectIntent("", defaultCtx)).toBe("general");
    });
  });

  describe("priority ordering", () => {
    it("debug takes priority over test", () => {
      // "fix" triggers debug, "test" triggers test_strategy — debug checked first
      expect(detectIntent("fix the test", defaultCtx)).toBe("debug");
    });

    it("debug takes priority over knowledge", () => {
      expect(detectIntent("how to fix error", defaultCtx)).toBe("debug");
    });

    it("test takes priority over knowledge", () => {
      // "test" triggers test_strategy, "how" triggers knowledge
      expect(detectIntent("test the hook", defaultCtx)).toBe("test_strategy");
    });
  });
});

// ---------------------------------------------------------------------------
// parseCheckTypes tests
// ---------------------------------------------------------------------------

describe("parseCheckTypes", () => {
  it("returns default checks for empty prompt", () => {
    expect(parseCheckTypes("")).toEqual([
      "rpc_pattern",
      "security",
      "types",
      "error_handling",
    ]);
  });

  it("returns default checks for unrecognized prompt", () => {
    expect(parseCheckTypes("just do the thing")).toEqual([
      "rpc_pattern",
      "security",
      "types",
      "error_handling",
    ]);
  });

  it("detects 'security' check type", () => {
    expect(parseCheckTypes("check security")).toContain("security");
  });

  it("detects 'rpc pattern' (with space replacing underscore)", () => {
    expect(parseCheckTypes("check rpc pattern")).toContain("rpc_pattern");
  });

  it("detects 'rpc_pattern' (with underscore)", () => {
    expect(parseCheckTypes("check rpc_pattern")).toContain("rpc_pattern");
  });

  it("detects 'i18n' check type", () => {
    expect(parseCheckTypes("check i18n translations")).toContain("i18n");
  });

  it("detects multiple check types", () => {
    const result = parseCheckTypes("rpc pattern and security and i18n");
    expect(result).toContain("rpc_pattern");
    expect(result).toContain("security");
    expect(result).toContain("i18n");
  });

  it("detects 'error handling' (with space)", () => {
    expect(parseCheckTypes("check error handling")).toContain("error_handling");
  });

  it("detects 'testing' check type", () => {
    expect(parseCheckTypes("check testing coverage")).toContain("testing");
  });

  it("detects 'performance' check type", () => {
    expect(parseCheckTypes("check performance issues")).toContain("performance");
  });

  it("detects 'accessibility' check type", () => {
    expect(parseCheckTypes("check accessibility a11y")).toContain("accessibility");
  });

  it("is case insensitive", () => {
    expect(parseCheckTypes("Check SECURITY and TYPES")).toContain("security");
    expect(parseCheckTypes("Check SECURITY and TYPES")).toContain("types");
  });
});
