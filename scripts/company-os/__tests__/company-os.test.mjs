/**
 * @module company-os.test (vitest)
 * Units for the AISHA Company OS layer (docs/AISHA_COMPANY_OS.md): preset
 * integrity, manifest validation, deterministic generation, safeWriteSync
 * round-trips, drift check, and the agent_spec marketplace bridge. Runs under
 * the repo's `test:scripts` harness (vitest.scripts.config.mjs).
 */

import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTONOMY_TOOLS,
  emitAgentSpec,
  expectedOnDisk,
  fleetFingerprint,
  generateFleet,
  loadManifest,
  resolveAgent,
  validateManifest,
} from "../lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const CLI = path.join(REPO_ROOT, "scripts", "company-os", "cli.mjs");
const PRESET_PATH = path.join(REPO_ROOT, "config", "company-os", "presets", "one-person-company.json");

const loadPreset = () => loadManifest(PRESET_PATH);

/** Minimal valid manifest for negative tests. */
function tinyManifest(overrides = {}) {
  return {
    version: 1,
    agents: [
      { slug: "content", title: "Content Agent", purpose: "Drafts posts." },
      { slug: "review", title: "Review Agent", purpose: "Ship gate.", role: "review" },
    ],
    ...overrides,
  };
}

describe("one-person-company preset", () => {
  test("is valid and carries the 10 infographic agents", () => {
    const preset = loadPreset();
    const { errors, warnings } = validateManifest(preset);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(preset.agents.map((a) => a.slug)).toEqual([
      "leads", "research", "docs", "ads", "content",
      "sales", "product", "ops", "finance", "review",
    ]);
  });

  test("review agent is the advisory decision-seat gate", () => {
    const preset = loadPreset();
    const reviews = preset.agents.filter((a) => a.role === "review");
    expect(reviews).toHaveLength(1);
    const resolved = resolveAgent(preset, reviews[0]);
    expect(resolved.autonomy).toBe("advisory");
    expect(resolved.tools).toEqual([...AUTONOMY_TOOLS.advisory]);
  });

  test("stays in sync with the JSON schema contract file", () => {
    const schema = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "schemas", "company-os-fleet.schema.json"), "utf-8"),
    );
    // Enum vocabularies referenced throughout the docs must match the lib.
    expect(schema.$defs.slot.enum).toEqual(["spark", "ember", "verify", "default"]);
    expect(schema.$defs.autonomyLevel.enum).toEqual(["advisory", "draft", "execute"]);
    expect(schema.$defs.claudeModel.enum).toEqual(["haiku", "sonnet", "opus", "inherit"]);
  });
});

