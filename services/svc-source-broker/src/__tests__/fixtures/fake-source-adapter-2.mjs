/**
 * Second test fixture for plugin-host.test.ts — a distinct SourceAdapterModule
 * (different slug) so the multi-entry test proves TWO sources register under TWO
 * stories from one broker (the delivery-notes + invoices, or N-agenda, shape).
 */
export function createDataSource() {
  return {
    config: {
      slug: 'fake-source-2',
      displayName: 'Fake source #2 (test fixture)',
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
      return { entity: { id: externalId, fixture: 2 }, scope: 'operator' };
    },
    async probe() {
      return { status: 'ok', checkedAt: new Date().toISOString() };
    },
    async shutdown() {},
  };
}
