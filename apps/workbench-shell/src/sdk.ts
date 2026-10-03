/**
  * @aisha/extranet-sdk-ui ⇄ React 18 bridge — jediné místo, kde se shell dotýká SDK.
 *
 * The SDK is buildless ESM with no side effects; custom elements register only
 * when defineAll() runs, and React 18 needs the kit to bridge
 * `data` properties and `es-*` events (React 19 would do both natively).
 * Importing THIS module both registers the elements and exports the kit, so a
 * component file never has to know the mechanics — and the registration cannot
 * be forgotten, because using any component forces the import.
 *
 * SSR note (render tests): elements.js guards HTMLElement, so importing under
 * node is safe; defineAll() is skipped where customElements is absent. In
 * renderToStaticMarkup the es-* tags render as inert tags — the render tests
 * therefore assert the DATA HANDED TO the elements (props/attributes), which is
 * the property worth pinning anyway: what the block claims, not how the element
 * paints it.
 */
import * as React from 'react';
import { defineAll } from '@aisha/extranet-sdk-ui';
import { reactKit, type Kit } from '@aisha/extranet-sdk-ui/react';
// mc.js registers <story-loop-mc> on import (guarded when customElements is
// absent) — the kit's MissionControl assumes somebody imported it.
import '@aisha/extranet-sdk-ui/mc';

if (typeof customElements !== 'undefined') defineAll();

/**
 * ⭐ Kit se NEVYPISUJE — od 0.3.0 je typ Kit GENEROVANÝ z registru jazyka
 * (types/kit.d.ts v balíku) a reactKit je smyčka nad týmž registrem. Lokální
 * kopie typu i ruční MissionControl wrap (props tasks/phases/labels) zanikly:
 * registr je nese sám. Shell tak nemá CO rozejít.
 */
export const Es: Kit = reactKit(React);
export type { Kit };
