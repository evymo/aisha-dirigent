/**
 * Admin Routes Load — Generated from Framework Registry
 *
 * This spec demonstrates the framework pattern:
 * 1. Import routes from registry (WHAT to test)
 * 2. Call template function (HOW to test)
 * 3. Done — no boilerplate
 *
 * To add a new admin route test: edit e2e/framework/registry.ts → ADMIN_ROUTES
 */

import {
  ADMIN_ROUTES,
  generateRouteLoadTests,
} from './framework';

// Generate all admin route load tests from registry
generateRouteLoadTests(ADMIN_ROUTES, {
  storageState: 'e2e/.auth/admin.json',
  describeLabel: 'Admin Routes',
});
