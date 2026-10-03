/**
 * plugin-host — loads an out-of-tree source-adapter plugin into the
 * SourceRegistry at boot. This is the seam the registry's docstring promises
 * ("each fork registers its own adapter … a plugin") made real: the platform
 * owns this loader, a fork owns its adapter PACKAGE — no fork-specific source
 * knowledge ever enters the broker tree (upstream-clean forks).
 *
 * Runtime model — in-process, deliberately NOT the svc-plugin-system sandbox:
 * a source adapter holds a long-lived, least-privilege DB session (raw pg wire
 * protocol) and implements the long-lived IDataSource lifecycle
 * (initialize/getEntity/probe/shutdown) with a per-request SourceConnection.
 * The plugin sandbox is fail-closed https-only fetch with single-shot
 * handle(capability) execution — the right cage for untrusted compute, the
 * wrong shape for a data source. The adapter package remains ecosystem-
 * governed (plugin_catalog / versions / kill-switch via svc-plugin-system);
 * only its LOADING is in-process, and only from a deploy-time operator-
 * configured entry path (never user input).
 *
 * Fail-soft: any load/registration error is logged loudly and the registry
 * keeps its NullDataSource fallback, so the affected stories answer
 * 501 not_configured — the broker never crashes over an optional capability
 * (same optionality model as a missing LLM key). A configured-but-broken
 * adapter then fails LOUD per request via the route (502), not silently.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DataSourceConfig, SourceAdapterModule } from '@aisha/audience-types';
import type { SourceRegistry } from './source-registry.js';
import type { SourceBrokerConfig } from '../config.js';

/** Structural logger slice (pino-compatible) so the host stays dependency-light. */
export interface PluginHostLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/**
 * Resolve the source-adapter plugins to load. The multi-entry list
 * (SOURCE_ADAPTER_PLUGINS) is the general form; the scalar
 * SOURCE_ADAPTER_PLUGIN_ENTRY/STORY_ID pair is a back-compat single-entry
 * shorthand, used only when the list is empty. Two independent sources on one
 * broker (Money delivery-notes + invoices), or one entry bound to several stories
 * (one Money URL, several accounting entities/agendy), are both expressed here.
 */
function resolveAdapterPlugins(config: SourceBrokerConfig): Array<{ entry: string; storyId: string }> {
  const list = config.sourceAdapterPlugins ?? [];
  if (list.length > 0) return list;
  const entry = config.sourceAdapterPluginEntry;
  return entry ? [{ entry, storyId: config.sourceAdapterStoryId ?? '' }] : [];
}

/** Load + register ONE adapter entry. Fail-SOFT: a bad entry is logged and skipped
 *  so it never takes down siblings or the broker (affected stories answer 501). */
async function registerOne(
  registry: SourceRegistry,
  entry: string,
  storyId: string,
  log: PluginHostLogger,
): Promise<void> {
  try {
    const entryUrl = pathToFileURL(path.resolve(entry)).href;
    const mod = (await import(entryUrl)) as Partial<SourceAdapterModule>;
    if (typeof mod.createDataSource !== 'function') {
      throw new Error(
        `source-adapter entry '${entry}' does not export createDataSource() — ` +
          'see SourceAdapterModule in @aisha/audience-types',
      );
    }

    const ds = mod.createDataSource();

    // The story binding is deployment config, not package code: inject the
    // deploy-configured storyId unless the adapter already declared one.
    // (registry.register fails loud on a missing storyId — undispatchable.)
    if (!ds.config.storyId && storyId) {
      (ds.config as DataSourceConfig).storyId = storyId;
    }

    await registry.register(ds);
    log.info(
      { seam: 'source-adapter', slug: ds.config.slug, storyId: ds.config.storyId, entry },
      'source-adapter plugin registered',
    );
  } catch (err) {
    log.error(
      { seam: 'source-adapter', entry, err },
      'source-adapter plugin failed to load — keeping NullDataSource fallback (affected stories answer 501 not_configured)',
    );
  }
}

/**
 * Load the configured source-adapter plugin(s) (if any) and register each.
 * No-op when nothing is configured — live source reads are OPTIONAL and every
 * story then resolves to the NullDataSource default. Each entry loads
 * independently (fail-soft), so one broken adapter never suppresses the others.
 */
export async function loadSourceAdapterPlugins(
  registry: SourceRegistry,
  config: SourceBrokerConfig,
  log: PluginHostLogger,
): Promise<void> {
  const plugins = resolveAdapterPlugins(config);
  if (plugins.length === 0) {
    log.info(
      { seam: 'source-adapter' },
      'no source-adapter plugin configured (SOURCE_ADAPTER_PLUGINS / SOURCE_ADAPTER_PLUGIN_ENTRY empty) — live /source reads stay optional (NullDataSource)',
    );
    return;
  }

  for (const { entry, storyId } of plugins) {
    await registerOne(registry, entry, storyId, log);
  }
}
