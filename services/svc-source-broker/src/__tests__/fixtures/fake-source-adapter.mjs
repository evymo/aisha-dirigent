/**
 * Test fixture for plugin-host.test.ts — a minimal SourceAdapterModule.
 * Plain ESM (not TS) because the plugin host dynamic-import()s a BUILT entry
 * file at runtime; this mirrors what a real adapter package ships.
 */
export function createDataSource() {
  return {
    config: {
      slug: 'fake-source',
      displayName: 'Fake source (test fixture)',
      version: '0.0.1',
      capabilities: [],
      authKind: 'none',
      // no storyId on purpose — the host injects the deploy-configured one
    },
    initialized: false,
    async initialize() {
      this.initialized = true;
    },
    async *fetchAggregateSnapshots() {
      return;
    },
    async getEntity(_entityType, externalId) {
      return { entity: { id: externalId, fixture: true }, scope: 'operator' };
    },
    async probe() {
      return { status: 'ok', checkedAt: new Date().toISOString() };
    },
    async shutdown() {},
  };
}
