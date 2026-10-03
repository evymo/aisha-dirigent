/**
 * @aisha/broker-kit — the connector chassis (AISHA connector doctrine).
 *
 * A connector = a THIN driver over this THICK chassis. A service composes:
 *   registry + read-pipeline + ingest-engine + control saga + config, and only
 *   ships per-source drivers (ReadDriver / IControlTarget) + a SourceMapper.
 * The universal driver/mapper/registry CONTRACTS live in @aisha/audience-types.
 */
export * from './config.js';
export * from './registry.js';
export * from './read-pipeline.js';
export * from './ingest-engine.js';
export * from './control.js';

// Re-export the contracts so a driver package depends only on @aisha/broker-kit.
export type {
  ReadDriver, IControlTarget, SourceMapper, UpsertCommand, ControlAction, ControlResult,
  ControlCapability, ReadRequest, BatchReadRequest, CallerScope, ScopedRecord,
  SourceConnection, SourceContract, SourceField, SourceHealth, ConnectorRegistry,
  ConnectorRegistryEntry,
} from '@aisha/audience-types';
