/**
 * Gate: chat_messages.ai_run_id surfacing via JSONB (Step 2 systemic
 * follow-up — AISHA capability-applied, no new column).
 *
 * Verifies the full propagation chain for FaithfulnessChip + CitationPanel
 * to resolve on BOTH live (mutation onSuccess) and history loads:
 *
 *   1. orchestrationBridge.AishaContentMetadata gains run_id field +
 *      buildAishaContentMetadata accepts runId param + writes to meta.run_id.
 *   2. chat.ts passes tracer.runId into buildAishaContentMetadata so the
 *      content_metadata jsonb persisted by save_chat_message_audited
 *      carries it.
 *   3. get_chat_messages_audited RPC adds 'ai_run_id' to its returned
 *      jsonb_build_object, extracted from content_metadata->>'run_id'
 *      with content_metadata->>'aisha_run_id' fallback.
 *   4. useAiChat realtime subscription extracts ai_run_id from the
 *      incoming row's content_metadata so realtime-delivered messages
 *      get the chip/panel.
 *
 * This is the systemic counterpart to the live-path propagation done
 * in the Step 2 UI PR (response.metadata.run_id → message.ai_run_id).
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const MIGRATION       = resolve(ROOT, 'aisha/db/sql/functions/get_chat_messages_audited.sql');
const RPC_SOT         = resolve(ROOT, 'aisha/db/sql/functions/get_chat_messages_audited.sql');
const BRIDGE          = resolve(ROOT, 'services/svc-ai-chat/src/lib/orchestrationBridge.ts');
const CHAT_TS         = resolve(ROOT, 'services/svc-ai-chat/src/routes/chat.ts');
const USE_AI_CHAT     = resolve(ROOT, 'src/hooks/useAiChat.ts');

describe('chat_messages.ai_run_id JSONB surfacing (Step 2 systemic)', () => {

  describe('Migration + SoT mirror', () => {
    test('migration file exists', () => {
      expect(existsSync(MIGRATION)).toBe(true);
    });

    test('CREATE OR REPLACE only — no DROP FUNCTION (return type unchanged)', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_chat_messages_audited/);
      // Adding DROP FUNCTION would be unnecessary work + risk of permission
      // re-grant gap. The RETURNS jsonb signature is identical to the
      // pre-migration version; only the inner row shape differs.
      expect(sql).not.toMatch(/^DROP FUNCTION /m);
    });

    test('migration emits ai_run_id from COALESCE(run_id, aisha_run_id)', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      // Primary key extraction
      expect(sql).toMatch(/'ai_run_id',\s*COALESCE\(/);
      expect(sql).toMatch(/m\.content_metadata->>'run_id'/);
      expect(sql).toMatch(/m\.content_metadata->>'aisha_run_id'/);
    });

    test('migration does NOT add a column to chat_messages (capability-applied)', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      expect(sql).not.toMatch(/ALTER TABLE\s+public\.chat_messages\s+ADD COLUMN/);
    });

    test('SoT mirror matches migration (rpc-sql-mapping gate prereq)', () => {
      expect(existsSync(RPC_SOT)).toBe(true);
      const sot = readFileSync(RPC_SOT, 'utf-8');
      expect(sot).toMatch(/'ai_run_id',\s*COALESCE\(/);
      expect(sot).toMatch(/content_metadata->>'run_id'/);
      expect(sot).toMatch(/content_metadata->>'aisha_run_id'/);
    });

    test('SECURITY DEFINER + REVOKE/GRANT preserved on SoT', () => {
      const sot = readFileSync(RPC_SOT, 'utf-8');
      expect(sot).toMatch(/SECURITY DEFINER/);
      expect(sot).toMatch(/SET search_path TO 'public'/);
      expect(sot).toMatch(/REVOKE ALL ON FUNCTION public\.get_chat_messages_audited/);
      expect(sot).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_chat_messages_audited.*TO authenticated/);
    });
  });

  describe('orchestrationBridge — AishaContentMetadata + builder', () => {
    test('AishaContentMetadata interface declares run_id alongside aisha_run_id', () => {
      const code = readFileSync(BRIDGE, 'utf-8');
      // Already had aisha_run_id; this PR adds run_id (tracer per-call)
      expect(code).toMatch(/aisha_run_id\?:\s*string;/);
      expect(code).toMatch(/run_id\?:\s*string;/);
    });

    test('buildAishaContentMetadata accepts runId param + writes meta.run_id', () => {
      const code = readFileSync(BRIDGE, 'utf-8');
      // Param signature
      expect(code).toMatch(/runId\?:\s*string\s*\|\s*null/);
      // Population
      expect(code).toMatch(/if\s*\(params\.runId\)\s*meta\.run_id\s*=\s*params\.runId/);
    });
  });

  describe('chat.ts — passes tracer.runId into builder', () => {
    test('contentMetadata builder call includes runId: tracer.runId', () => {
      const code = readFileSync(CHAT_TS, 'utf-8');
      // The call site at the assistant content_metadata build
      expect(code).toMatch(/runId:\s*tracer\.runId\s*\?\?\s*null/);
    });
  });

  describe('useAiChat — realtime subscription extracts ai_run_id from content_metadata', () => {
    test('extracts ai_run_id via run_id primary + aisha_run_id fallback', () => {
      const code = readFileSync(USE_AI_CHAT, 'utf-8');
      // Realtime CDC payload parse extracts from row.content_metadata
      expect(code).toMatch(/contentMetadata\.run_id/);
      expect(code).toMatch(/contentMetadata\.aisha_run_id/);
      // Passes ai_run_id into ChatMessageSchema.safeParse
      expect(code).toMatch(/ChatMessageSchema\.safeParse\(\{[\s\S]*?ai_run_id:\s*aiRunId/);
    });
  });
});
