/**
 * @aisha/ide-bridge — public surface.
 *
 * Consumers compose:
 *   - `safeWriteSync` + delimiter helpers for low-level merge logic
 *   - `IdeBridge` for the full daemon + reconnect loop
 *
 * Phase 13 WP 13.3 of the canonical 90-day plan.
 */
export {
  AISHA_MANAGED_START,
  AISHA_MANAGED_END,
  USER_CUSTOM_START,
  USER_CUSTOM_END,
  DEFAULT_BACKUPS_PER_FILE,
  defaultContentEquals,
  extractAishaManagedBlock,
  extractUserCustomSection,
  replaceUserCustomSection,
  safeWriteSync,
  type SafeWriteOutcome,
  type SafeWriteOptions,
  type SafeWriteResult,
} from "./safe-write.js";

export {
  IdeBridge,
  IDE_DEFAULT_OUTPUT_PATH,
  SUPPORTED_IDES,
  RECONNECT_BACKOFF_SECONDS,
  JITTER_RATIO,
  PING_INTERVAL_MS,
  backoffDelayMs,
  type BridgeConfig,
  type BridgeLogger,
  type SupportedIde,
} from "./bridge.js";
