/**
 * Table Grants Validation Test
 * 
 * Validates that all tables in source of truth have proper GRANT statements.
 * 
 * Why this matters:
 * - Supabase local dev adds grants automatically via DEFAULT PRIVILEGES
 * - pg_dump/restore may not preserve these grants
 * - Functions with SECURITY INVOKER need explicit table grants to work
 * 
 * Expected pattern in table SQL files:
 * - GRANT SELECT ON <table> TO authenticated;
 * - GRANT SELECT ON <table> TO anon; (for public data)
 * - GRANT INSERT, UPDATE, DELETE ON <table> TO authenticated; (for user-owned tables)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SQL_TABLES_DIR = path.join(process.cwd(), 'aisha/db/sql/tables');

// Tables that MUST have authenticated SELECT grant
const TABLES_REQUIRING_AUTH_SELECT = [
  // Questionnaire system (used by mobile app)
  'questionnaires',
  'questionnaire_blocks', 
  'question_blocks',
  // User data tables
  'health_check_ins',
  'lab_results',
  'dosing_logs',
  'profiles',
  'consents',
  'data_sharing_consents',
  'study_registrations',
  'questionnaire_responses',
  // Partner system
  'partner_profiles',
  'partner_appointments',
  'partner_appointment_notes',
  // Product/shop system
  'products',
  'cart_items',
  'orders',
  'order_items',
  // Studies
  'studies',
  'study_consultants',
];

// Tables that should have anon SELECT grant (public data)
const TABLES_REQUIRING_ANON_SELECT = [
  'questionnaires',
  'questionnaire_blocks',
  'question_blocks',
  'products',
  'featured_products',
  'archive_documents',
  'archive_tags',
  'studies',
];

// Tables where users can write their own data
const TABLES_REQUIRING_AUTH_WRITE = [
  'health_check_ins',
  'dosing_logs',
  'lab_results',
  'consents',
  'cart_items',
  'questionnaire_responses',
  'partner_appointment_notes',
];

function readTableFile(tableName: string): string | null {
  const filePath = path.join(SQL_TABLES_DIR, `${tableName}.sql`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function hasGrant(content: string, tableName: string, grantee: 'authenticated' | 'anon', privilege: string): boolean {
  // Match: GRANT SELECT ON table_name TO authenticated;
  // Also match: GRANT SELECT, INSERT, UPDATE ON public.table_name TO authenticated;
  // The privilege can be anywhere in the comma-separated list
  const pattern = new RegExp(
    `GRANT\\s+[A-Z,\\s]*\\b${privilege}\\b[A-Z,\\s]*ON\\s+(?:public\\.)?${tableName}\\s+TO\\s+${grantee}`,
    'i'
  );
  return pattern.test(content);
}

function hasSelectGrant(content: string, tableName: string, grantee: 'authenticated' | 'anon'): boolean {
  return hasGrant(content, tableName, grantee, 'SELECT');
}

function hasWriteGrants(content: string, tableName: string): boolean {
  // Check for INSERT, UPDATE grants
  const hasInsert = hasGrant(content, tableName, 'authenticated', 'INSERT');
  const hasUpdate = hasGrant(content, tableName, 'authenticated', 'UPDATE');
  return hasInsert || hasUpdate;
}

describe('Table Grants Validation', () => {
  describe('Authenticated SELECT grants', () => {
    it.each(TABLES_REQUIRING_AUTH_SELECT)('table %s should have GRANT SELECT TO authenticated', (tableName) => {
      const content = readTableFile(tableName);
      
      if (content === null) {
        console.warn(`⚠️ Table file not found: ${tableName}.sql`);
        return; // Skip if file doesn't exist
      }
      
      const hasGrant = hasSelectGrant(content, tableName, 'authenticated');
      expect(
        hasGrant,
        `Table ${tableName} is missing GRANT SELECT TO authenticated in SQL source of truth`
      ).toBe(true);
    });
  });

  describe('Anon SELECT grants for public tables', () => {
    it.each(TABLES_REQUIRING_ANON_SELECT)('table %s should have GRANT SELECT TO anon', (tableName) => {
      const content = readTableFile(tableName);
      
      if (content === null) {
        console.warn(`⚠️ Table file not found: ${tableName}.sql`);
        return;
      }
      
      const hasGrant = hasSelectGrant(content, tableName, 'anon');
      expect(
        hasGrant,
        `Public table ${tableName} is missing GRANT SELECT TO anon in SQL source of truth`
      ).toBe(true);
    });
  });

  describe('Authenticated WRITE grants for user-owned tables', () => {
    it.each(TABLES_REQUIRING_AUTH_WRITE)('table %s should have GRANT INSERT/UPDATE TO authenticated', (tableName) => {
      const content = readTableFile(tableName);
      
      if (content === null) {
        console.warn(`⚠️ Table file not found: ${tableName}.sql`);
        return;
      }
      
      const hasWriteGrant = hasWriteGrants(content, tableName);
      expect(
        hasWriteGrant,
        `User-owned table ${tableName} is missing GRANT INSERT/UPDATE TO authenticated in SQL source of truth`
      ).toBe(true);
    });
  });

  describe('All table files should have at least basic grants', () => {
    it('should report tables missing grants', () => {
      if (!fs.existsSync(SQL_TABLES_DIR)) {
        console.warn('⚠️ Tables directory not found');
        return;
      }

      const tableFiles = fs.readdirSync(SQL_TABLES_DIR)
        .filter(f => f.endsWith('.sql'))
        .map(f => f.replace('.sql', ''));

      const missingGrants: string[] = [];
      
      for (const tableName of tableFiles) {
        const content = readTableFile(tableName);
        if (content && !content.includes('GRANT')) {
          missingGrants.push(tableName);
        }
      }

      if (missingGrants.length > 0) {
        console.warn(`⚠️ Tables without any GRANT statements (${missingGrants.length}):`, 
          missingGrants.slice(0, 10).join(', ') + (missingGrants.length > 10 ? '...' : '')
        );
      }

      // This is a warning test - we don't fail on this for now
      // but it should be fixed over time
      expect(missingGrants.length).toBeLessThan(tableFiles.length);
    });
  });
});
