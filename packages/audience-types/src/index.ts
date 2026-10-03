/**
 * @aisha/audience-types — barrel export
 *
 * Universal audience module type system. Used by:
 *   - svc-source-broker (data source implementation)
 *   - future broker microservices
 *   - frontend Appsmith bindings (via REST/GraphQL contracts)
 *   - any package consuming audience data shapes
 */

export * from './member-tier.js';
export * from './aggregation.js';
export * from './IDataSource.js';
export * from './connector.js';
export * from './audience-entities.js';
