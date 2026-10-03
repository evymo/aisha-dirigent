/**
 * Public Pages Smoke — Generated from Framework Registry
 *
 * Tests all public routes are reachable without authentication.
 * Add new public routes in e2e/framework/registry.ts → PUBLIC_ROUTES.
 */

import {
  AUTH_ROUTES,
  PUBLIC_ROUTES,
  LEGAL_ROUTES,
  generateSmokeTests,
} from './framework';

generateSmokeTests([...PUBLIC_ROUTES, ...AUTH_ROUTES, ...LEGAL_ROUTES]);