describe("validateManifest", () => {
  test("rejects duplicate slugs, unknown keys, bad enums", () => {
    const { errors } = validateManifest({
      version: 1,
      surprise: true,
      agents: [
        { slug: "a", title: "A", purpose: "x", slot: "warp" },
        { slug: "a", title: "A2", purpose: "y", autonomy_level: "yolo" },
      ],
    });
    expect(errors.some((e) => e.includes('unknown key "surprise"'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate slug "a"'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown slot "warp"'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown level "yolo"'))).toBe(true);
  });

  test("enforces the decision-seat guarantees", () => {
    const nonAdvisoryReview = tinyManifest();
    nonAdvisoryReview.agents[1].autonomy_level = "execute";
    expect(validateManifest(nonAdvisoryReview).errors.some((e) => e.includes("review agent must stay"))).toBe(true);

    const writingAdvisor = tinyManifest();
    writingAdvisor.agents[0].autonomy_level = "advisory";
    writingAdvisor.agents[0].tools = { claude: ["Read", "Write"] };
    expect(validateManifest(writingAdvisor).errors.some((e) => e.includes("advisory agents are read-only"))).toBe(true);

    const twoReviews = tinyManifest();
    twoReviews.agents[0].role = "review";
    expect(validateManifest(twoReviews).errors.some((e) => e.includes("at most one review agent"))).toBe(true);

    const noReview = tinyManifest();
    noReview.agents[1].role = "worker";
    expect(validateManifest(noReview).warnings.some((w) => w.includes('no agent with role "review"'))).toBe(true);
  });

  test("requires referenced brain files to exist when brainDir is given", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cos-brain-"));
    writeFileSync(path.join(dir, "present.md"), "# ok\n");
    const manifest = tinyManifest();
    manifest.agents[0].brain = ["present.md", "missing.md"];
    const { errors } = validateManifest(manifest, { brainDir: dir });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("missing.md");
  });

  test("rejects malformed mcp tool names", () => {
    const manifest = tinyManifest();
    manifest.agents[0].tools = { mcp: ["hubspot.search"] };
    expect(validateManifest(manifest).errors.some((e) => e.includes("mcp__<server>__<tool>"))).toBe(true);
  });

  test("rejects reserved ritual slugs (ship/weekly) that collide with generated commands", () => {
    for (const reserved of ["ship", "weekly"]) {
      const manifest = tinyManifest();
      manifest.agents[0].slug = reserved;
      const { errors } = validateManifest(manifest);
      expect(errors.some((e) => e.includes(`"${reserved}" is reserved`))).toBe(true);
    }
  });

  test("advisory agents may not carry MCP tools (unverifiable read-only)", () => {
    const manifest = tinyManifest();
    manifest.agents[0].autonomy_level = "advisory";
    manifest.agents[0].tools = { mcp: ["mcp__slack__send_message"] };
    expect(validateManifest(manifest).errors.some((e) => e.includes("MCP write-capability cannot be verified"))).toBe(true);

    // The forced-advisory review agent is covered too.
    const reviewMcp = tinyManifest();
    reviewMcp.agents[1].tools = { mcp: ["mcp__slack__send_message"] };
    expect(validateManifest(reviewMcp).errors.some((e) => e.includes("advisory agents are read-only"))).toBe(true);

    // A draft/execute agent may carry MCP tools.
    const drafting = tinyManifest();
    drafting.agents[0].tools = { mcp: ["mcp__hubspot__search_contacts"] };
    expect(validateManifest(drafting).errors).toEqual([]);
  });

  test("type-validates platform passthrough fields against the schema shape", () => {
    const badArray = tinyManifest();
    badArray.agents[0].platform = { rule_slugs: "not-an-array" };
    expect(validateManifest(badArray).errors.some((e) => e.includes("platform.rule_slugs"))).toBe(true);

    const badString = tinyManifest();
    badString.agents[0].platform = { default_model: 42 };
    expect(validateManifest(badString).errors.some((e) => e.includes("platform.default_model: must be a string"))).toBe(true);

    const good = tinyManifest();
    good.agents[0].platform = { rule_slugs: ["core-laws"], knowledge_items: ["kb-1"], default_model: "balanced" };
    expect(validateManifest(good).errors).toEqual([]);
  });
});

describe("generateFleet", () => {
  test("emits agents + commands + rituals + agent map, deterministically", () => {
    const preset = loadPreset();
    const first = generateFleet(preset);
    const second = generateFleet(preset);
    expect(first).toEqual(second); // no timestamps, pure content

    const paths = first.files.map((f) => f.path);
    // 10 agents + 10 commands + os-ship + os-weekly + agent-map
    expect(paths).toHaveLength(23);
    expect(paths).toContain(".claude/agents/os-leads.md");
    expect(paths).toContain(".claude/commands/os-review.md");
    expect(paths).toContain(".claude/commands/os-ship.md");
    expect(paths).toContain(".claude/commands/os-weekly.md");
    expect(paths).toContain("company-os/agent-map.md");
  });

  test("frontmatter carries slot-mapped model and autonomy-derived tools", () => {
    const preset = loadPreset();
    const { files } = generateFleet(preset);
    const byPath = new Map(files.map((f) => [f.path, f.content]));

    const ops = byPath.get(".claude/agents/os-ops.md"); // spark + draft
    expect(ops).toMatch(/^model: haiku$/m);
    expect(ops).toMatch(/^tools: Read, Grep, Glob, Write, Edit, WebSearch, WebFetch$/m);

    const review = byPath.get(".claude/agents/os-review.md"); // verify + advisory
    expect(review).toMatch(/^model: opus$/m);
    expect(review).toMatch(/^tools: Read, Grep, Glob$/m);
    expect(review).toContain("Review doctrine");

    // Every generated file is machine-owned + user-section aware.
    for (const [, content] of byPath) {
      expect(content).toContain("Auto-generated from AISHA Expert Overlay ruleset.");
      expect(content).toContain("company-os/fleet.json (AISHA Company OS)");
      expect(content).toContain("<!-- aisha:user-section:start -->");
    }
  });

  test("appends mcp tools and honors custom slot_models + prefix", () => {
    const manifest = tinyManifest({
      prefix: "biz",
      slot_models: { ember: "opus" },
      defaults: { slot: "ember" },
    });
    manifest.agents[0].tools = { claude: ["Read"], mcp: ["mcp__hubspot__search_contacts"] };
    const { files } = generateFleet(manifest);
    const agent = files.find((f) => f.path === ".claude/agents/biz-content.md").content;
    expect(agent).toMatch(/^tools: Read, mcp__hubspot__search_contacts$/m);
    expect(agent).toMatch(/^model: opus$/m);
    expect(files.some((f) => f.path === ".claude/commands/biz-ship.md")).toBe(true);
  });

  test("agent map lists every agent with its command", () => {
    const preset = loadPreset();
    const map = generateFleet(preset).files.find((f) => f.path === "company-os/agent-map.md").content;
    for (const agent of preset.agents) {
      expect(map).toContain(`\`/os-${agent.slug}\``);
    }
    expect(map).toContain("The fleet executes.");
  });

  test("skips the ship gate when no review agent exists", () => {
    const manifest = tinyManifest();
    manifest.agents[1].role = "worker";
    const { files } = generateFleet(manifest);
    expect(files.some((f) => f.path.endsWith("-ship.md"))).toBe(false);
  });

  test("throws loudly on a duplicate output path (defense-in-depth for reserved slugs)", () => {
    // generateFleet does not re-validate; a slug that collides with a ritual
    // command must fail loud rather than silently overwrite.
    const manifest = tinyManifest();
    manifest.agents[0].slug = "weekly";
    expect(() => generateFleet(manifest)).toThrow(/duplicate output path/);
  });
});

describe("expectedOnDisk", () => {
  test("keeps a non-empty user section from disk", () => {
    const generated = generateFleet(tinyManifest()).files[0].content;
    const onDisk = generated.replace(
      /<!-- aisha:user-section:start -->[\s\S]*?<!-- aisha:user-section:end -->/,
      "<!-- aisha:user-section:start -->\nMY NOTES\n<!-- aisha:user-section:end -->",
    );
    expect(expectedOnDisk(generated, onDisk)).toContain("MY NOTES");
    expect(expectedOnDisk(generated, null)).toBe(generated);
  });
});

describe("emitAgentSpec", () => {
  test("maps a fleet agent to a plugin_catalog.agent_spec draft", () => {
    const preset = loadPreset();
    const spec = emitAgentSpec(preset, "leads");
    expect(spec).toEqual({
      purpose: "Finds leads, buyers, and partnership targets.",
      default_model: "balanced",
      model_overrides: { company_os_slot: "ember" },
      allowed_tools: ["Read", "Grep", "Glob", "Write", "Edit", "WebSearch", "WebFetch"],
      denied_tools: [],
      context_profile: "repo_plus_rules",
      max_loops: 3,
      safety_level: "standard",
      autonomy_level: "semi",
      rule_slugs: [],
      knowledge_items: [],
    });
  });

  test("respects platform passthrough and execute → auto mapping", () => {
    const manifest = tinyManifest();
    manifest.agents[0].autonomy_level = "execute";
    manifest.agents[0].platform = { default_model: "maxQuality", max_loops: 5, rule_slugs: ["core-laws"] };
    const spec = emitAgentSpec(manifest, "content");
    expect(spec.default_model).toBe("maxQuality");
    expect(spec.max_loops).toBe(5);
    expect(spec.autonomy_level).toBe("auto");
    expect(spec.rule_slugs).toEqual(["core-laws"]);
    expect(() => emitAgentSpec(manifest, "nope")).toThrow(/No agent with slug/);
  });
});

describe("cli end-to-end (sandboxed via AISHA_COMPANY_OS_ROOT)", () => {
  const runCli = (root, args, opts = {}) =>
    execFileSync(process.execPath, [CLI, ...args], {
      env: { ...process.env, AISHA_COMPANY_OS_ROOT: root },
      encoding: "utf-8",
      ...opts,
    });

  test("init → gen → check round-trip, regen preserves user section", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cos-e2e-"));

    const initOut = runCli(root, ["init"]);
    expect(initOut).toContain("write  company-os/fleet.json");
    expect(existsSync(path.join(root, "company-os/brain/who-i-am.md"))).toBe(true);

    // Second init never touches existing files.
    expect(runCli(root, ["init"])).toContain("skip   company-os/fleet.json");

    const genOut = runCli(root, ["gen"]);
    expect(genOut).toMatch(/written\s+\.claude\/agents\/os-leads\.md/);
    expect(runCli(root, ["check"])).toContain("in sync");

    // A user edit inside the user section survives regeneration…
    const agentPath = path.join(root, ".claude/agents/os-leads.md");
    writeFileSync(
      agentPath,
      readFileSync(agentPath, "utf-8").replace(
        /<!-- aisha:user-section:start -->[\s\S]*?<!-- aisha:user-section:end -->/,
        "<!-- aisha:user-section:start -->\nAlways check the CRM first.\n<!-- aisha:user-section:end -->",
      ),
    );
    expect(runCli(root, ["check"])).toContain("in sync"); // user section is not drift
    runCli(root, ["gen"]);
    expect(readFileSync(agentPath, "utf-8")).toContain("Always check the CRM first.");

    // …while an edit outside it is drift.
    writeFileSync(agentPath, readFileSync(agentPath, "utf-8").replace("## Output contract", "## Tampered"));
    expect(() => runCli(root, ["check"], { stdio: "pipe" })).toThrow(/drifted|stale/);
  });

  test("check is a no-op success without an instance", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cos-noop-"));
    expect(runCli(root, ["check"])).toContain("nothing to check");
  });

  test("gen fails loudly on an invalid manifest", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "cos-invalid-"));
    runCli(root, ["init"]);
    const fleetPath = path.join(root, "company-os/fleet.json");
    const fleet = JSON.parse(readFileSync(fleetPath, "utf-8"));
    fleet.agents.push({ slug: "leads", title: "Dup", purpose: "dup" });
    writeFileSync(fleetPath, JSON.stringify(fleet, null, 2));
    expect(() => runCli(root, ["gen"], { stdio: "pipe" })).toThrow(/failed validation/);
  });
});

