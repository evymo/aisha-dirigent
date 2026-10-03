/**
 * Partner Routes Load — Generated from Framework Registry
 *
 * Tests all partner dashboard routes load successfully.
 * Add new routes in e2e/framework/registry.ts → PARTNER_ROUTES.
 */

import {
  PARTNER_ROUTES,
  generateRouteLoadTests,
} from './framework';

generateRouteLoadTests(PARTNER_ROUTES, {
  storageState: 'e2e/.auth/partner.json',
  describeLabel: 'Partner Routes',
});
