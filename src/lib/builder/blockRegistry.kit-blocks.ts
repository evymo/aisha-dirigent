/**
 * Neutral "design kit" web blocks for the AISHA Story Canvas builder (V2).
 *
 * These port distinctive *layouts* that the core 19 web blocks don't cover —
 * a channel/install card grid, mode cards, and value pillars with stat
 * callouts — but kept brand-neutral: only the recolorable `--sc-*` tokens,
 * generic placeholder copy, and `data-gjs-type` for in-editor editing. No
 * `data-i18n-key` (so no new web.* keys / locale-parity burden) and no
 * operator-specific branding (that lives only in the gitignored
 * domains/templates/aisha.guru/ presentation, never in shared platform code).
 *
 * Convention (enforced by builderBlockRegistry.test.ts):
 *  - nameKey        = builder.blocks.{blockType}.title
 *  - descriptionKey = builder.blocks.{blockType}.description
 *  - content contains the `aisha-{blockType}` class + ≥1 `data-gjs-type`
 *
 * @module
 */

import { Download, Boxes, Gauge } from "lucide-react";
import type { CanvasBlockEntryV2 } from "./blockRegistry.types";

/** Neutral, recolorable layout kit (category "web"). */
export const KIT_BLOCKS_V2: CanvasBlockEntryV2[] = [
  // ----- Install / channel card grid (4-up) -----
  {
    blockType: "install-grid",
    category: "web",
    descriptionKey: "builder.blocks.install-grid.description",
    icon: Download,
    nameKey: "builder.blocks.install-grid.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-install-grid" style="padding:64px 24px;background:var(--sc-surface-dark);color:var(--sc-white);">
      <div style="max-width:1100px;margin:0 auto;">
        <h2 data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;margin:0 0 8px;">Get started in one click</h2>
        <p data-gjs-type="text" style="color:var(--sc-text-light);max-width:48ch;margin:0 0 32px;">Pick a channel. Replace this copy with your own.</p>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
          <a data-gjs-type="link" href="#" style="display:block;padding:24px;background:var(--sc-ink);border:1px solid var(--sc-border);border-radius:10px;text-decoration:none;color:inherit;">
            <div style="width:40px;height:40px;border-radius:8px;background:var(--sc-brand-tint-15);margin-bottom:16px;"></div>
            <span data-gjs-type="text" style="display:block;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--sc-text-subtle);margin-bottom:6px;">Platform</span>
            <h3 data-gjs-type="text" style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">Channel One</h3>
            <p data-gjs-type="text" style="font-size:0.9rem;color:var(--sc-text-medium);margin:0 0 16px;">Short description of this install channel.</p>
            <span data-gjs-type="text" style="display:inline-block;padding:8px 16px;background:var(--sc-brand);color:var(--sc-white);border-radius:6px;font-weight:700;font-size:0.85rem;">Install</span>
          </a>
          <a data-gjs-type="link" href="#" style="display:block;padding:24px;background:var(--sc-ink);border:1px solid var(--sc-border);border-radius:10px;text-decoration:none;color:inherit;">
            <div style="width:40px;height:40px;border-radius:8px;background:var(--sc-brand-tint-15);margin-bottom:16px;"></div>
            <span data-gjs-type="text" style="display:block;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--sc-text-subtle);margin-bottom:6px;">Platform</span>
            <h3 data-gjs-type="text" style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">Channel Two</h3>
            <p data-gjs-type="text" style="font-size:0.9rem;color:var(--sc-text-medium);margin:0 0 16px;">Short description of this install channel.</p>
            <span data-gjs-type="text" style="display:inline-block;padding:8px 16px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:6px;font-weight:700;font-size:0.85rem;">Install</span>
          </a>
          <a data-gjs-type="link" href="#" style="display:block;padding:24px;background:var(--sc-ink);border:1px solid var(--sc-border);border-radius:10px;text-decoration:none;color:inherit;">
            <div style="width:40px;height:40px;border-radius:8px;background:var(--sc-brand-tint-15);margin-bottom:16px;"></div>
            <span data-gjs-type="text" style="display:block;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--sc-text-subtle);margin-bottom:6px;">Platform</span>
            <h3 data-gjs-type="text" style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">Channel Three</h3>
            <p data-gjs-type="text" style="font-size:0.9rem;color:var(--sc-text-medium);margin:0 0 16px;">Short description of this install channel.</p>
            <span data-gjs-type="text" style="display:inline-block;padding:8px 16px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:6px;font-weight:700;font-size:0.85rem;">Install</span>
          </a>
          <a data-gjs-type="link" href="#" style="display:block;padding:24px;background:var(--sc-ink);border:1px solid var(--sc-border);border-radius:10px;text-decoration:none;color:inherit;">
            <div style="width:40px;height:40px;border-radius:8px;background:var(--sc-brand-tint-15);margin-bottom:16px;"></div>
            <span data-gjs-type="text" style="display:block;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--sc-text-subtle);margin-bottom:6px;">Platform</span>
            <h3 data-gjs-type="text" style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">Channel Four</h3>
            <p data-gjs-type="text" style="font-size:0.9rem;color:var(--sc-text-medium);margin:0 0 16px;">Short description of this install channel.</p>
            <span data-gjs-type="text" style="display:inline-block;padding:8px 16px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:6px;font-weight:700;font-size:0.85rem;">Install</span>
          </a>
        </div>
      </div>
    </section>`,
      },
    ],
  },

  // ----- Mode cards (4-up, rail + tag + chips) -----
  {
    blockType: "modes",
    category: "web",
    descriptionKey: "builder.blocks.modes.description",
    icon: Boxes,
    nameKey: "builder.blocks.modes.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-modes" style="padding:64px 24px;background:var(--sc-ink);color:var(--sc-white);">
      <div style="max-width:1100px;margin:0 auto;">
        <h2 data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;margin:0 0 32px;">Four ways to use it</h2>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
          <div style="padding:28px;background:var(--sc-surface-dark);border:1px solid var(--sc-border);border-radius:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><span data-gjs-type="text" style="font-weight:800;color:var(--sc-brand);">01</span><span data-gjs-type="text" style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--sc-text-subtle);">tag</span></div>
            <h3 data-gjs-type="text" style="font-size:1.3rem;font-weight:800;margin:0 0 10px;">Mode One</h3>
            <p data-gjs-type="text" style="color:var(--sc-text-medium);margin:0 0 16px;">Describe this mode of operation in a sentence or two.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;"><span data-gjs-type="text" style="padding:4px 12px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:20px;font-size:0.8rem;">chip</span><span data-gjs-type="text" style="padding:4px 12px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:20px;font-size:0.8rem;">chip</span></div>
          </div>
          <div style="padding:28px;background:var(--sc-surface-dark);border:1px solid var(--sc-brand);border-radius:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><span data-gjs-type="text" style="font-weight:800;color:var(--sc-brand);">02</span><span data-gjs-type="text" style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--sc-text-subtle);">tag</span></div>
            <h3 data-gjs-type="text" style="font-size:1.3rem;font-weight:800;margin:0 0 10px;">Mode Two</h3>
            <p data-gjs-type="text" style="color:var(--sc-text-medium);margin:0 0 16px;">Describe this mode of operation in a sentence or two.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;"><span data-gjs-type="text" style="padding:4px 12px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:20px;font-size:0.8rem;">chip</span><span data-gjs-type="text" style="padding:4px 12px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:20px;font-size:0.8rem;">chip</span></div>
          </div>
          <div style="padding:28px;background:var(--sc-surface-dark);border:1px solid var(--sc-border);border-radius:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><span data-gjs-type="text" style="font-weight:800;color:var(--sc-brand);">03</span><span data-gjs-type="text" style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--sc-text-subtle);">tag</span></div>
            <h3 data-gjs-type="text" style="font-size:1.3rem;font-weight:800;margin:0 0 10px;">Mode Three</h3>
            <p data-gjs-type="text" style="color:var(--sc-text-medium);margin:0 0 16px;">Describe this mode of operation in a sentence or two.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;"><span data-gjs-type="text" style="padding:4px 12px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:20px;font-size:0.8rem;">chip</span><span data-gjs-type="text" style="padding:4px 12px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:20px;font-size:0.8rem;">chip</span></div>
          </div>
          <div style="padding:28px;background:var(--sc-surface-dark);border:1px solid var(--sc-border);border-radius:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><span data-gjs-type="text" style="font-weight:800;color:var(--sc-brand);">04</span><span data-gjs-type="text" style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--sc-text-subtle);">tag</span></div>
            <h3 data-gjs-type="text" style="font-size:1.3rem;font-weight:800;margin:0 0 10px;">Mode Four</h3>
            <p data-gjs-type="text" style="color:var(--sc-text-medium);margin:0 0 16px;">Describe this mode of operation in a sentence or two.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;"><span data-gjs-type="text" style="padding:4px 12px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:20px;font-size:0.8rem;">chip</span><span data-gjs-type="text" style="padding:4px 12px;background:var(--sc-surface-light);color:var(--sc-text-body);border-radius:20px;font-size:0.8rem;">chip</span></div>
          </div>
        </div>
      </div>
    </section>`,
      },
    ],
  },

  // ----- Value pillars with stat callouts (3-up) -----
  {
    blockType: "cost-pillars",
    category: "web",
    descriptionKey: "builder.blocks.cost-pillars.description",
    icon: Gauge,
    nameKey: "builder.blocks.cost-pillars.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-cost-pillars" style="padding:64px 24px;background:var(--sc-surface-lighter);color:var(--sc-text-body);">
      <div style="max-width:1100px;margin:0 auto;">
        <h2 data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;margin:0 0 32px;">Three levers</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;">
          <div style="padding:28px;background:var(--sc-white);border:1px solid var(--sc-border);border-radius:10px;">
            <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px;"><span data-gjs-type="text" style="font-weight:800;color:var(--sc-brand);font-size:1.1rem;">01</span><h3 data-gjs-type="text" style="font-size:1.2rem;font-weight:800;margin:0;">Lever One</h3></div>
            <p data-gjs-type="text" style="color:var(--sc-text-medium);margin:0 0 20px;">Explain the first lever and the value it delivers.</p>
            <div style="padding-top:16px;border-top:1px solid var(--sc-border);"><div data-gjs-type="text" style="font-size:2rem;font-weight:800;color:var(--sc-brand);">50%</div><div data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-muted);">metric label</div></div>
          </div>
          <div style="padding:28px;background:var(--sc-white);border:2px solid var(--sc-brand);border-radius:10px;">
            <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px;"><span data-gjs-type="text" style="font-weight:800;color:var(--sc-brand);font-size:1.1rem;">02</span><h3 data-gjs-type="text" style="font-size:1.2rem;font-weight:800;margin:0;">Lever Two</h3></div>
            <p data-gjs-type="text" style="color:var(--sc-text-medium);margin:0 0 20px;">Explain the second lever and the value it delivers.</p>
            <div style="padding-top:16px;border-top:1px solid var(--sc-border);"><div data-gjs-type="text" style="font-size:2rem;font-weight:800;color:var(--sc-brand);">$0</div><div data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-muted);">metric label</div></div>
          </div>
          <div style="padding:28px;background:var(--sc-white);border:1px solid var(--sc-border);border-radius:10px;">
            <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px;"><span data-gjs-type="text" style="font-weight:800;color:var(--sc-brand);font-size:1.1rem;">03</span><h3 data-gjs-type="text" style="font-size:1.2rem;font-weight:800;margin:0;">Lever Three</h3></div>
            <p data-gjs-type="text" style="color:var(--sc-text-medium);margin:0 0 20px;">Explain the third lever and the value it delivers.</p>
            <div style="padding-top:16px;border-top:1px solid var(--sc-border);"><div data-gjs-type="text" style="font-size:2rem;font-weight:800;color:var(--sc-brand);">3–6×</div><div data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-muted);">metric label</div></div>
          </div>
        </div>
      </div>
    </section>`,
      },
    ],
  },
];
