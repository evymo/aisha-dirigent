/**
 * RBAC Access Control — Generated from Framework Registry
 *
 * Tests role-based access rules defined in the registry.
 * Add new RBAC rules in e2e/framework/registry.ts → RBAC_RULES.
 */

import {
  RBAC_RULES,
  generateRbacTests,
} from './framework';

generateRbacTests(RBAC_RULES, {
  describeLabel: 'RBAC Access Control (Generated)',
});
