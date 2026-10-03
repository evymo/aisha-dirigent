/**
 * plugin-host — the seam that loads an out-of-tree source-adapter package into
 * the SourceRegistry. Verifies the OPTIONALITY contract end-to-end:
 *   - no entry configured  → no-op, stories keep the NullDataSource default
 *   - valid entry          → adapter registered + dispatched by story, with the
 *                            deploy-configured storyId injected by the host
 *   - broken entry         → fail-SOFT (logged, NullDataSource kept — 501, not
 *                            a crash), matching the missing-LLM-key model
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { SourceRegistry } from '../adapters/source-registry.js';
import { NullDataSource } from '../adapters/null-data-source.js';
import { loadSourceAdapterPlugins, type PluginHostLogger } from '../adapters/plugin-host.js';
import type { SourceBrokerConfig } from '../config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_OK = path.join(HERE, 'fixtures', 'fake-source-adapter.mjs');
const FIXTURE_OK_2 = path.join(HERE, 'fixtures', 'fake-source-adapter-2.mjs');
const FIXTURE_BROKEN = path.join(HERE, 'fixtures', 'broken-source-adapter.mjs');
const STORY = '22222222-2222-4222-8222-222222222222';
const STORY_2 = '33333333-3333-4333-8333-333333333333';

function testLogger(): PluginHostLogger & { errors: unknown[] } {
  const errors: unknown[] = [];
  return {
    errors,
    info: vi.fn(),
    warn: vi.fn(),
    error: (obj: unknown) => errors.push(obj),
  };
}

/** Only the fields the plugin host reads. */
function hostConfig(entry: string, storyId: string): SourceBrokerConfig {
  return { sourceAdapterPluginEntry: entry, sourceAdapterStoryId: storyId } as SourceBrokerConfig;
}

describe('plugin-host — source-adapter seam', () => {
  it('no entry configured → no-op; stories resolve to the NullDataSource default', async () => {
    const registry = new SourceRegistry();
    await registry.load();
    const log = testLogger();

    await loadSourceAdapterPlugins(registry, hostConfig('', ''), log);

    expect(registry.getForStory(STORY)).toBeInstanceOf(NullDataSource);
    expect(log.errors).toHaveLength(0);
  });

  it('valid entry → adapter registered, initialized, and dispatched by the injected storyId', async () => {
    const registry = new SourceRegistry();
    await registry.load();
    const log = testLogger();

    await loadSourceAdapterPlugins(registry, hostConfig(FIXTURE_OK, STORY), log);

    const adapter = registry.getForStory(STORY);
    expect(adapter).not.toBeInstanceOf(NullDataSource);
    expect(adapter.config.slug).toBe('fake-source');
    // the host injected the deploy-configured story binding
    expect(adapter.config.storyId).toBe(STORY);
    // registry.register ran initialize()
    expect((adapter as unknown as { initialized: boolean }).initialized).toBe(true);
    // display index (by slug) is populated too
    expect(registry.get('fake-source')).toBe(adapter);
    expect(log.errors).toHaveLength(0);
  });

  it('entry without createDataSource() → fail-soft: error logged, NullDataSource kept', async () => {
    const registry = new SourceRegistry();
    await registry.load();
    const log = testLogger();

    await loadSourceAdapterPlugins(registry, hostConfig(FIXTURE_BROKEN, STORY), log);

    expect(registry.getForStory(STORY)).toBeInstanceOf(NullDataSource);
    expect(log.errors).toHaveLength(1);
  });

  it('nonexistent entry path → fail-soft: error logged, NullDataSource kept', async () => {
    const registry = new SourceRegistry();
    await registry.load();
    const log = testLogger();

    await loadSourceAdapterPlugins(registry, hostConfig('/does/not/exist.mjs', STORY), log);

    expect(registry.getForStory(STORY)).toBeInstanceOf(NullDataSource);
    expect(log.errors).toHaveLength(1);
  });

  it('adapter without storyId and no deploy storyId → fail-soft (undispatchable is a loud registry error)', async () => {
    const registry = new SourceRegistry();
    await registry.load();
    const log = testLogger();

    await loadSourceAdapterPlugins(registry, hostConfig(FIXTURE_OK, ''), log);

    expect(registry.getForStory(STORY)).toBeInstanceOf(NullDataSource);
    expect(log.errors).toHaveLength(1);
  });

  it('multi-entry list → two distinct sources register under two stories (delivery-notes + invoices shape)', async () => {
    const registry = new SourceRegistry();
    await registry.load();
    const log = testLogger();

    const config = {
      sourceAdapterPlugins: [
        { entry: FIXTURE_OK, storyId: STORY },
        { entry: FIXTURE_OK_2, storyId: STORY_2 },
      ],
    } as SourceBrokerConfig;
    await loadSourceAdapterPlugins(registry, config, log);

    expect(registry.getForStory(STORY).config.slug).toBe('fake-source');
    expect(registry.getForStory(STORY_2).config.slug).toBe('fake-source-2');
    expect(registry.get('fake-source')).not.toBeUndefined();
    expect(registry.get('fake-source-2')).not.toBeUndefined();
    expect(log.errors).toHaveLength(0);
  });

  it('multi-entry list → one broken entry fails soft, the sibling still registers', async () => {
    const registry = new SourceRegistry();
    await registry.load();
    const log = testLogger();

    const config = {
      sourceAdapterPlugins: [
        { entry: FIXTURE_BROKEN, storyId: STORY },
        { entry: FIXTURE_OK_2, storyId: STORY_2 },
      ],
    } as SourceBrokerConfig;
    await loadSourceAdapterPlugins(registry, config, log);

    expect(registry.getForStory(STORY)).toBeInstanceOf(NullDataSource); // broken → default
    expect(registry.getForStory(STORY_2).config.slug).toBe('fake-source-2'); // sibling unaffected
    expect(log.errors).toHaveLength(1);
  });

  it('list takes precedence over the scalar back-compat pair', async () => {
    const registry = new SourceRegistry();
    await registry.load();
    const log = testLogger();

    const config = {
      sourceAdapterPluginEntry: FIXTURE_OK, // scalar shorthand → should be IGNORED when list is set
      sourceAdapterStoryId: STORY,
      sourceAdapterPlugins: [{ entry: FIXTURE_OK_2, storyId: STORY_2 }],
    } as SourceBrokerConfig;
    await loadSourceAdapterPlugins(registry, config, log);

    expect(registry.getForStory(STORY)).toBeInstanceOf(NullDataSource); // scalar not used
    expect(registry.getForStory(STORY_2).config.slug).toBe('fake-source-2');
    expect(log.errors).toHaveLength(0);
  });
});
