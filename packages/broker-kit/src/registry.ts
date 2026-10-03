/**
 * registry.ts — the ONE story-indexed connector registry.
 *
 * Fixes the doctrine's biggest debt: before this, the read registry and the batch
 * scheduler were two disconnected objects (the scheduler hardcoded a source and
 * never consulted the registry). Here, read drivers, control targets, and the
 * scheduler tick ALL dispatch through the same registry, keyed by storyId.
 */
import type {
  ConnectorRegistry, ConnectorRegistryEntry, ReadDriver, IControlTarget,
} from '@aisha/audience-types';

export class InMemoryConnectorRegistry implements ConnectorRegistry {
  private readonly readers = new Map<string, ReadDriver>();
  private readonly controls = new Map<string, IControlTarget>();

  registerReader(storyId: string, driver: ReadDriver): void {
    if (!storyId) throw new Error('registerReader: storyId is required');
    this.readers.set(storyId, driver);
  }

  registerControl(storyId: string, target: IControlTarget): void {
    if (!storyId) throw new Error('registerControl: storyId is required');
    this.controls.set(storyId, target);
  }

  getReaderForStory(storyId: string): ReadDriver | undefined {
    return this.readers.get(storyId);
  }

  getControlForStory(storyId: string): IControlTarget | undefined {
    return this.controls.get(storyId);
  }

  /** Story ids with any registered driver — the scheduler ticks over exactly these. */
  storyIds(): string[] {
    return [...new Set([...this.readers.keys(), ...this.controls.keys()])];
  }

  list(): ConnectorRegistryEntry[] {
    return this.storyIds().map((storyId) => {
      const reader = this.readers.get(storyId);
      const control = this.controls.get(storyId);
      const kinds: Array<'read' | 'control'> = [];
      if (reader) kinds.push('read');
      if (control) kinds.push('control');
      return {
        storyId,
        slug: (reader ?? control)!.config.slug,
        kinds,
      };
    });
  }
}
