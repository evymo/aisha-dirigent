/**
 * @fileoverview Test to ensure all write_audit_journal calls use named parameters in alphabetical order.
 * 
 * This test prevents the critical bug where positional parameters were used incorrectly,
 * causing 96+ Sentry errors on iOS (function signature mismatch).
 * 
 * The correct parameter order (ALPHABETICAL) is:
 *   p_action_type, p_area, p_details, p_entity_id, p_entity_type,
 *   p_new_values, p_old_values, p_severity, p_summary, p_tags, p_user_id
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

const FUNCTIONS_DIR = path.join(process.cwd(), 'aisha/db/sql/functions');
const EDGE_FUNCTIONS_DIR = path.join(process.cwd(), 'trash/legacy-archive/edge-functions-reference');

// The correct alphabetical order of parameters
const ALPHABETICAL_PARAMS = [
  'p_action_type',
  'p_area',
  'p_details',
  'p_entity_id',
  'p_entity_type',
  'p_new_values',
  'p_old_values',
  'p_severity',
  'p_summary',
  'p_tags',
  'p_user_id',
];

interface ValidationError {
  file: string;
  line: number;
  issue: string;
  context: string;
}

function extractWriteAuditJournalCalls(content: string, filePath: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = content.split('\n');
  
  // Find all write_audit_journal calls
  const callPattern = /(?:PERFORM\s+(?:public\.)?write_audit_journal|(?:public\.)?write_audit_journal)\s*\(/gi;
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = callPattern.exec(line);
    
    if (match || line.match(/write_audit_journal\s*\(/i)) {
      const startLine = i;
      
      // Collect the full call (may span multiple lines)
      let callText = line;
      let depth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      let j = i + 1;
      
      while (depth > 0 && j < lines.length) {
        callText += '\n' + lines[j];
        depth += (lines[j].match(/\(/g) || []).length;
        depth -= (lines[j].match(/\)/g) || []).length;
        j++;
      }
      
      // Skip the function definition itself
      if (callText.includes('CREATE OR REPLACE FUNCTION') && callText.includes('write_audit_journal')) {
        i = j;
        continue;
      }
      
      // Skip comments
      if (line.trim().startsWith('--') || line.trim().startsWith('//')) {
        i++;
        continue;
      }
      
      // Check if using named parameters
      const usesNamedParams = /p_action_type\s*:=/i.test(callText);
      
      if (!usesNamedParams && callText.includes('write_audit_journal(')) {
        // Check if it's an actual call (not just a reference or definition)
        const isActualCall = /(?:PERFORM|RETURN|:=)\s*(?:public\.)?write_audit_journal\s*\(/i.test(callText);
        
        if (isActualCall) {
          errors.push({
            file: filePath,
            line: startLine + 1,
            issue: 'Uses positional parameters instead of named parameters',
            context: callText.substring(0, 200).replace(/\n/g, ' ').trim(),
          });
        }
      }
      
      // If using named params, verify alphabetical order
      if (usesNamedParams) {
        const paramMatches = [...callText.matchAll(/p_(\w+)\s*:=/gi)];
        const usedParams = paramMatches.map(m => 'p_' + m[1].toLowerCase());
        
        // Filter to only known params and check order
        const knownUsedParams = usedParams.filter(p => ALPHABETICAL_PARAMS.includes(p));
        
        // Check if they're in alphabetical order
        const sortedParams = [...knownUsedParams].sort((a, b) => 
          ALPHABETICAL_PARAMS.indexOf(a) - ALPHABETICAL_PARAMS.indexOf(b)
        );
        
        const isInOrder = JSON.stringify(knownUsedParams) === JSON.stringify(sortedParams);
        
        if (!isInOrder) {
          errors.push({
            file: filePath,
            line: startLine + 1,
            issue: `Parameters not in alphabetical order. Found: [${knownUsedParams.join(', ')}], Expected: [${sortedParams.join(', ')}]`,
            context: callText.substring(0, 200).replace(/\n/g, ' ').trim(),
          });
        }
      }
      
      i = j;
    } else {
      i++;
    }
    
    // Reset regex lastIndex
    callPattern.lastIndex = 0;
  }
  
  return errors;
}

function extractWriteAuditJournalCallsTypeScript(content: string, filePath: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = content.split('\n');
  
  // Pattern for TypeScript RPC calls
  const rpcPattern = /\.rpc\s*\(\s*["']write_audit_journal["']/gi;
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    if (rpcPattern.test(line) || line.includes('write_audit_journal')) {
      rpcPattern.lastIndex = 0;
      
      // Skip type definitions and comments
      if (line.includes('write_audit_journal:') || 
          line.trim().startsWith('//') || 
          line.trim().startsWith('*') ||
          line.trim().startsWith('/*')) {
        i++;
        continue;
      }
      
      const startLine = i;
      
      // Collect the full call (may span multiple lines)
      let callText = line;
      let depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      let j = i + 1;
      
      // Also track parentheses
      let parenDepth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      
      while ((depth > 0 || parenDepth > 0) && j < lines.length && j < i + 30) {
        callText += '\n' + lines[j];
        depth += (lines[j].match(/\{/g) || []).length;
        depth -= (lines[j].match(/\}/g) || []).length;
        parenDepth += (lines[j].match(/\(/g) || []).length;
        parenDepth -= (lines[j].match(/\)/g) || []).length;
        j++;
      }
      
      // Check if this is an actual RPC call
      if (callText.includes('.rpc') && callText.includes('write_audit_journal')) {
        // Extract the parameter object
        const paramObjectMatch = callText.match(/write_audit_journal["']\s*,\s*\{([^}]+)\}/s);
        
        if (paramObjectMatch) {
          const paramObject = paramObjectMatch[1];
          
          // Extract parameter names in order of appearance
          const paramMatches = [...paramObject.matchAll(/\b(p_\w+)\s*:/gi)];
          const usedParams = paramMatches.map(m => m[1].toLowerCase());
          
          // Filter to only known params
          const knownUsedParams = usedParams.filter(p => ALPHABETICAL_PARAMS.includes(p));
          
          // Check if they're in alphabetical order
          const sortedParams = [...knownUsedParams].sort((a, b) => 
            ALPHABETICAL_PARAMS.indexOf(a) - ALPHABETICAL_PARAMS.indexOf(b)
          );
          
          const isInOrder = JSON.stringify(knownUsedParams) === JSON.stringify(sortedParams);
          
          if (!isInOrder) {
            errors.push({
              file: filePath,
              line: startLine + 1,
              issue: `Parameters not in alphabetical order. Found: [${knownUsedParams.join(', ')}], Expected: [${sortedParams.join(', ')}]`,
              context: callText.substring(0, 200).replace(/\n/g, ' ').trim(),
            });
          }
        }
      }
      
      i = j;
    } else {
      i++;
    }
    
    rpcPattern.lastIndex = 0;
  }
  
  return errors;
}

describe('write_audit_journal parameter validation', () => {
  it('SQL functions must use named parameters in alphabetical order', async () => {
    const sqlFiles = await glob('**/*.sql', { cwd: FUNCTIONS_DIR, absolute: true });
    const allErrors: ValidationError[] = [];
    
    for (const file of sqlFiles) {
      // Skip the write_audit_journal.sql itself (it defines the function)
      if (path.basename(file) === 'write_audit_journal.sql') {
        continue;
      }
      
      const content = fs.readFileSync(file, 'utf-8');
      
      // Only check files that actually call write_audit_journal
      if (!content.includes('write_audit_journal')) {
        continue;
      }
      
      const errors = extractWriteAuditJournalCalls(content, path.relative(process.cwd(), file));
      allErrors.push(...errors);
    }
    
    if (allErrors.length > 0) {
      const errorReport = allErrors
        .map(e => `\n  ${e.file}:${e.line}\n    Issue: ${e.issue}\n    Context: ${e.context.substring(0, 100)}...`)
        .join('\n');
      
      expect.fail(
        `Found ${allErrors.length} write_audit_journal call(s) with incorrect parameters:\n${errorReport}\n\n` +
        `All calls MUST use named parameters in alphabetical order:\n` +
        `  ${ALPHABETICAL_PARAMS.join(', ')}`
      );
    }
    
    expect(allErrors).toHaveLength(0);
  });
  
  it('Edge Functions must use parameters in alphabetical order', async () => {
    if (!fs.existsSync(EDGE_FUNCTIONS_DIR)) {
      return; // Skip if no edge functions
    }
    
    const tsFiles = await glob('**/*.ts', { cwd: EDGE_FUNCTIONS_DIR, absolute: true });
    const allErrors: ValidationError[] = [];
    
    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      
      // Only check files that actually call write_audit_journal
      if (!content.includes('write_audit_journal')) {
        continue;
      }
      
      const errors = extractWriteAuditJournalCallsTypeScript(content, path.relative(process.cwd(), file));
      allErrors.push(...errors);
    }
    
    if (allErrors.length > 0) {
      const errorReport = allErrors
        .map(e => `\n  ${e.file}:${e.line}\n    Issue: ${e.issue}\n    Context: ${e.context.substring(0, 100)}...`)
        .join('\n');
      
      expect.fail(
        `Found ${allErrors.length} write_audit_journal call(s) with incorrect parameter order:\n${errorReport}\n\n` +
        `All calls MUST use parameters in alphabetical order:\n` +
        `  ${ALPHABETICAL_PARAMS.join(', ')}`
      );
    }
    
    expect(allErrors).toHaveLength(0);
  });
  
  it('Frontend/lib code must use parameters in alphabetical order', async () => {
    const srcDir = path.join(process.cwd(), 'src');
    
    if (!fs.existsSync(srcDir)) {
      return;
    }
    
    const tsFiles = await glob('**/*.{ts,tsx}', { 
      cwd: srcDir, 
      absolute: true,
      ignore: ['**/tests/**', '**/*.test.ts', '**/*.test.tsx']
    });
    
    const allErrors: ValidationError[] = [];
    
    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      
      // Only check files that actually call write_audit_journal
      if (!content.includes('write_audit_journal')) {
        continue;
      }
      
      const errors = extractWriteAuditJournalCallsTypeScript(content, path.relative(process.cwd(), file));
      allErrors.push(...errors);
    }
    
    if (allErrors.length > 0) {
      const errorReport = allErrors
        .map(e => `\n  ${e.file}:${e.line}\n    Issue: ${e.issue}\n    Context: ${e.context.substring(0, 100)}...`)
        .join('\n');
      
      expect.fail(
        `Found ${allErrors.length} write_audit_journal call(s) with incorrect parameter order:\n${errorReport}\n\n` +
        `All calls MUST use parameters in alphabetical order:\n` +
        `  ${ALPHABETICAL_PARAMS.join(', ')}`
      );
    }
    
    expect(allErrors).toHaveLength(0);
  });
  
  it('write_audit_journal function signature must have parameters in alphabetical order', () => {
    const functionFile = path.join(FUNCTIONS_DIR, 'write_audit_journal.sql');
    
    expect(fs.existsSync(functionFile), 'write_audit_journal.sql should exist').toBe(true);
    
    const content = fs.readFileSync(functionFile, 'utf-8');
    
    // Extract CREATE FUNCTION parameters
    const createFunctionMatch = content.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?write_audit_journal\s*\(([^)]+)\)/is
    );
    
    expect(createFunctionMatch, 'Should find CREATE FUNCTION statement').toBeTruthy();
    
    if (createFunctionMatch) {
      const paramsSection = createFunctionMatch[1];
      
      // Extract parameter names in order
      const paramMatches = [...paramsSection.matchAll(/\b(p_\w+)\s+/gi)];
      const declaredParams = paramMatches.map(m => m[1].toLowerCase());
      
      // Check that first parameter is p_action_type (required, no default)
      expect(declaredParams[0]).toBe('p_action_type');
      
      // Check alphabetical order for all parameters
      const sortedParams = [...declaredParams].sort();
      
      expect(declaredParams).toEqual(sortedParams);
    }
  });
  
  it('TypeScript types must match function signature order', async () => {
    const typesFile = path.join(process.cwd(), 'src/integrations/db/types.ts');
    
    if (!fs.existsSync(typesFile)) {
      return;
    }
    
    const content = fs.readFileSync(typesFile, 'utf-8');
    
    // Find write_audit_journal Args type
    const argsMatch = content.match(/write_audit_journal:\s*\{\s*Args:\s*\{([^}]+)\}/s);
    
    expect(argsMatch, 'Should find write_audit_journal Args in types').toBeTruthy();
    
    if (argsMatch) {
      const argsSection = argsMatch[1];
      
      // Extract parameter names in order of appearance
      const paramMatches = [...argsSection.matchAll(/\b(p_\w+)\??:/gi)];
      const declaredParams = paramMatches.map(m => m[1].toLowerCase());
      
      // Check alphabetical order
      const sortedParams = [...declaredParams].sort();
      
      if (JSON.stringify(declaredParams) !== JSON.stringify(sortedParams)) {
        expect.fail(
          `TypeScript Args are not in alphabetical order.\n` +
          `  Found: [${declaredParams.join(', ')}]\n` +
          `  Expected: [${sortedParams.join(', ')}]\n\n` +
          `Run 'npm run db:types:gen:local' after fixing the function signature.`
        );
      }
      
      expect(declaredParams).toEqual(sortedParams);
    }
  });
});
