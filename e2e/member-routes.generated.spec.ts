/**
 * Member Routes Load — Generated from Framework Registry
 *
 * Tests all member portal routes load successfully.
 * Add new routes in e2e/framework/registry.ts → MEMBER_ROUTES.
 */

import {
  MEMBER_ROUTES,
  generateRouteLoadTests,
} from './framework';

generateRouteLoadTests(MEMBER_ROUTES, {
  storageState: 'e2e/.auth/member.json',
  describeLabel: 'Member Routes',
});