describe("repo instance drift gate", () => {
  // Same convention as the claude-app adapter drift gate in this harness: when
  // this repo carries a committed Company OS instance, the generated .claude
  // artifacts must stay in lock-step with their SoT (company-os/fleet.json).
  // Fails → run `npm run gen:company-os` and commit. Skips silently in
  // checkouts without an instance.
  const fleetPath = path.join(REPO_ROOT, "company-os", "fleet.json");
  test.skipIf(!existsSync(fleetPath))("committed artifacts match company-os/fleet.json", () => {
    const manifest = loadManifest(fleetPath);
    const { errors } = validateManifest(manifest, {
      brainDir: path.join(REPO_ROOT, "company-os", "brain"),
    });
    expect(errors).toEqual([]);

    const drifted = [];
    for (const file of generateFleet(manifest).files) {
      const abs = path.join(REPO_ROOT, file.path);
      if (!existsSync(abs)) {
        drifted.push(`${file.path} (missing)`);
        continue;
      }
      const existing = readFileSync(abs, "utf-8");
      if (existing !== expectedOnDisk(file.content, existing)) {
        drifted.push(`${file.path} (stale)`);
      }
    }
    expect(drifted, "run `npm run gen:company-os` and commit the result").toEqual([]);
  });
});

describe("fingerprint", () => {
  test("is stable for identical manifests and changes on edits", () => {
    const a = tinyManifest();
    const b = tinyManifest();
    expect(fleetFingerprint(a)).toBe(fleetFingerprint(b));
    b.agents[0].purpose = "Something else.";
    expect(fleetFingerprint(a)).not.toBe(fleetFingerprint(b));
  });

  test("is invariant to object key order (canonicalized) so a reformat does not drift artifacts", () => {
    const ordered = { version: 1, prefix: "os", agents: [{ slug: "content", title: "C", purpose: "p" }] };
    const reordered = { agents: [{ purpose: "p", slug: "content", title: "C" }], prefix: "os", version: 1 };
    expect(fleetFingerprint(ordered)).toBe(fleetFingerprint(reordered));
  });
});
