/**
 * Tracking Data Architecture Consistency Test
 *
 * Validates that:
 * 1. All health-related tables have source of truth files + RLS policies
 * 2. Timeline triggers exist for health data sync
 * 3. member_wearable_connections table exists with proper structure
 * 4. add_system_timeline_entry supports health sync entry type
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = process.cwd();
const SQL_DIR = path.join(process.cwd(), 'aisha/db/sql');

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(SQL_DIR, relativePath));
}

function readFile(relativePath: string): string {
  const fullPath = path.join(SQL_DIR, relativePath);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf-8');
}

/** Check if any policy file references the given table name. */
function hasPolicyFilesForTable(table: string): boolean {
  const policiesDir = path.join(SQL_DIR, 'policies');
  if (!fs.existsSync(policiesDir)) return false;
  const files = fs.readdirSync(policiesDir);
  // Match files like table__PolicyName.sql or OldStyle containing the table
  return files.some((f) => {
    if (!f.endsWith('.sql')) return false;
    // Convention: table__PolicyName.sql
    if (f.startsWith(`${table}__`)) return true;
    // Also check content as fallback
    const content = fs.readFileSync(path.join(policiesDir, f), 'utf-8');
    return content.includes(`ON public.${table}`) || content.includes(`ON ${table}`);
  });
}

