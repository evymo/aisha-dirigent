/**
 * Polymorphic Discussion Gate
 *
 * story_entries was bound to partner_stories; this generalizes it to a
 * POLYMORPHIC (subject_type, subject_id) node so ANY content node — story,
 * news_article, web_page, knowledge_topic, event — hosts the same threaded,
 * moderated, audited discussion via create_discussion_entry_audited + a
 * template-driven entry-type registry. knowledge_posts is left to coexist. This
 * gate locks the contract: the polymorphic columns, the generic post RPC's
 * security + per-type subject validation, the conservative read path, and the
 * GrapesJS block wiring (registry == detector == docstring).
 *
 * Run: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");

const STORY_ENTRIES = read("aisha/db/sql/tables/story_entries.sql");
const RPC = read("aisha/db/sql/functions/create_discussion_entry_audited.sql");
const POLICY = read("aisha/db/sql/policies/story_entries__public_discussion_read.sql");
const REGISTRY = read("aisha/db/sql/tables/entry_type_definitions.sql");
const GET_DISC = read("aisha/db/sql/functions/get_discussion_entries.sql");
const GET_TYPES = read("aisha/db/sql/functions/get_entry_types.sql");
const BASELINE = read("aisha/db/migrations/00000000000000_baseline.sql");
const SEED_COMPILED = read("aisha/db/seed.compiled.sql");
const REG = read("src/lib/builder/runtimeBlockRegistry.ts");
const DETECTOR = read("services/svc-web-artifact/src/lib/runtimeBlockDetector.ts");
const BLOCKDEF = read("src/lib/builder/blockRegistry.runtime-blocks.ts");

describe("story_entries is a polymorphic discussion node", () => {
  it("carries the polymorphic subject binding + moderation state", () => {
    expect(STORY_ENTRIES).toMatch(/subject_type\s+text\s+NOT NULL/);
    expect(STORY_ENTRIES).toMatch(/subject_id\s+uuid\s+NOT NULL/);
    expect(STORY_ENTRIES).toMatch(/status\s+text\s+NOT NULL DEFAULT 'visible'/);
    expect(STORY_ENTRIES).toMatch(/moderation_reason\s+text/);
    expect(STORY_ENTRIES).toMatch(/status IN \('visible','hidden','flagged','deleted'\)/);
    // Index lives in its own SoT file (sql-source-separation convention), so assert it
    // in the generated baseline (the deployed schema) rather than inline in the table.
    expect(BASELINE).toMatch(/idx_story_entries_subject ON story_entries \(subject_type, subject_id\)/);
    expect(STORY_ENTRIES).toMatch(/parent_id uuid/); // threading preserved
    // story_id must be optional now (legacy), not NOT NULL — else non-story
    // subjects (articles) couldn't host discussion.
    expect(STORY_ENTRIES).not.toMatch(/story_id uuid NOT NULL/);
  });
});

describe("create_discussion_entry_audited is a secure generic post RPC", () => {
  it("audited security shape (DEFINER + REVOKE/GRANT + auth + audit)", () => {
    expect(RPC).toMatch(/CREATE OR REPLACE FUNCTION public\.create_discussion_entry_audited/);
    expect(RPC).toMatch(/SECURITY DEFINER/);
    expect(RPC).toMatch(/auth\.uid\(\)/);
    expect(RPC).toMatch(/REVOKE ALL ON FUNCTION public\.create_discussion_entry_audited[\s\S]*?FROM PUBLIC/);
    expect(RPC).toMatch(/GRANT EXECUTE[\s\S]*?TO authenticated/);
    expect(RPC).toMatch(/audit_journal/);
  });
  it("validates the subject per type + threads under the SAME subject + checks the registry", () => {
    expect(RPC).toMatch(/news_articles\s+WHERE id = p_subject_id AND is_published/);
    // draft web_pages are admin-only — a member must not comment on an unpublished page.
    expect(RPC).toMatch(/web_pages\s+WHERE id = p_subject_id AND status = 'published'/);
    expect(RPC).toMatch(/Unsupported subject_type/);
    expect(RPC).toMatch(/subject_type = p_subject_type AND subject_id = p_subject_id/);
    expect(RPC).toMatch(/entry_type_definitions d/);
    expect(RPC).toMatch(/Unknown or inapplicable entry_type/);
  });
});

describe("conservative read path + template-driven registry", () => {
  it("the read policy exposes ONLY public content (never member-private stories)", () => {
    expect(POLICY).toMatch(/CREATE POLICY "story_entries_public_discussion_read"/);
    expect(POLICY).toMatch(/subject_type IN \('news_article', 'web_page'\)/);
    expect(POLICY).toMatch(/is_internal = false/);
    expect(POLICY).toMatch(/AS PERMISSIVE FOR SELECT TO authenticated/);
  });
  it("the registry is the template/catalog for post types", () => {
    expect(REGISTRY).toMatch(/CREATE TABLE IF NOT EXISTS entry_type_definitions/);
    expect(REGISTRY).toMatch(/applies_to\s+text\[\]/);
    expect(REGISTRY).toMatch(/render_block\s+text/);
  });
  it("the compiled demo seed POPULATES the registry (else every entry_type is rejected)", () => {
    // entry_type_definitions is the template/catalog; an EMPTY registry makes
    // create_discussion_entry_audited reject every entry_type with "Unknown or
    // inapplicable entry_type". prod recompiles the seed at deploy, but the committed
    // seed.compiled.sql must NOT go stale — CI/throwaway/upgrade paths use it verbatim.
    // Guards the #516 regression where core/36_discussion_entry_types.sql was added to
    // the seed tree but seed.compiled.sql was never regenerated.
    expect(SEED_COMPILED).toMatch(/INSERT INTO public\.entry_type_definitions/);
    expect(SEED_COMPILED).toMatch(/'comment'/);
    expect(SEED_COMPILED).toMatch(/'question'/);
  });
  it("get_discussion_entries + get_entry_types are secure DEFINER reads", () => {
    expect(GET_DISC).toMatch(/SECURITY DEFINER/);
    expect(GET_DISC).toMatch(/status\s*=\s*'visible'/);
    expect(GET_DISC).toMatch(/is_internal\s*=\s*false/);
    // the public read surface must not expose a DRAFT web_page's thread.
    expect(GET_DISC).toMatch(/web_pages wp\s+WHERE wp\.id = p_subject_id AND wp\.status = 'published'/);
    expect(GET_TYPES).toMatch(/SECURITY DEFINER/);
    expect(GET_TYPES).toMatch(/REVOKE ALL ON FUNCTION public\.get_entry_types/);
  });
  it("baseline: the generalization (RPC + policy + columns + registry) is folded in", () => {
    expect(BASELINE).toContain("create_discussion_entry_audited");
    expect(BASELINE).toContain("story_entries_public_discussion_read");
    expect(BASELINE).toContain("entry_type_definitions");
    expect(BASELINE).toMatch(/subject_type/);
  });
});

describe("discussion renders as a GrapesJS runtime block (registry == detector == docstring)", () => {
  it("registered in the runtime-block registry, the detector KNOWN_BLOCKS + docstring, and the editor", () => {
    expect(REG).toMatch(/"discussion-thread"/);
    expect(REG).toMatch(/DiscussionThreadBlock/);
    expect(DETECTOR).toMatch(/'discussion-thread'/); // KNOWN_BLOCKS
    expect(DETECTOR).toMatch(/discussion-thread/);    // docstring
    expect(BLOCKDEF).toMatch(/blockType: "discussion-thread"/);
  });
});
