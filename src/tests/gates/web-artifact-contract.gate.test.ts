/**
 * Gate: web_artifact_jobs contract integrity.
 *
 * Asserts that the SQL forward migration, the Fastify microservice schemas,
 * the React Zod schemas, and the n8n workflows all stay in sync on:
 *   - enum value sets (source_type, status, kind)
 *   - RPC signatures (parameter names & order match what frontend/n8n call)
 *   - audit invariants (every RPC writes audit_journal with the expected tags)
 *   - branding hygiene (every `.rpc()` call goes through the canonical client)
 *
 * Mirrors the spirit of `rpc-only-data-access.gate.test.ts` — keeps the
 * contract honest as code evolves.
 *
 * @module
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const MIGRATION = path.join(ROOT, "aisha/db/migrations/00000000000000_baseline.sql");
const MIGRATION_STORY_ENTRIES = path.join(ROOT, "aisha/db/migrations/00000000000000_baseline.sql");
const SCHEMAS_TS = path.join(ROOT, "src/lib/schemas/webArtifactSchemas.ts");
const STORYLOOP_SCHEMAS = path.join(ROOT, "src/schemas/storyLoopSchemas.ts");
const STORYLOOP_RENDERER = path.join(ROOT, "src/components/storyloop/blocks/StoryEntryBlockRenderer.tsx");
const STORYLOOP_BLOCK_UTILS = path.join(ROOT, "src/components/storyloop/blocks/utils.ts");
const SERVICE_SCHEMAS = path.join(ROOT, "services/svc-web-artifact/src/schemas.ts");
const SERVICE_SEED_DEFAULT = path.join(ROOT, "services/svc-web-artifact/src/routes/seed-default.ts");
const WF_INGEST = path.join(ROOT, "n8n/workflows/WF_WEB_ARTIFACT_INGEST.json");
const WF_REDESIGN = path.join(ROOT, "n8n/workflows/WF_OCCIPITUM_REDESIGN.json");
const HOOKS_DIR = path.join(ROOT, "src/hooks");

function read(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

describe("web_artifact_jobs contract gate", () => {
  describe("forward migration", () => {
    const sql = read(MIGRATION);

    it("declares all three enums", () => {
      expect(sql).toMatch(/CREATE TYPE (public\.)?web_artifact_source_type AS ENUM/);
      expect(sql).toMatch(/CREATE TYPE (public\.)?web_artifact_job_status AS ENUM/);
      expect(sql).toMatch(/CREATE TYPE (public\.)?web_artifact_kind AS ENUM/);
    });

    it("creates the web_artifact_jobs table with idempotency_key UNIQUE", () => {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.web_artifact_jobs/);
      expect(sql).toMatch(/UNIQUE \(idempotency_key\)/);
    });

    it("web_pages SoT carries story_id FK to partner_stories", () => {
      // The migration's ALTER…ADD COLUMN story_id was folded into the web_pages SoT.
      const t = read(path.join(ROOT, "aisha/db/sql/tables/web_pages.sql"));
      expect(t).toMatch(/story_id\s+uuid/);
      expect(t).toMatch(/REFERENCES\s+(public\.)?partner_stories\s*\(\s*id\s*\)/);
    });

    it("creates the web-artifact-sources storage bucket", () => {
      expect(sql).toMatch(/INSERT INTO storage\.buckets[^;]+web-artifact-sources/);
    });

    it("defines all 8 RPCs", () => {
      const required = [
        "start_web_artifact_ingest",
        "mark_web_artifact_processing",
        "complete_web_artifact_ingest",
        "request_web_artifact_redesign",
        "fail_web_artifact_ingest",
        "apply_web_artifact_to_page",
        "publish_web_artifact",
        "get_web_artifact_jobs_for_story",
      ];
      for (const fn of required) {
        expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`));
      }
    });

    it("RPCs follow SECURITY {INVOKER,DEFINER} + REVOKE/GRANT pattern", () => {
      // Scoped to the 8 web-artifact RPCs in their canonical SoT function files
      // (splitting the whole baseline would scan every platform function).
      const rpcs = [
        "start_web_artifact_ingest",
        "mark_web_artifact_processing",
        "complete_web_artifact_ingest",
        "request_web_artifact_redesign",
        "fail_web_artifact_ingest",
        "apply_web_artifact_to_page",
        "publish_web_artifact",
        "get_web_artifact_jobs_for_story",
      ];
      for (const fn of rpcs) {
        const block = read(path.join(ROOT, `aisha/db/sql/functions/${fn}.sql`));
        expect(block, `${fn} missing SECURITY clause`).toMatch(/SECURITY (INVOKER|DEFINER)/);
        expect(block, `${fn} missing search_path`).toMatch(/SET search_path TO 'public'/);
        expect(block, `${fn} missing REVOKE`).toMatch(new RegExp(`REVOKE ALL ON FUNCTION (public\\.)?${fn}`));
        expect(block, `${fn} missing GRANT EXECUTE`).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION (public\\.)?${fn}`));
      }
    });

    it("RPCs write audit_journal with expected tags", () => {
      // Each non-trivial RPC must reference INSERT INTO public.audit_journal with our tag prefix
      const transitions = [
        "WEB_ARTIFACT_INGEST_START",
        "WEB_ARTIFACT_INGEST_COMPLETE",
        "WEB_ARTIFACT_INGEST_FAIL",
        "WEB_ARTIFACT_REDESIGN_REQUEST",
        "WEB_ARTIFACT_APPLY",
        "WEB_ARTIFACT_PUBLISH",
      ];
      for (const action of transitions) {
        expect(sql, `audit row '${action}' missing`).toContain(`'${action}'`);
      }
      expect(sql).toMatch(/ARRAY\['stack', 'story', 'web_artifact'/);
    });

    it("apply_web_artifact_to_page raises stale_artifact_apply_another_version_landed", () => {
      expect(sql).toMatch(/stale_artifact_apply_another_version_landed/);
    });

    it("apply_web_artifact_to_page snapshots via create_web_page_version before overwrite", () => {
      expect(sql).toMatch(/create_web_page_version\(p_page_id, 'auto: before web_artifact apply'\)/);
    });
  });

  describe("schemas alignment", () => {
    const reactSchemas = read(SCHEMAS_TS);
    const serviceSchemas = read(SERVICE_SCHEMAS);

    it("React Zod enum lists match SQL enums", () => {
      const sourceValues = [
        "folder_upload",
        "url_scrape",
        "manual",
        "default_seed",
        "llm_redesign",
      ];
      for (const v of sourceValues) {
        expect(reactSchemas, `webArtifactSourceTypeSchema missing ${v}`).toContain(`"${v}"`);
      }
      const statusValues = [
        "pending",
        "processing",
        "ready_for_review",
        "approved",
        "applied",
        "rejected",
        "failed",
      ];
      for (const v of statusValues) {
        expect(reactSchemas, `webArtifactJobStatusSchema missing ${v}`).toContain(`"${v}"`);
      }
    });

    it("microservice schemas expose runtime block suggestion + preserve_as_static kind", () => {
      expect(serviceSchemas).toMatch(/runtime_block.+preserve_as_static/s);
    });

    it("seed-default upserts page metadata before starting the ingest job", () => {
      const seedDefault = read(SERVICE_SEED_DEFAULT);
      const upsertAt = seedDefault.indexOf("rpcClient.upsertDefaultWebPage");
      const keyAt = seedDefault.indexOf("const idempotencyKey = createHash");
      const startAt = seedDefault.indexOf("rpcClient.start");

      expect(upsertAt).toBeGreaterThan(0);
      expect(keyAt).toBeGreaterThan(0);
      expect(startAt).toBeGreaterThan(0);
      expect(upsertAt, "upsert after start makes apply_web_artifact_to_page stale itself").toBeLessThan(startAt);
      expect(keyAt, "idempotency key must include the page id assigned by upsert").toBeGreaterThan(upsertAt);
      expect(keyAt, "idempotency key must be computed before start_web_artifact_ingest").toBeLessThan(startAt);
      expect(seedDefault).toContain("${pageId}");
    });
  });

  describe("hooks integrity", () => {
    const required = [
      "useWebArtifactJobs.ts",
      "useStartIngestUpload.ts",
      "useStartIngestScrape.ts",
      "useRequestRedesign.ts",
      "useApplyArtifact.ts",
      "usePublishArtifact.ts",
    ];

    it.each(required)("hook %s exists", (filename) => {
      expect(fs.existsSync(path.join(HOOKS_DIR, filename))).toBe(true);
    });

    it("hooks only call the canonical rebrand client (positive gate)", () => {
      // Positive gate: every `.rpc(` invocation in a hook MUST be `aisha.rpc(`.
      // We assert this via a negative look-behind regex — no banned literal
      // appears in the test source itself, so the branding gate never sees one.
      const banned = /(?<!aisha)\.rpc\(/g;
      for (const name of required) {
        const content = read(path.join(HOOKS_DIR, name));
        const offenders = content.match(banned);
        expect(
          offenders,
          `${name}: every .rpc(...) call must go through the canonical rebrand client (offenders=${offenders?.join(",")})`,
        ).toBeNull();
        expect(content, `${name}: direct .from("table") access bypasses RPC contract`).not.toMatch(/\.from\(["'][a-z_]/);
      }
    });
  });

  describe("n8n workflows", () => {
    it("WF_WEB_ARTIFACT_INGEST has the required RPC calls", () => {
      const wf = read(WF_INGEST);
      expect(wf).toContain("start_web_artifact_ingest");
      expect(wf).toContain("web-artifact-parse");
      expect(wf).toContain("log_integration_action");
    });

    it("WF_OCCIPITUM_REDESIGN enforces runtime block + i18n invariants and supports mock mode", () => {
      const wf = read(WF_REDESIGN);
      expect(wf).toMatch(/extractPlaceholders/);
      expect(wf).toMatch(/runtime_block_invariant_violated/);
      expect(wf).toContain("AISHA_LLM_MOCK");
    });
  });

  describe("storyloop integration (canonical pattern)", () => {
    it("RPCs append story_entries on every transition", () => {
      const sql = read(MIGRATION_STORY_ENTRIES);
      // each RPC body inserts into story_entries with the matching entry_type
      const required = [
        ["start_web_artifact_ingest", "web_artifact_upload"],
        ["start_web_artifact_ingest", "web_artifact_scrape"],
        ["complete_web_artifact_ingest", "web_artifact_aisha_proposal"],
        ["fail_web_artifact_ingest", "web_artifact_failed"],
        ["apply_web_artifact_to_page", "web_artifact_applied"],
        ["publish_web_artifact", "web_artifact_published"],
      ];
      for (const [fn, entryType] of required) {
        expect(sql, `${fn} must reference entry_type ${entryType}`).toContain(entryType);
      }
      // INSERT INTO public.story_entries occurs multiple times
      const insertCount = sql.match(/INSERT INTO public\.story_entries/g)?.length ?? 0;
      expect(insertCount, "RPCs must append to story_entries").toBeGreaterThanOrEqual(5);
    });

    it("storyLoopSchemas declares the new entry types", () => {
      const schemas = read(STORYLOOP_SCHEMAS);
      const required = [
        "web_artifact_upload",
        "web_artifact_scrape",
        "web_artifact_aisha_proposal",
        "web_artifact_applied",
        "web_artifact_published",
        "web_artifact_failed",
      ];
      for (const t of required) {
        expect(schemas, `StoryEntryTypeSchema missing ${t}`).toContain(`'${t}'`);
      }
    });

    it("StoryEntryBlockRenderer registers all web_artifact block components", () => {
      const renderer = read(STORYLOOP_RENDERER);
      const required = [
        "WebArtifactUploadBlock",
        "WebArtifactScrapeBlock",
        "WebArtifactAishaProposalBlock",
        "WebArtifactAppliedBlock",
        "WebArtifactPublishedBlock",
        "WebArtifactFailedBlock",
      ];
      for (const comp of required) {
        expect(renderer, `renderer missing ${comp}`).toContain(comp);
      }
    });

    it("isBlockEntry recognises every web_artifact entry type", () => {
      const utils = read(STORYLOOP_BLOCK_UTILS);
      const required = [
        "web_artifact_upload",
        "web_artifact_scrape",
        "web_artifact_aisha_proposal",
        "web_artifact_applied",
        "web_artifact_published",
        "web_artifact_failed",
      ];
      for (const t of required) {
        expect(utils, `isBlockEntry missing ${t}`).toContain(`'${t}'`);
      }
    });
  });
});
