/**
 * Centralized Dependencies for Edge Functions
 * 
 * All external imports should go through this file to ensure
 * consistent versions across all Edge Functions.
 * 
 * Usage:
 *   import { serve, createClient, Stripe } from "../_shared/deps.ts";
 * 
 * @module
 */

// =============================================================================
// Deno Standard Library - pinned to 0.190.0 (stable)
// =============================================================================
export { serve } from "https://deno.land/std@0.190.0/http/server.ts";

// =============================================================================
// Supabase - pinned to 2.57.2 (npm resolution avoids esm.sh graph issues)
// =============================================================================
export { createClient } from "npm:@supabase/supabase-js@2.57.2";
export type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.2";

// =============================================================================
// Stripe - pinned to 18.5.0 (latest stable)
// =============================================================================
export { default as Stripe } from "https://esm.sh/stripe@18.5.0";

// =============================================================================
// JWT (jose) - for Firebase/FCM auth
// =============================================================================
export * as jose from "https://deno.land/x/jose@v4.14.4/index.ts";

// =============================================================================
// JWT (djwt) - for custom JWT creation
// =============================================================================
export { create as createJwt, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

// =============================================================================
// OpenAI SDK — used by llmRouter.ts for multi-model routing
// =============================================================================
export { default as OpenAI } from "npm:openai";
