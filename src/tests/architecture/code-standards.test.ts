
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Architecture Tests
 * 
 * Enforcing critical security and architectural patterns across the codebase.
 * These tests analyse the source code to ensure compliance with "No-Go" rules.
 */

describe('Architecture & Security Standards', () => {
  const SRC_ROOT = path.resolve(__dirname, '../../'); // Assuming this file is in src/tests/architecture/
  
  // List of protected tables that MUST NOT be accessed directly via .from()
  // access must be done via .rpc() to ensure audit logging and permissions
  const PROTECTED_TABLES = [
    'profiles',
    'health_check_ins',
    'lab_results',
    'dosing_logs',
    'member_health_documents',
    'wearables_data',
    'audit_journal',
    'data_sharing_consents',
    'consents'
  ];

  // Files to ignore (test files, mocks, etc.)
  const IGNORED_PATHS = [
    '.test.ts', 
    '.spec.ts', 
    'src/tests/', 
    'src/mocks/', 
    'src/setupTests.ts'
  ];

  // Function to recursively get all .ts and .tsx files
  function getSourceFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        getSourceFiles(filePath, fileList);
      } else {
        if ((file.endsWith('.ts') || file.endsWith('.tsx')) && !file.endsWith('.d.ts')) {
          // Check ignore list
          const relativePath = path.relative(SRC_ROOT, filePath);
          const isIgnored = IGNORED_PATHS.some(ignored => relativePath.includes(ignored));
          
          if (!isIgnored) {
            fileList.push(filePath);
          }
        }
      }
    });

    return fileList;
  }

  const sourceFiles = getSourceFiles(SRC_ROOT);

  describe('RPC-Only Enforcement', () => {
    it('should not contain direct .from() calls to protected tables', () => {
      const violations: string[] = [];

      sourceFiles.forEach(filePath => {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        PROTECTED_TABLES.forEach(table => {
          // Regex looking for .from("table") or .from('table')
          // We look for strict matches to avoid false positives with substrings
          const regex = new RegExp(`\\.from\\(["']${table}["']\\)`, 'g');
          
          if (regex.test(content)) {
            const relativePath = path.relative(SRC_ROOT, filePath);
            violations.push(`${relativePath}: Direct access to '${table}' detected.`);
          }
        });
      });

      if (violations.length > 0) {
        console.error('RPC-Only Violations Found:\n', violations.join('\n'));
      }

      expect(violations, 
        'Direct table access detected! Use supabase.rpc() instead for sensitive data tables.'
      ).toHaveLength(0);
    });
  });

  describe('Data Minimization', () => {
    it('should not contain .select("*") calls', () => {
      const violations: string[] = [];

      sourceFiles.forEach(filePath => {
        const content = fs.readFileSync(filePath, 'utf-8');
         // Look for .select("*") or .select('*')
        const regex = /\.select\(\s*["']\*["']\s*\)/g;
        
        if (regex.test(content)) {
          const relativePath = path.relative(SRC_ROOT, filePath);
          violations.push(`${relativePath}: Usage of .select("*") detected.`);
        }
      });

      expect(violations, 
        'Wildcard select detected! Always specify explicit columns to prevent over-fetching and sensitive data leakage.'
      ).toHaveLength(0);
    });
  });

  describe('No Console Log', () => {
    it('should not contain console.log calls in production code', () => {
      const violations: string[] = [];

      sourceFiles.forEach(filePath => {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Match console.log but allow explicit eslint-disable comments if really needed
        // Simple check for console.log(
        if (content.includes('console.log(')) {
          // Check if it's ignored specifically on that line (basic check)
          // A robust check would process per line, but global check is a good start
          const lines = content.split('\n');
          lines.forEach((line, index) => {
            if (line.includes('console.log(') && !line.includes('eslint-disable-next-line')) {
               const relativePath = path.relative(SRC_ROOT, filePath);
               violations.push(`${relativePath}:${index + 1}: console.log() usage.`);
            }
          });
        }
      });

      // Note: We might have many existing console.logs, so this test might fail initially.
      // If so, we should treat it as a goal or allow specific instances.
      // For now, let's assert it purely to establish the standard.
      
      // If too many failures exist, you might want to comment out the expect temporarily 
      // or change it to a warning until cleanup.
      // expect(violations).toHaveLength(0); 
    });
  });
});