describe('Tracking Data Architecture', () => {
  describe('Source of Truth files exist', () => {
    const requiredTables = [
      'health_data',
      'health_data_sync_log',
      'wearables_data',
      'member_wearable_connections',
      'wearable_analysis_files',
    ];

    it.each(requiredTables)('table %s has source of truth file', (table) => {
      expect(fileExists(`tables/${table}.sql`)).toBe(true);
    });

    it.each(requiredTables)('table %s has RLS policies in SoT', (table) => {
      expect(
        hasPolicyFilesForTable(table),
        `No RLS policy files found for PHI table ${table} in policies/`
      ).toBe(true);
    });
  });

  describe('RLS is enabled on health tables', () => {
    const healthTables = [
      'health_data',
      'health_data_sync_log',
      'wearables_data',
      'member_wearable_connections',
      'wearable_analysis_files',
    ];

    it.each(healthTables)('table %s has RLS enabled in source of truth', (table) => {
      const content = readFile(`tables/${table}.sql`);
      expect(content).toContain('ENABLE ROW LEVEL SECURITY');
    });
  });

  describe('Timeline integration for health sync', () => {
    it('trigger_timeline_health_sync function exists', () => {
      expect(fileExists('functions/trigger_timeline_health_sync.sql')).toBe(true);
    });

    it('trigger is defined on health_data_sync_log', () => {
      expect(fileExists('triggers/trg_timeline_health_sync.sql')).toBe(true);
      const content = readFile('triggers/trg_timeline_health_sync.sql');
      expect(content).toMatch(/ON\s+(public\.)?health_data_sync_log/);
      expect(content).toContain('AFTER INSERT');
    });

    it('system_health_sync is allowed in add_system_timeline_entry', () => {
      const content = readFile('functions/add_system_timeline_entry.sql');
      expect(content).toContain("'system_health_sync'");
    });

    it('trigger does not expose sensitive data in metadata', () => {
      const content = readFile('functions/trigger_timeline_health_sync.sql');
      // Should NOT contain these data-leaking patterns
      expect(content).not.toMatch(/heart_rate|blood_pressure|weight|sleep_hours|pain_level/i);
      // Should contain safe metadata fields
      expect(content).toContain('sync_batch_id');
      expect(content).toContain('records_count');
    });

    it('wearable analysis trigger function exists', () => {
      expect(fileExists('functions/trigger_timeline_wearable_analysis_file.sql')).toBe(true);
    });

    it('wearable analysis trigger is defined on wearable_analysis_files', () => {
      expect(fileExists('triggers/trg_timeline_wearable_analysis_file.sql')).toBe(true);
      const content = readFile('triggers/trg_timeline_wearable_analysis_file.sql');
      expect(content).toMatch(/ON\s+(public\.)?wearable_analysis_files/);
      expect(content).toContain('AFTER INSERT');
    });
  });

  describe('Wearable connections table structure', () => {
    it('has proper columns', () => {
      const content = readFile('tables/member_wearable_connections.sql');
      expect(content).toContain('user_id uuid');
      expect(content).toContain('device_type text');
      expect(content).toContain('connection_status text');
      expect(content).toContain('platform text');
      expect(content).toContain('last_sync_at timestamptz');
      expect(content).toContain('permissions_granted text[]');
      expect(content).toContain('sync_count int4');
    });

    it('has FK to aisha_auth.users', () => {
      const content = readFile('tables/member_wearable_connections.sql');
      expect(content).toContain('REFERENCES aisha_auth.users(id) ON DELETE CASCADE');
    });

    it('has unique constraint for user + device + platform', () => {
      const content = readFile('tables/member_wearable_connections.sql');
      expect(content).toContain('UNIQUE (user_id, device_type, platform)');
    });

    it('has valid status constraint', () => {
      const content = readFile('tables/member_wearable_connections.sql');
      expect(content).toMatch(/CHECK.*connected.*disconnected.*paused/);
    });
  });

  describe('Wearable connections indexes and triggers', () => {
    it('has separate index files (1 index = 1 file)', () => {
      expect(fileExists('indexes/idx_member_wearable_connections_user_id.sql')).toBe(true);
      const userIdContent = readFile('indexes/idx_member_wearable_connections_user_id.sql');
      expect(userIdContent).toContain('idx_member_wearable_connections_user_id');

      expect(fileExists('indexes/idx_member_wearable_connections_status.sql')).toBe(true);
      const statusContent = readFile('indexes/idx_member_wearable_connections_status.sql');
      expect(statusContent).toContain('idx_member_wearable_connections_status');
    });

    it('has separate trigger file', () => {
      expect(fileExists('triggers/update_member_wearable_connections_updated_at.sql')).toBe(true);
      const content = readFile('triggers/update_member_wearable_connections_updated_at.sql');
      expect(content).toContain('update_member_wearable_connections_updated_at');
      expect(content).toContain('update_updated_at_column');
    });
  });

  describe('RPC functions for wearable connections', () => {
    it('upsert_wearable_connection function exists', () => {
      expect(fileExists('functions/upsert_wearable_connection.sql')).toBe(true);
    });

    it('get_my_wearable_connections function exists', () => {
      expect(fileExists('functions/get_my_wearable_connections.sql')).toBe(true);
    });

    it('upsert function is SECURITY DEFINER with audit logging', () => {
      const content = readFile('functions/upsert_wearable_connection.sql');
      expect(content).toContain('SECURITY DEFINER');
      expect(content).toContain("SET search_path TO 'public'");
      expect(content).toContain('audit_journal');
    });

    it('upsert function has proper grants', () => {
      const content = readFile('functions/upsert_wearable_connection.sql');
      expect(content).toContain('REVOKE ALL');
      expect(content).toContain('GRANT EXECUTE');
      expect(content).toContain('TO authenticated');
    });

    it('get function has proper grants', () => {
      const content = readFile('functions/get_my_wearable_connections.sql');
      expect(content).toContain('REVOKE ALL');
      expect(content).toContain('GRANT EXECUTE');
      expect(content).toContain('TO authenticated');
    });

    it('upsert function does not log sensitive data', () => {
      const content = readFile('functions/upsert_wearable_connection.sql');
      // Audit metadata should only contain safe identifiers — no sensitive data fields
      expect(content).not.toMatch(/\bemail\b(?!_)/i);     // email but not email_ prefixes
      expect(content).not.toMatch(/\bheart_rate\b/i);
      expect(content).not.toMatch(/\bblood_pressure\b/i);
      expect(content).not.toMatch(/\bpain_level\b/i);
      expect(content).not.toMatch(/\bsleep_hours\b/i);
      // Should contain safe audit fields
      expect(content).toContain('connection_id');
      expect(content).toContain('device_type');
    });
  });

  describe('Tracking data bulk upload function', () => {
    it('exists and is SECURITY DEFINER', () => {
      const content = readFile('functions/health_data_bulk_upload.sql');
      expect(content).toContain('SECURITY DEFINER');
      expect(content).toContain("SET search_path TO 'public'");
    });

    it('has rate limiting', () => {
      const content = readFile('functions/health_data_bulk_upload.sql');
      expect(content).toContain('enforce_rate_limit');
    });

    it('validates input as array', () => {
      const content = readFile('functions/health_data_bulk_upload.sql');
      expect(content).toContain("jsonb_typeof(p_health_records) != 'array'");
    });

    it('writes wearable sync payloads to wearables_data', () => {
      const content = readFile('functions/health_data_bulk_upload.sql');
      expect(content).toContain('INSERT INTO wearables_data');
    });

    it('does not write wearable sync payloads to health_check_ins', () => {
      const content = readFile('functions/health_data_bulk_upload.sql');
      expect(content).not.toContain('INSERT INTO health_check_ins');
    });
  });

  describe('Wearable analysis file references', () => {
    it('create_wearable_analysis_file_reference function exists', () => {
      expect(fileExists('functions/create_wearable_analysis_file_reference.sql')).toBe(true);
    });

    it('reference function is SECURITY DEFINER with sync ownership check', () => {
      const content = readFile('functions/create_wearable_analysis_file_reference.sql');
      expect(content).toContain('SECURITY DEFINER');
      expect(content).toContain("SET search_path TO 'public'");
      expect(content).toContain('health_data_sync_log');
      expect(content).toContain('Sync batch not found for current user');
    });

    it('reference function has proper grants', () => {
      const content = readFile('functions/create_wearable_analysis_file_reference.sql');
      expect(content).toContain('REVOKE ALL');
      expect(content).toContain('GRANT EXECUTE');
      expect(content).toContain('TO authenticated');
    });

    it('analysis payload RPC exists with owner checks and audit', () => {
      const content = readFile('functions/get_wearable_sync_payload_for_analysis_audited.sql');
      expect(content).toContain('SECURITY DEFINER');
      expect(content).toContain("SET search_path TO 'public'");
      expect(content).toContain('Sync batch not found');
      expect(content).toContain('audit_journal');
    });
  });

  describe('Wearable analysis generation pipeline', () => {
    it('wearable-analysis storage source-of-truth exists', () => {
      expect(fileExists('storage/wearable-analysis.sql')).toBe(true);
      const content = readFile('storage/wearable-analysis.sql');
      expect(content).toContain("'wearable-analysis'");
      expect(content).toContain('CREATE POLICY');
    });

    it('analyze-wearable-sync edge function exists', () => {
      const edgeFunctionPath = path.join(
        ROOT_DIR,
        'trash/legacy-archive/edge-functions-reference/analyze-wearable-sync/index.ts'
      );
      expect(fs.existsSync(edgeFunctionPath)).toBe(true);
    });
  });
});
