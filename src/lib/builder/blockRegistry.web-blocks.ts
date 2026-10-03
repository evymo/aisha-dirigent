/**
 * Web block definitions for the AISHA Story Canvas builder (V2, variant-aware).
 *
 * 26 blocks: hero, trust-bar, pillars, how-it-works, about, specialist-guild,
 * hiring, stats-counter, features, pricing, cta, testimonials, faq, footer,
 * contact, project-configurator, timeline, data-table, ordered-list,
 * install-grid, modes, cost-pillars, process-loop, layer-stack, signal-cards,
 * announcement-bar (last 7 ported & neutralised from the aisha.guru template).
 *
 * @module
 */

import {
  Layout,
  Award,
  Columns3,
  ArrowRight,
  Info,
  Users,
  Briefcase,
  BarChart3,
  Grid3X3,
  DollarSign,
  MousePointerClick,
  MessageSquareQuote,
  HelpCircle,
  PanelBottom,
  Mail,
  Calculator,
  Clock,
  Table,
  ListOrdered,
  Download,
  RefreshCw,
  Layers,
  Activity,
  Megaphone,
} from "lucide-react";
import type { CanvasBlockEntryV2 } from "./blockRegistry.types";

/** Web blocks for the AISHA Story Canvas (V2 with variants). */
export const WEB_BLOCKS_V2: CanvasBlockEntryV2[] = [
  // ----- Web blocks (19) -----
  {
    blockType: "hero",
    category: "web",
    descriptionKey: "builder.blocks.hero.description",
    icon: Layout,
    nameKey: "builder.blocks.hero.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-hero" style="padding:80px 24px 64px;text-align:center;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);position:relative;overflow:hidden;">
      <div style="max-width:800px;margin:0 auto;position:relative;z-index:1;">
        <span data-i18n-key="web.hero.badge" style="display:inline-block;padding:6px 16px;background:var(--sc-brand-tint-15);color:var(--sc-brand);border-radius:20px;font-size:0.85rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:24px;">Badge Text</span>
        <h1 data-i18n-key="web.hero.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:3.2rem;font-weight:800;line-height:1.1;margin:0 0 16px;text-transform:uppercase;">Hero Title</h1>
        <p data-i18n-key="web.hero.subtitle" data-gjs-type="text" style="font-size:1.2rem;color:var(--sc-text-light);max-width:600px;margin:0 auto 32px;">Subtitle text goes here</p>
        <a data-i18n-key="web.hero.cta.contact" class="aisha-btn" href="#contact" data-gjs-type="link" style="display:inline-block;padding:14px 32px;background:var(--sc-brand);color:var(--sc-white);border-radius:6px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;transform:skewX(-2deg);">Get Started</a>
      </div>
    </section>`,
      },
      {
        id: "split-left",
        labelKey: "builder.variants.hero.splitLeft",
        content: `<section class="aisha-hero" style="padding:80px 24px 64px;background:linear-gradient(135deg,var(--sc-ink) 0%,var(--sc-surface-dark) 100%);color:var(--sc-white);position:relative;overflow:hidden;">
      <div style="max-width:1000px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;">
        <div>
          <span data-i18n-key="web.hero.badge" style="display:inline-block;padding:6px 16px;background:var(--sc-brand-tint-15);color:var(--sc-brand);border-radius:20px;font-size:0.85rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:24px;">Badge Text</span>
          <h1 data-i18n-key="web.hero.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:3.2rem;font-weight:800;line-height:1.1;margin:0 0 16px;text-transform:uppercase;">Hero Title</h1>
          <p data-i18n-key="web.hero.subtitle" data-gjs-type="text" style="font-size:1.2rem;color:var(--sc-text-light);margin:0 0 32px;">Subtitle text goes here</p>
          <a data-i18n-key="web.hero.cta.contact" class="aisha-btn" href="#contact" data-gjs-type="link" style="display:inline-block;padding:14px 32px;background:var(--sc-brand);color:var(--sc-white);border-radius:6px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;transform:skewX(-2deg);">Get Started</a>
        </div>
        <div style="background:var(--sc-surface-dark);border-radius:12px;min-height:300px;display:flex;align-items:center;justify-content:center;border:1px solid var(--sc-border);">
          <span style="color:var(--sc-text-subtle);font-size:0.9rem;">Image / Media placeholder</span>
        </div>
      </div>
    </section>`,
      },
      {
        id: "minimal",
        labelKey: "builder.variants.hero.minimal",
        content: `<section class="aisha-hero" style="padding:120px 24px 80px;background:var(--sc-ink);color:var(--sc-white);text-align:center;position:relative;overflow:hidden;">
      <div style="max-width:700px;margin:0 auto;">
        <span data-i18n-key="web.hero.badge" style="display:inline-block;padding:6px 16px;background:var(--sc-brand-tint-15);color:var(--sc-brand);border-radius:20px;font-size:0.85rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:24px;">Badge Text</span>
        <h1 data-i18n-key="web.hero.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:4rem;font-weight:800;line-height:1.05;margin:0 0 20px;">Hero Title</h1>
        <p data-i18n-key="web.hero.subtitle" data-gjs-type="text" style="font-size:1.15rem;color:var(--sc-text-subtle);max-width:500px;margin:0 auto 40px;line-height:1.6;">Subtitle text goes here</p>
        <a data-i18n-key="web.hero.cta.contact" class="aisha-btn" href="#contact" data-gjs-type="link" style="display:inline-block;padding:16px 40px;background:var(--sc-brand);color:var(--sc-white);border-radius:6px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Get Started</a>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "trust-bar",
    category: "web",
    descriptionKey: "builder.blocks.trust-bar.description",
    icon: Award,
    nameKey: "builder.blocks.trust-bar.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-trust-bar" style="padding:32px 24px;background:var(--sc-surface-lighter);border-top:3px solid var(--sc-brand);">
      <div style="max-width:1000px;margin:0 auto;">
        <h3 data-i18n-key="web.trust.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--sc-text-muted);margin:0 0 24px;">Industries Where We Have Real Results</h3>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:16px;text-align:center;">
          <div style="padding:12px;"><span style="font-size:0.8rem;color:var(--sc-text-medium);font-weight:600;" data-i18n-key="web.trust.domain.audit" data-gjs-type="text">Audit</span></div>
          <div style="padding:12px;"><span style="font-size:0.8rem;color:var(--sc-text-medium);font-weight:600;" data-i18n-key="web.trust.domain.automotive" data-gjs-type="text">Automotive</span></div>
          <div style="padding:12px;"><span style="font-size:0.8rem;color:var(--sc-text-medium);font-weight:600;" data-i18n-key="web.trust.domain.hosting" data-gjs-type="text">Hosting</span></div>
          <div style="padding:12px;"><span style="font-size:0.8rem;color:var(--sc-text-medium);font-weight:600;" data-i18n-key="web.trust.domain.biotech" data-gjs-type="text">Biotech</span></div>
          <div style="padding:12px;"><span style="font-size:0.8rem;color:var(--sc-text-medium);font-weight:600;" data-i18n-key="web.trust.domain.distribution" data-gjs-type="text">Distribution</span></div>
          <div style="padding:12px;"><span style="font-size:0.8rem;color:var(--sc-text-medium);font-weight:600;" data-i18n-key="web.trust.domain.legal" data-gjs-type="text">Legal</span></div>
        </div>
      </div>
    </section>`,
      },
      {
        id: "stat-bar",
        labelKey: "builder.variants.trust-bar.statBar",
        content: `<section class="aisha-trust-bar" style="padding:32px 24px;background:var(--sc-ink);border-top:3px solid var(--sc-brand);">
      <div style="max-width:1000px;margin:0 auto;">
        <h3 data-i18n-key="web.trust.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--sc-text-subtle);margin:0 0 24px;">Industries Where We Have Real Results</h3>
        <div style="display:flex;justify-content:center;gap:32px;flex-wrap:wrap;">
          <div style="padding:12px 20px;background:var(--sc-surface-dark);border-radius:6px;text-align:center;"><span style="font-size:0.8rem;color:var(--sc-text-light);font-weight:600;" data-i18n-key="web.trust.domain.audit" data-gjs-type="text">Audit</span></div>
          <div style="padding:12px 20px;background:var(--sc-surface-dark);border-radius:6px;text-align:center;"><span style="font-size:0.8rem;color:var(--sc-text-light);font-weight:600;" data-i18n-key="web.trust.domain.automotive" data-gjs-type="text">Automotive</span></div>
          <div style="padding:12px 20px;background:var(--sc-surface-dark);border-radius:6px;text-align:center;"><span style="font-size:0.8rem;color:var(--sc-text-light);font-weight:600;" data-i18n-key="web.trust.domain.hosting" data-gjs-type="text">Hosting</span></div>
          <div style="padding:12px 20px;background:var(--sc-surface-dark);border-radius:6px;text-align:center;"><span style="font-size:0.8rem;color:var(--sc-text-light);font-weight:600;" data-i18n-key="web.trust.domain.biotech" data-gjs-type="text">Biotech</span></div>
          <div style="padding:12px 20px;background:var(--sc-surface-dark);border-radius:6px;text-align:center;"><span style="font-size:0.8rem;color:var(--sc-text-light);font-weight:600;" data-i18n-key="web.trust.domain.distribution" data-gjs-type="text">Distribution</span></div>
          <div style="padding:12px 20px;background:var(--sc-surface-dark);border-radius:6px;text-align:center;"><span style="font-size:0.8rem;color:var(--sc-text-light);font-weight:600;" data-i18n-key="web.trust.domain.legal" data-gjs-type="text">Legal</span></div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "pillars",
    category: "web",
    descriptionKey: "builder.blocks.pillars.description",
    icon: Columns3,
    nameKey: "builder.blocks.pillars.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-pillars" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:1000px;margin:0 auto;">
        <h2 data-i18n-key="web.pillars.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 48px;color:var(--sc-ink);">Adopt. Adapt. Run it your way.</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:32px;">
          <div style="padding:24px;border-left:3px solid var(--sc-brand);">
            <h3 data-i18n-key="web.pillars.1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0 0 12px;color:var(--sc-ink);">Pillar 1</h3>
            <p data-i18n-key="web.pillars.1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.6;margin:0;">Description</p>
          </div>
          <div style="padding:24px;border-left:3px solid var(--sc-brand);">
            <h3 data-i18n-key="web.pillars.2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0 0 12px;color:var(--sc-ink);">Pillar 2</h3>
            <p data-i18n-key="web.pillars.2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.6;margin:0;">Description</p>
          </div>
          <div style="padding:24px;border-left:3px solid var(--sc-brand);">
            <h3 data-i18n-key="web.pillars.3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0 0 12px;color:var(--sc-ink);">Pillar 3</h3>
            <p data-i18n-key="web.pillars.3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.6;margin:0;">Description</p>
          </div>
        </div>
      </div>
    </section>`,
      },
      {
        id: "border-list",
        labelKey: "builder.variants.pillars.borderList",
        content: `<section class="aisha-pillars" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:700px;margin:0 auto;">
        <h2 data-i18n-key="web.pillars.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 48px;color:var(--sc-ink);">Adopt. Adapt. Run it your way.</h2>
        <div style="display:flex;flex-direction:column;gap:24px;">
          <div style="padding:20px 24px;border-left:4px solid var(--sc-brand);background:var(--sc-surface-light);border-radius:0 8px 8px 0;">
            <h3 data-i18n-key="web.pillars.1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0 0 8px;color:var(--sc-ink);">Pillar 1</h3>
            <p data-i18n-key="web.pillars.1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.6;margin:0;">Description</p>
          </div>
          <div style="padding:20px 24px;border-left:4px solid var(--sc-brand);background:var(--sc-surface-light);border-radius:0 8px 8px 0;">
            <h3 data-i18n-key="web.pillars.2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0 0 8px;color:var(--sc-ink);">Pillar 2</h3>
            <p data-i18n-key="web.pillars.2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.6;margin:0;">Description</p>
          </div>
          <div style="padding:20px 24px;border-left:4px solid var(--sc-brand);background:var(--sc-surface-light);border-radius:0 8px 8px 0;">
            <h3 data-i18n-key="web.pillars.3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;font-size:1.1rem;margin:0 0 8px;color:var(--sc-ink);">Pillar 3</h3>
            <p data-i18n-key="web.pillars.3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.6;margin:0;">Description</p>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "how-it-works",
    category: "web",
    descriptionKey: "builder.blocks.how-it-works.description",
    icon: ArrowRight,
    nameKey: "builder.blocks.how-it-works.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-how-it-works" style="padding:64px 24px;background:var(--sc-surface-light);">
      <div style="max-width:900px;margin:0 auto;">
        <h2 data-i18n-key="web.how.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 48px;color:var(--sc-ink);">How it works</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px;">
          <div style="text-align:center;padding:16px;">
            <div style="width:48px;height:48px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-weight:800;font-size:1.2rem;">1</div>
            <h4 data-i18n-key="web.how.step1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Step 1</h4>
            <p data-i18n-key="web.how.step1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="text-align:center;padding:16px;">
            <div style="width:48px;height:48px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-weight:800;font-size:1.2rem;">2</div>
            <h4 data-i18n-key="web.how.step2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Step 2</h4>
            <p data-i18n-key="web.how.step2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="text-align:center;padding:16px;">
            <div style="width:48px;height:48px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-weight:800;font-size:1.2rem;">3</div>
            <h4 data-i18n-key="web.how.step3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Step 3</h4>
            <p data-i18n-key="web.how.step3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="text-align:center;padding:16px;">
            <div style="width:48px;height:48px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-weight:800;font-size:1.2rem;">4</div>
            <h4 data-i18n-key="web.how.step4.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Step 4</h4>
            <p data-i18n-key="web.how.step4.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
        </div>
      </div>
    </section>`,
      },
      {
        id: "timeline-steps",
        labelKey: "builder.variants.how-it-works.timelineSteps",
        content: `<section class="aisha-how-it-works" style="padding:64px 24px;background:var(--sc-surface-light);">
      <div style="max-width:700px;margin:0 auto;">
        <h2 data-i18n-key="web.how.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 48px;color:var(--sc-ink);">How it works</h2>
        <div style="display:flex;flex-direction:column;gap:0;border-left:3px solid var(--sc-brand);padding-left:32px;">
          <div style="position:relative;padding-bottom:32px;">
            <div style="position:absolute;left:-41px;top:0;width:20px;height:20px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.7rem;">1</div>
            <h4 data-i18n-key="web.how.step1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Step 1</h4>
            <p data-i18n-key="web.how.step1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="position:relative;padding-bottom:32px;">
            <div style="position:absolute;left:-41px;top:0;width:20px;height:20px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.7rem;">2</div>
            <h4 data-i18n-key="web.how.step2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Step 2</h4>
            <p data-i18n-key="web.how.step2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="position:relative;padding-bottom:32px;">
            <div style="position:absolute;left:-41px;top:0;width:20px;height:20px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.7rem;">3</div>
            <h4 data-i18n-key="web.how.step3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Step 3</h4>
            <p data-i18n-key="web.how.step3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="position:relative;">
            <div style="position:absolute;left:-41px;top:0;width:20px;height:20px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.7rem;">4</div>
            <h4 data-i18n-key="web.how.step4.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Step 4</h4>
            <p data-i18n-key="web.how.step4.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "about",
    category: "web",
    descriptionKey: "builder.blocks.about.description",
    icon: Info,
    nameKey: "builder.blocks.about.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-about" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:900px;margin:0 auto;">
        <h2 data-i18n-key="web.about.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 16px;color:var(--sc-ink);">About Us</h2>
        <p data-i18n-key="web.about.intro" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.7;margin:0 0 40px;font-size:1.05rem;">Introduction paragraph</p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;">
          <div style="padding:20px;background:var(--sc-surface-light);border-radius:8px;border-top:3px solid var(--sc-brand);">
            <h4 data-i18n-key="web.about.value1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Value 1</h4>
            <p data-i18n-key="web.about.value1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="padding:20px;background:var(--sc-surface-light);border-radius:8px;border-top:3px solid var(--sc-brand);">
            <h4 data-i18n-key="web.about.value2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Value 2</h4>
            <p data-i18n-key="web.about.value2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="padding:20px;background:var(--sc-surface-light);border-radius:8px;border-top:3px solid var(--sc-brand);">
            <h4 data-i18n-key="web.about.value3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Value 3</h4>
            <p data-i18n-key="web.about.value3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
        </div>
      </div>
    </section>`,
      },
      {
        id: "prose-centered",
        labelKey: "builder.variants.about.proseCentered",
        content: `<section class="aisha-about" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:700px;margin:0 auto;text-align:center;">
        <h2 data-i18n-key="web.about.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 16px;color:var(--sc-ink);">About Us</h2>
        <p data-i18n-key="web.about.intro" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.7;margin:0 0 40px;font-size:1.05rem;">Introduction paragraph</p>
        <div style="display:flex;flex-direction:column;gap:24px;text-align:left;">
          <div style="padding:20px;border-bottom:2px solid var(--sc-brand);">
            <h4 data-i18n-key="web.about.value1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Value 1</h4>
            <p data-i18n-key="web.about.value1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="padding:20px;border-bottom:2px solid var(--sc-brand);">
            <h4 data-i18n-key="web.about.value2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Value 2</h4>
            <p data-i18n-key="web.about.value2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="padding:20px;border-bottom:2px solid var(--sc-brand);">
            <h4 data-i18n-key="web.about.value3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Value 3</h4>
            <p data-i18n-key="web.about.value3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "specialist-guild",
    category: "web",
    descriptionKey: "builder.blocks.specialist-guild.description",
    icon: Users,
    nameKey: "builder.blocks.specialist-guild.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-specialist-guild" style="padding:64px 24px;background:var(--sc-ink);color:var(--sc-white);">
      <div style="max-width:1000px;margin:0 auto;text-align:center;">
        <h2 data-i18n-key="web.guild.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 16px;">Find the right specialist</h2>
        <p data-i18n-key="web.guild.subtitle" data-gjs-type="text" style="color:var(--sc-text-subtle);max-width:700px;margin:0 auto 40px;line-height:1.6;">Subtitle</p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;">
          <div style="padding:24px;background:var(--sc-surface-dark);border-radius:8px;border-top:3px solid var(--sc-brand);">
            <h4 data-gjs-type="text" style="color:var(--sc-brand);font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;">Starter</h4>
            <p data-gjs-type="text" style="color:var(--sc-text-light);font-size:0.9rem;margin:0;">Community projects, entry-level</p>
          </div>
          <div style="padding:24px;background:var(--sc-surface-dark);border-radius:8px;border-top:3px solid var(--sc-brand);">
            <h4 data-gjs-type="text" style="color:var(--sc-brand);font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;">Professional</h4>
            <p data-gjs-type="text" style="color:var(--sc-text-light);font-size:0.9rem;margin:0;">Advanced analytics + priority matching</p>
          </div>
          <div style="padding:24px;background:var(--sc-surface-dark);border-radius:8px;border-top:3px solid var(--sc-brand);">
            <h4 data-gjs-type="text" style="color:var(--sc-brand);font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;">Enterprise</h4>
            <p data-gjs-type="text" style="color:var(--sc-text-light);font-size:0.9rem;margin:0;">SLA guarantees, dedicated conductor</p>
          </div>
        </div>
        <a data-i18n-key="web.guild.cta" class="aisha-btn" href="/guild" data-gjs-type="link" style="display:inline-block;margin-top:32px;padding:14px 32px;background:var(--sc-brand);color:var(--sc-white);border-radius:6px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Browse the Guild</a>
      </div>
    </section>`,
      },
      {
        id: "horizontal-bar",
        labelKey: "builder.variants.specialist-guild.horizontalBar",
        content: `<section class="aisha-specialist-guild" style="padding:64px 24px;background:var(--sc-ink);color:var(--sc-white);">
      <div style="max-width:1000px;margin:0 auto;">
        <h2 data-i18n-key="web.guild.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 16px;">Find the right specialist</h2>
        <p data-i18n-key="web.guild.subtitle" data-gjs-type="text" style="color:var(--sc-text-subtle);max-width:700px;margin:0 0 40px;line-height:1.6;">Subtitle</p>
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;align-items:center;gap:24px;padding:20px 24px;background:var(--sc-surface-dark);border-radius:8px;border-left:4px solid var(--sc-brand);">
            <h4 data-gjs-type="text" style="color:var(--sc-brand);font-family:var(--sc-font-family);font-weight:700;margin:0;min-width:120px;">Starter</h4>
            <p data-gjs-type="text" style="color:var(--sc-text-light);font-size:0.9rem;margin:0;">Community projects, entry-level</p>
          </div>
          <div style="display:flex;align-items:center;gap:24px;padding:20px 24px;background:var(--sc-surface-dark);border-radius:8px;border-left:4px solid var(--sc-brand);">
            <h4 data-gjs-type="text" style="color:var(--sc-brand);font-family:var(--sc-font-family);font-weight:700;margin:0;min-width:120px;">Professional</h4>
            <p data-gjs-type="text" style="color:var(--sc-text-light);font-size:0.9rem;margin:0;">Advanced analytics + priority matching</p>
          </div>
          <div style="display:flex;align-items:center;gap:24px;padding:20px 24px;background:var(--sc-surface-dark);border-radius:8px;border-left:4px solid var(--sc-brand);">
            <h4 data-gjs-type="text" style="color:var(--sc-brand);font-family:var(--sc-font-family);font-weight:700;margin:0;min-width:120px;">Enterprise</h4>
            <p data-gjs-type="text" style="color:var(--sc-text-light);font-size:0.9rem;margin:0;">SLA guarantees, dedicated conductor</p>
          </div>
        </div>
        <a data-i18n-key="web.guild.cta" class="aisha-btn" href="/guild" data-gjs-type="link" style="display:inline-block;margin-top:32px;padding:14px 32px;background:var(--sc-brand);color:var(--sc-white);border-radius:6px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Browse the Guild</a>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "hiring",
    category: "web",
    descriptionKey: "builder.blocks.hiring.description",
    icon: Briefcase,
    nameKey: "builder.blocks.hiring.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-hiring" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:1000px;margin:0 auto;">
        <span data-i18n-key="web.hiring.badge" style="display:inline-block;padding:6px 16px;background:var(--sc-brand-tint-10);color:var(--sc-brand);border-radius:20px;font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:16px;">Join the Guild</span>
        <h2 data-i18n-key="web.hiring.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:1.8rem;font-weight:800;text-transform:uppercase;margin:0 0 32px;color:var(--sc-ink);">For specialists and experts</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;">
          <div style="padding:24px;border:1px solid var(--sc-border);border-radius:8px;border-top:3px solid var(--sc-brand);">
            <h4 data-i18n-key="web.hiring.role.fullstack.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Fullstack Engineer</h4>
            <p data-i18n-key="web.hiring.role.fullstack.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="padding:24px;border:1px solid var(--sc-border);border-radius:8px;border-top:3px solid var(--sc-brand);">
            <h4 data-i18n-key="web.hiring.role.conductor.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Project Lead</h4>
            <p data-i18n-key="web.hiring.role.conductor.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="padding:24px;border:1px solid var(--sc-border);border-radius:8px;border-top:3px solid var(--sc-brand);">
            <h4 data-i18n-key="web.hiring.role.expert.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Domain Expert</h4>
            <p data-i18n-key="web.hiring.role.expert.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
        </div>
      </div>
    </section>`,
      },
      {
        id: "list-rows",
        labelKey: "builder.variants.hiring.listRows",
        content: `<section class="aisha-hiring" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:700px;margin:0 auto;">
        <span data-i18n-key="web.hiring.badge" style="display:inline-block;padding:6px 16px;background:var(--sc-brand-tint-10);color:var(--sc-brand);border-radius:20px;font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:16px;">Join the Guild</span>
        <h2 data-i18n-key="web.hiring.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:1.8rem;font-weight:800;text-transform:uppercase;margin:0 0 32px;color:var(--sc-ink);">For specialists and experts</h2>
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div style="padding:20px 24px;border-left:3px solid var(--sc-brand);background:var(--sc-surface-light);border-radius:0 8px 8px 0;">
            <h4 data-i18n-key="web.hiring.role.fullstack.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 4px;color:var(--sc-ink);">Fullstack Engineer</h4>
            <p data-i18n-key="web.hiring.role.fullstack.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="padding:20px 24px;border-left:3px solid var(--sc-brand);background:var(--sc-surface-light);border-radius:0 8px 8px 0;">
            <h4 data-i18n-key="web.hiring.role.conductor.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 4px;color:var(--sc-ink);">Project Lead</h4>
            <p data-i18n-key="web.hiring.role.conductor.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
          <div style="padding:20px 24px;border-left:3px solid var(--sc-brand);background:var(--sc-surface-light);border-radius:0 8px 8px 0;">
            <h4 data-i18n-key="web.hiring.role.expert.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 4px;color:var(--sc-ink);">Domain Expert</h4>
            <p data-i18n-key="web.hiring.role.expert.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "stats-counter",
    category: "web",
    descriptionKey: "builder.blocks.stats-counter.description",
    icon: BarChart3,
    nameKey: "builder.blocks.stats-counter.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-stats-counter" style="padding:48px 24px;background:var(--sc-ink);color:var(--sc-white);">
      <div style="max-width:900px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:24px;text-align:center;">
        <div>
          <div data-i18n-key="web.stats.1.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2.5rem;font-weight:800;color:var(--sc-brand);">25+</div>
          <div data-i18n-key="web.stats.1.label" data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-subtle);text-transform:uppercase;letter-spacing:0.05em;">Years of experience</div>
        </div>
        <div>
          <div data-i18n-key="web.stats.2.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2.5rem;font-weight:800;color:var(--sc-brand);">6</div>
          <div data-i18n-key="web.stats.2.label" data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-subtle);text-transform:uppercase;letter-spacing:0.05em;">Industries</div>
        </div>
        <div>
          <div data-i18n-key="web.stats.3.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2.5rem;font-weight:800;color:var(--sc-brand);">100%</div>
          <div data-i18n-key="web.stats.3.label" data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-subtle);text-transform:uppercase;letter-spacing:0.05em;">Open source</div>
        </div>
        <div>
          <div data-i18n-key="web.stats.4.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2.5rem;font-weight:800;color:var(--sc-brand);">24h</div>
          <div data-i18n-key="web.stats.4.label" data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-subtle);text-transform:uppercase;letter-spacing:0.05em;">Response time</div>
        </div>
      </div>
    </section>`,
      },
      {
        id: "card-grid",
        labelKey: "builder.variants.stats-counter.cardGrid",
        content: `<section class="aisha-stats-counter" style="padding:48px 24px;background:var(--sc-ink);color:var(--sc-white);">
      <div style="max-width:900px;margin:0 auto;display:grid;grid-template-columns:repeat(2,1fr);gap:24px;">
        <div style="padding:24px;background:var(--sc-surface-dark);border-radius:8px;text-align:center;border-top:3px solid var(--sc-brand);">
          <div data-i18n-key="web.stats.1.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2.5rem;font-weight:800;color:var(--sc-brand);">25+</div>
          <div data-i18n-key="web.stats.1.label" data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-subtle);text-transform:uppercase;letter-spacing:0.05em;">Years of experience</div>
        </div>
        <div style="padding:24px;background:var(--sc-surface-dark);border-radius:8px;text-align:center;border-top:3px solid var(--sc-brand);">
          <div data-i18n-key="web.stats.2.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2.5rem;font-weight:800;color:var(--sc-brand);">6</div>
          <div data-i18n-key="web.stats.2.label" data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-subtle);text-transform:uppercase;letter-spacing:0.05em;">Industries</div>
        </div>
        <div style="padding:24px;background:var(--sc-surface-dark);border-radius:8px;text-align:center;border-top:3px solid var(--sc-brand);">
          <div data-i18n-key="web.stats.3.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2.5rem;font-weight:800;color:var(--sc-brand);">100%</div>
          <div data-i18n-key="web.stats.3.label" data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-subtle);text-transform:uppercase;letter-spacing:0.05em;">Open source</div>
        </div>
        <div style="padding:24px;background:var(--sc-surface-dark);border-radius:8px;text-align:center;border-top:3px solid var(--sc-brand);">
          <div data-i18n-key="web.stats.4.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2.5rem;font-weight:800;color:var(--sc-brand);">24h</div>
          <div data-i18n-key="web.stats.4.label" data-gjs-type="text" style="font-size:0.85rem;color:var(--sc-text-subtle);text-transform:uppercase;letter-spacing:0.05em;">Response time</div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "features",
    category: "web",
    descriptionKey: "builder.blocks.features.description",
    icon: Grid3X3,
    nameKey: "builder.blocks.features.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-features" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:1000px;margin:0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;">
        <div style="text-align:center;padding:24px;background:var(--sc-surface-light);border-radius:8px;">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--sc-brand-tint-10);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:var(--sc-brand);font-weight:800;font-size:1.2rem;">1</div>
          <h3 data-i18n-key="web.features.1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Feature 1</h3>
          <p data-i18n-key="web.features.1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
        </div>
        <div style="text-align:center;padding:24px;background:var(--sc-surface-light);border-radius:8px;">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--sc-brand-tint-10);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:var(--sc-brand);font-weight:800;font-size:1.2rem;">2</div>
          <h3 data-i18n-key="web.features.2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Feature 2</h3>
          <p data-i18n-key="web.features.2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
        </div>
        <div style="text-align:center;padding:24px;background:var(--sc-surface-light);border-radius:8px;">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--sc-brand-tint-10);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:var(--sc-brand);font-weight:800;font-size:1.2rem;">3</div>
          <h3 data-i18n-key="web.features.3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 8px;color:var(--sc-ink);">Feature 3</h3>
          <p data-i18n-key="web.features.3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
        </div>
      </div>
    </section>`,
      },
      {
        id: "text-rows",
        labelKey: "builder.variants.features.textRows",
        content: `<section class="aisha-features" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:700px;margin:0 auto;display:flex;flex-direction:column;gap:24px;">
        <div style="display:flex;align-items:flex-start;gap:20px;padding:20px;border-bottom:1px solid var(--sc-border);">
          <div style="flex-shrink:0;width:40px;height:40px;border-radius:50%;background:var(--sc-brand-tint-10);display:flex;align-items:center;justify-content:center;color:var(--sc-brand);font-weight:800;font-size:1.2rem;">1</div>
          <div>
            <h3 data-i18n-key="web.features.1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 4px;color:var(--sc-ink);">Feature 1</h3>
            <p data-i18n-key="web.features.1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:20px;padding:20px;border-bottom:1px solid var(--sc-border);">
          <div style="flex-shrink:0;width:40px;height:40px;border-radius:50%;background:var(--sc-brand-tint-10);display:flex;align-items:center;justify-content:center;color:var(--sc-brand);font-weight:800;font-size:1.2rem;">2</div>
          <div>
            <h3 data-i18n-key="web.features.2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 4px;color:var(--sc-ink);">Feature 2</h3>
            <p data-i18n-key="web.features.2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:20px;padding:20px;">
          <div style="flex-shrink:0;width:40px;height:40px;border-radius:50%;background:var(--sc-brand-tint-10);display:flex;align-items:center;justify-content:center;color:var(--sc-brand);font-weight:800;font-size:1.2rem;">3</div>
          <div>
            <h3 data-i18n-key="web.features.3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 4px;color:var(--sc-ink);">Feature 3</h3>
            <p data-i18n-key="web.features.3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description</p>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "pricing",
    category: "web",
    descriptionKey: "builder.blocks.pricing.description",
    icon: DollarSign,
    nameKey: "builder.blocks.pricing.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-pricing" style="padding:64px 24px;text-align:center;background:var(--sc-surface-light);">
      <h2 data-i18n-key="web.pricing.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">Pricing</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:1000px;margin:0 auto;">
        <div style="padding:32px 24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);">
          <h3 data-i18n-key="web.pricing.starter.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 8px;">Starter</h3>
          <p data-i18n-key="web.pricing.starter.price" data-gjs-type="text" style="font-size:2rem;font-weight:800;color:var(--sc-brand);margin:0 0 16px;">Free</p>
          <p data-i18n-key="web.pricing.starter.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:0;">Community projects, entry-level</p>
        </div>
        <div style="padding:32px 24px;background:var(--sc-white);border-radius:8px;border:2px solid var(--sc-brand);position:relative;">
          <span style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--sc-brand);color:var(--sc-white);padding:4px 16px;border-radius:12px;font-size:0.75rem;font-weight:600;text-transform:uppercase;">Popular</span>
          <h3 data-i18n-key="web.pricing.pro.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 8px;">Professional</h3>
          <p data-i18n-key="web.pricing.pro.price" data-gjs-type="text" style="font-size:2rem;font-weight:800;color:var(--sc-brand);margin:0 0 16px;">Custom</p>
          <p data-i18n-key="web.pricing.pro.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:0;">Advanced analytics + priority</p>
        </div>
        <div style="padding:32px 24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);">
          <h3 data-i18n-key="web.pricing.enterprise.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 8px;">Enterprise</h3>
          <p data-i18n-key="web.pricing.enterprise.price" data-gjs-type="text" style="font-size:2rem;font-weight:800;color:var(--sc-brand);margin:0 0 16px;">SLA</p>
          <p data-i18n-key="web.pricing.enterprise.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:0;">Dedicated conductor, custom</p>
        </div>
      </div>
    </section>`,
      },
      {
        id: "horizontal-compare",
        labelKey: "builder.variants.pricing.horizontalCompare",
        content: `<section class="aisha-pricing" style="padding:64px 24px;background:var(--sc-surface-light);">
      <h2 data-i18n-key="web.pricing.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">Pricing</h2>
      <div style="max-width:800px;margin:0 auto;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);">
          <div>
            <h3 data-i18n-key="web.pricing.starter.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0;">Starter</h3>
            <p data-i18n-key="web.pricing.starter.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:4px 0 0;">Community projects</p>
          </div>
          <p data-i18n-key="web.pricing.starter.price" data-gjs-type="text" style="font-size:1.5rem;font-weight:800;color:var(--sc-brand);margin:0;">Free</p>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:24px;background:var(--sc-white);border-radius:8px;border:2px solid var(--sc-brand);">
          <div>
            <h3 data-i18n-key="web.pricing.pro.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0;">Professional</h3>
            <p data-i18n-key="web.pricing.pro.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:4px 0 0;">Advanced analytics</p>
          </div>
          <p data-i18n-key="web.pricing.pro.price" data-gjs-type="text" style="font-size:1.5rem;font-weight:800;color:var(--sc-brand);margin:0;">Custom</p>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);">
          <div>
            <h3 data-i18n-key="web.pricing.enterprise.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0;">Enterprise</h3>
            <p data-i18n-key="web.pricing.enterprise.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:4px 0 0;">Dedicated conductor</p>
          </div>
          <p data-i18n-key="web.pricing.enterprise.price" data-gjs-type="text" style="font-size:1.5rem;font-weight:800;color:var(--sc-brand);margin:0;">SLA</p>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "cta",
    category: "web",
    descriptionKey: "builder.blocks.cta.description",
    icon: MousePointerClick,
    nameKey: "builder.blocks.cta.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-cta" style="padding:64px 24px;text-align:center;background:var(--sc-ink);color:var(--sc-white);">
      <div style="max-width:600px;margin:0 auto;">
        <h2 data-i18n-key="web.cta.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 16px;">Ready to get started?</h2>
        <p data-i18n-key="web.cta.subtitle" data-gjs-type="text" style="color:var(--sc-text-subtle);line-height:1.6;margin:0 0 32px;">Subtitle</p>
        <a data-i18n-key="web.cta.button" class="aisha-btn" href="#contact" data-gjs-type="link" style="display:inline-block;padding:14px 32px;background:var(--sc-brand);color:var(--sc-white);border-radius:6px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;transform:skewX(-2deg);">Start Now</a>
      </div>
    </section>`,
      },
      {
        id: "split-media",
        labelKey: "builder.variants.cta.splitMedia",
        content: `<section class="aisha-cta" style="padding:64px 24px;background:var(--sc-ink);color:var(--sc-white);">
      <div style="max-width:1000px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;">
        <div>
          <h2 data-i18n-key="web.cta.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 16px;">Ready to get started?</h2>
          <p data-i18n-key="web.cta.subtitle" data-gjs-type="text" style="color:var(--sc-text-subtle);line-height:1.6;margin:0 0 32px;">Subtitle</p>
          <a data-i18n-key="web.cta.button" class="aisha-btn" href="#contact" data-gjs-type="link" style="display:inline-block;padding:14px 32px;background:var(--sc-brand);color:var(--sc-white);border-radius:6px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;transform:skewX(-2deg);">Start Now</a>
        </div>
        <div style="background:var(--sc-surface-dark);border-radius:12px;min-height:250px;display:flex;align-items:center;justify-content:center;border:1px solid var(--sc-border);">
          <span style="color:var(--sc-text-subtle);font-size:0.9rem;">Image / Media placeholder</span>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "testimonials",
    category: "web",
    descriptionKey: "builder.blocks.testimonials.description",
    icon: MessageSquareQuote,
    nameKey: "builder.blocks.testimonials.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-testimonials" style="padding:64px 24px;background:var(--sc-white);">
      <h2 data-i18n-key="web.testimonials.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">What our clients say</h2>
      <div style="max-width:600px;margin:0 auto;padding:24px;border-left:4px solid var(--sc-brand);background:var(--sc-surface-light);border-radius:4px;">
        <p data-i18n-key="web.testimonials.1.quote" data-gjs-type="text" style="font-style:italic;color:var(--sc-text-medium);line-height:1.6;margin:0 0 12px;">"Great experience working with this team."</p>
        <p data-i18n-key="web.testimonials.1.author" data-gjs-type="text" style="font-weight:700;color:var(--sc-ink);margin:0;">— Client Name</p>
      </div>
    </section>`,
      },
      {
        id: "card-grid",
        labelKey: "builder.variants.testimonials.cardGrid",
        content: `<section class="aisha-testimonials" style="padding:64px 24px;background:var(--sc-white);">
      <h2 data-i18n-key="web.testimonials.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">What our clients say</h2>
      <div style="max-width:800px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div style="padding:24px;border-top:4px solid var(--sc-brand);background:var(--sc-surface-light);border-radius:8px;">
          <p data-i18n-key="web.testimonials.1.quote" data-gjs-type="text" style="font-style:italic;color:var(--sc-text-medium);line-height:1.6;margin:0 0 12px;">"Great experience working with this team."</p>
          <p data-i18n-key="web.testimonials.1.author" data-gjs-type="text" style="font-weight:700;color:var(--sc-ink);margin:0;">— Client Name</p>
        </div>
        <div style="padding:24px;border-top:4px solid var(--sc-brand);background:var(--sc-surface-light);border-radius:8px;">
          <p data-i18n-key="web.testimonials.1.quote" data-gjs-type="text" style="font-style:italic;color:var(--sc-text-medium);line-height:1.6;margin:0 0 12px;">"Great experience working with this team."</p>
          <p data-i18n-key="web.testimonials.1.author" data-gjs-type="text" style="font-weight:700;color:var(--sc-ink);margin:0;">— Client Name</p>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "faq",
    category: "web",
    descriptionKey: "builder.blocks.faq.description",
    icon: HelpCircle,
    nameKey: "builder.blocks.faq.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-faq" style="padding:64px 24px;background:var(--sc-surface-light);">
      <h2 data-i18n-key="web.faq.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">FAQ</h2>
      <div style="max-width:700px;margin:0 auto;">
        <details style="padding:16px 0;border-bottom:1px solid var(--sc-border);"><summary data-i18n-key="web.faq.1.question" style="font-weight:700;cursor:pointer;color:var(--sc-ink);font-family:var(--sc-font-family);">Question 1?</summary><p data-i18n-key="web.faq.1.answer" data-gjs-type="text" style="margin-top:8px;color:var(--sc-text-muted);line-height:1.5;">Answer 1.</p></details>
        <details style="padding:16px 0;border-bottom:1px solid var(--sc-border);"><summary data-i18n-key="web.faq.2.question" style="font-weight:700;cursor:pointer;color:var(--sc-ink);font-family:var(--sc-font-family);">Question 2?</summary><p data-i18n-key="web.faq.2.answer" data-gjs-type="text" style="margin-top:8px;color:var(--sc-text-muted);line-height:1.5;">Answer 2.</p></details>
        <details style="padding:16px 0;border-bottom:1px solid var(--sc-border);"><summary data-i18n-key="web.faq.3.question" style="font-weight:700;cursor:pointer;color:var(--sc-ink);font-family:var(--sc-font-family);">Question 3?</summary><p data-i18n-key="web.faq.3.answer" data-gjs-type="text" style="margin-top:8px;color:var(--sc-text-muted);line-height:1.5;">Answer 3.</p></details>
      </div>
    </section>`,
      },
      {
        id: "two-column",
        labelKey: "builder.variants.faq.twoColumn",
        content: `<section class="aisha-faq" style="padding:64px 24px;background:var(--sc-surface-light);">
      <h2 data-i18n-key="web.faq.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">FAQ</h2>
      <div style="max-width:900px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div style="padding:20px;background:var(--sc-white);border-radius:8px;border-left:3px solid var(--sc-brand);">
          <h4 data-i18n-key="web.faq.1.question" style="font-weight:700;color:var(--sc-ink);font-family:var(--sc-font-family);margin:0 0 8px;">Question 1?</h4>
          <p data-i18n-key="web.faq.1.answer" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.5;margin:0;">Answer 1.</p>
        </div>
        <div style="padding:20px;background:var(--sc-white);border-radius:8px;border-left:3px solid var(--sc-brand);">
          <h4 data-i18n-key="web.faq.2.question" style="font-weight:700;color:var(--sc-ink);font-family:var(--sc-font-family);margin:0 0 8px;">Question 2?</h4>
          <p data-i18n-key="web.faq.2.answer" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.5;margin:0;">Answer 2.</p>
        </div>
        <div style="padding:20px;background:var(--sc-white);border-radius:8px;border-left:3px solid var(--sc-brand);">
          <h4 data-i18n-key="web.faq.3.question" style="font-weight:700;color:var(--sc-ink);font-family:var(--sc-font-family);margin:0 0 8px;">Question 3?</h4>
          <p data-i18n-key="web.faq.3.answer" data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.5;margin:0;">Answer 3.</p>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "footer",
    category: "web",
    descriptionKey: "builder.blocks.footer.description",
    icon: PanelBottom,
    nameKey: "builder.blocks.footer.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<footer class="aisha-footer" style="padding:40px 24px;background:var(--sc-surface-footer);color:var(--sc-text-footer);">
      <div style="max-width:1000px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;">
        <p data-i18n-key="web.footer.copyright" data-gjs-type="text" style="margin:0;font-size:0.85rem;">© 2026 Evymo. All rights reserved.</p>
        <div style="display:flex;gap:24px;">
          <a href="/privacy" data-i18n-key="web.footer.privacy" data-gjs-type="link" style="color:var(--sc-text-footer);text-decoration:none;font-size:0.85rem;">Privacy</a>
          <a href="/terms" data-i18n-key="web.footer.terms" data-gjs-type="link" style="color:var(--sc-text-footer);text-decoration:none;font-size:0.85rem;">Terms</a>
          <a href="#contact" data-i18n-key="web.footer.contact" data-gjs-type="link" style="color:var(--sc-brand);text-decoration:none;font-size:0.85rem;font-weight:600;">Contact</a>
        </div>
      </div>
    </footer>`,
      },
      {
        id: "stacked",
        labelKey: "builder.variants.footer.stacked",
        content: `<footer class="aisha-footer" style="padding:40px 24px;background:var(--sc-surface-footer);color:var(--sc-text-footer);text-align:center;">
      <div style="max-width:1000px;margin:0 auto;">
        <div style="display:flex;justify-content:center;gap:24px;margin-bottom:16px;">
          <a href="/privacy" data-i18n-key="web.footer.privacy" data-gjs-type="link" style="color:var(--sc-text-footer);text-decoration:none;font-size:0.85rem;">Privacy</a>
          <a href="/terms" data-i18n-key="web.footer.terms" data-gjs-type="link" style="color:var(--sc-text-footer);text-decoration:none;font-size:0.85rem;">Terms</a>
          <a href="#contact" data-i18n-key="web.footer.contact" data-gjs-type="link" style="color:var(--sc-brand);text-decoration:none;font-size:0.85rem;font-weight:600;">Contact</a>
        </div>
        <p data-i18n-key="web.footer.copyright" data-gjs-type="text" style="margin:0;font-size:0.85rem;">© 2026 Evymo. All rights reserved.</p>
      </div>
    </footer>`,
      }
    ],
  },
  {
    blockType: "contact",
    category: "web",
    descriptionKey: "builder.blocks.contact.description",
    icon: Mail,
    nameKey: "builder.blocks.contact.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-contact" style="padding:64px 24px;background:var(--sc-white);">
      <h2 data-i18n-key="web.contact.name.label" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 32px;color:var(--sc-ink);">Contact Us</h2>
      <form style="max-width:500px;margin:0 auto;display:flex;flex-direction:column;gap:16px;">
        <input type="text" placeholder="Name" style="padding:12px 16px;border:1px solid var(--sc-border-input);border-radius:6px;font-size:1rem;" />
        <input type="email" placeholder="Email" style="padding:12px 16px;border:1px solid var(--sc-border-input);border-radius:6px;font-size:1rem;" />
        <textarea placeholder="Message" rows="4" style="padding:12px 16px;border:1px solid var(--sc-border-input);border-radius:6px;font-size:1rem;resize:vertical;"></textarea>
        <button type="submit" style="padding:14px;background:var(--sc-brand);color:var(--sc-white);border:none;border-radius:6px;cursor:pointer;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-family:var(--sc-font-family);">Send</button>
      </form>
    </section>`,
      },
      {
        id: "split-info",
        labelKey: "builder.variants.contact.splitInfo",
        content: `<section class="aisha-contact" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:900px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start;">
        <div>
          <h2 data-i18n-key="web.contact.name.label" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 16px;color:var(--sc-ink);">Contact Us</h2>
          <p data-gjs-type="text" style="color:var(--sc-text-muted);line-height:1.6;margin:0;">Reach out and we will get back to you within 24 hours.</p>
        </div>
        <form style="display:flex;flex-direction:column;gap:16px;">
          <input type="text" placeholder="Name" style="padding:12px 16px;border:1px solid var(--sc-border-input);border-radius:6px;font-size:1rem;" />
          <input type="email" placeholder="Email" style="padding:12px 16px;border:1px solid var(--sc-border-input);border-radius:6px;font-size:1rem;" />
          <textarea placeholder="Message" rows="4" style="padding:12px 16px;border:1px solid var(--sc-border-input);border-radius:6px;font-size:1rem;resize:vertical;"></textarea>
          <button type="submit" style="padding:14px;background:var(--sc-brand);color:var(--sc-white);border:none;border-radius:6px;cursor:pointer;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-family:var(--sc-font-family);">Send</button>
        </form>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "project-configurator",
    category: "web",
    descriptionKey: "builder.blocks.project-configurator.description",
    icon: Calculator,
    nameKey: "builder.blocks.project-configurator.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-project-configurator" style="padding:64px 24px;background:var(--sc-surface-light);">
      <div style="max-width:900px;margin:0 auto;text-align:center;">
        <h2 data-i18n-key="web.cfg.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">Choose Your Plan</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;">
          <div style="padding:24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);cursor:pointer;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--sc-brand)'" onmouseout="this.style.borderColor='var(--sc-border)'">
            <h4 data-i18n-key="web.cfg.adoption.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-brand);margin:0 0 8px;">Adoption</h4>
            <p data-i18n-key="web.cfg.adoption.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:0;">Take Aisha as-is and run it</p>
          </div>
          <div style="padding:24px;background:var(--sc-white);border-radius:8px;border:2px solid var(--sc-brand);">
            <h4 data-i18n-key="web.cfg.workshop.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-brand);margin:0 0 8px;">Workshop</h4>
            <p data-i18n-key="web.cfg.workshop.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:0;">Individual hands-on session</p>
          </div>
          <div style="padding:24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);cursor:pointer;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--sc-brand)'" onmouseout="this.style.borderColor='var(--sc-border)'">
            <h4 data-i18n-key="web.cfg.adaptation.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-brand);margin:0 0 8px;">Adaptation</h4>
            <p data-i18n-key="web.cfg.adaptation.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:0;">Customize for your processes</p>
          </div>
        </div>
      </div>
    </section>`,
      },
      {
        id: "step-wizard",
        labelKey: "builder.variants.project-configurator.stepWizard",
        content: `<section class="aisha-project-configurator" style="padding:64px 24px;background:var(--sc-surface-light);">
      <div style="max-width:700px;margin:0 auto;">
        <h2 data-i18n-key="web.cfg.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">Choose Your Plan</h2>
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;align-items:center;gap:20px;padding:20px 24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);">
            <div style="flex-shrink:0;width:40px;height:40px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;font-weight:800;">1</div>
            <div>
              <h4 data-i18n-key="web.cfg.adoption.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-brand);margin:0 0 4px;">Adoption</h4>
              <p data-i18n-key="web.cfg.adoption.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:0;">Take Aisha as-is and run it</p>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:20px;padding:20px 24px;background:var(--sc-white);border-radius:8px;border:2px solid var(--sc-brand);">
            <div style="flex-shrink:0;width:40px;height:40px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;font-weight:800;">2</div>
            <div>
              <h4 data-i18n-key="web.cfg.workshop.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-brand);margin:0 0 4px;">Workshop</h4>
              <p data-i18n-key="web.cfg.workshop.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:0;">Individual hands-on session</p>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:20px;padding:20px 24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);">
            <div style="flex-shrink:0;width:40px;height:40px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;font-weight:800;">3</div>
            <div>
              <h4 data-i18n-key="web.cfg.adaptation.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-brand);margin:0 0 4px;">Adaptation</h4>
              <p data-i18n-key="web.cfg.adaptation.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;margin:0;">Customize for your processes</p>
            </div>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "timeline",
    category: "web",
    descriptionKey: "builder.blocks.timeline.description",
    icon: Clock,
    nameKey: "builder.blocks.timeline.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-timeline" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:700px;margin:0 auto;">
        <h2 data-i18n-key="web.timeline.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">Timeline</h2>
        <div style="border-left:3px solid var(--sc-brand);padding-left:24px;display:flex;flex-direction:column;gap:32px;">
          <div style="position:relative;">
            <div style="position:absolute;left:-33px;top:4px;width:16px;height:16px;border-radius:50%;background:var(--sc-brand);"></div>
            <span data-i18n-key="web.timeline.1.year" data-gjs-type="text" style="font-size:0.8rem;font-weight:700;color:var(--sc-brand);text-transform:uppercase;letter-spacing:0.1em;">2024</span>
            <h3 data-i18n-key="web.timeline.1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:4px 0;">Event Title</h3>
            <p data-i18n-key="web.timeline.1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.95rem;line-height:1.5;margin:0;">Event description goes here.</p>
          </div>
          <div style="position:relative;">
            <div style="position:absolute;left:-33px;top:4px;width:16px;height:16px;border-radius:50%;background:var(--sc-brand);"></div>
            <span data-i18n-key="web.timeline.2.year" data-gjs-type="text" style="font-size:0.8rem;font-weight:700;color:var(--sc-brand);text-transform:uppercase;letter-spacing:0.1em;">2025</span>
            <h3 data-i18n-key="web.timeline.2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:4px 0;">Event Title</h3>
            <p data-i18n-key="web.timeline.2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.95rem;line-height:1.5;margin:0;">Event description goes here.</p>
          </div>
          <div style="position:relative;">
            <div style="position:absolute;left:-33px;top:4px;width:16px;height:16px;border-radius:50%;background:var(--sc-brand);"></div>
            <span data-i18n-key="web.timeline.3.year" data-gjs-type="text" style="font-size:0.8rem;font-weight:700;color:var(--sc-brand);text-transform:uppercase;letter-spacing:0.1em;">2026</span>
            <h3 data-i18n-key="web.timeline.3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:4px 0;">Event Title</h3>
            <p data-i18n-key="web.timeline.3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.95rem;line-height:1.5;margin:0;">Event description goes here.</p>
          </div>
        </div>
      </div>
    </section>`,
      },
      {
        id: "horizontal",
        labelKey: "builder.variants.timeline.horizontal",
        content: `<section class="aisha-timeline" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:900px;margin:0 auto;">
        <h2 data-i18n-key="web.timeline.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 48px;color:var(--sc-ink);">Timeline</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:32px;text-align:center;">
          <div>
            <div style="width:48px;height:48px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-weight:800;">
              <span data-i18n-key="web.timeline.1.year" data-gjs-type="text" style="font-size:0.7rem;letter-spacing:0.05em;">2024</span>
            </div>
            <h3 data-i18n-key="web.timeline.1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Event Title</h3>
            <p data-i18n-key="web.timeline.1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Event description</p>
          </div>
          <div>
            <div style="width:48px;height:48px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-weight:800;">
              <span data-i18n-key="web.timeline.2.year" data-gjs-type="text" style="font-size:0.7rem;letter-spacing:0.05em;">2025</span>
            </div>
            <h3 data-i18n-key="web.timeline.2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Event Title</h3>
            <p data-i18n-key="web.timeline.2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Event description</p>
          </div>
          <div>
            <div style="width:48px;height:48px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-weight:800;">
              <span data-i18n-key="web.timeline.3.year" data-gjs-type="text" style="font-size:0.7rem;letter-spacing:0.05em;">2026</span>
            </div>
            <h3 data-i18n-key="web.timeline.3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Event Title</h3>
            <p data-i18n-key="web.timeline.3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Event description</p>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "data-table",
    category: "web",
    descriptionKey: "builder.blocks.data-table.description",
    icon: Table,
    nameKey: "builder.blocks.data-table.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-data-table" style="padding:64px 24px;background:var(--sc-surface-light);">
      <div style="max-width:800px;margin:0 auto;">
        <h2 data-i18n-key="web.table.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 32px;color:var(--sc-ink);">Data Table</h2>
        <table style="width:100%;border-collapse:collapse;background:var(--sc-white);border-radius:8px;overflow:hidden;box-shadow:0 1px 3px var(--sc-shadow-subtle);">
          <thead>
            <tr style="background:var(--sc-ink);color:var(--sc-white);">
              <th data-i18n-key="web.table.col.a" data-gjs-type="text" style="padding:12px 16px;text-align:left;font-family:var(--sc-font-family);font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Column A</th>
              <th data-i18n-key="web.table.col.b" data-gjs-type="text" style="padding:12px 16px;text-align:left;font-family:var(--sc-font-family);font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Column B</th>
              <th data-i18n-key="web.table.col.c" data-gjs-type="text" style="padding:12px 16px;text-align:left;font-family:var(--sc-font-family);font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Column C</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid var(--sc-border);">
              <td data-i18n-key="web.table.r1.a" data-gjs-type="text" style="padding:12px 16px;color:var(--sc-text-body);font-size:0.95rem;">Row 1 A</td>
              <td data-i18n-key="web.table.r1.b" data-gjs-type="text" style="padding:12px 16px;color:var(--sc-text-body);font-size:0.95rem;">Row 1 B</td>
              <td data-i18n-key="web.table.r1.c" data-gjs-type="text" style="padding:12px 16px;color:var(--sc-text-muted);font-size:0.9rem;">Row 1 C</td>
            </tr>
            <tr style="border-bottom:1px solid var(--sc-border);">
              <td data-i18n-key="web.table.r2.a" data-gjs-type="text" style="padding:12px 16px;color:var(--sc-text-body);font-size:0.95rem;">Row 2 A</td>
              <td data-i18n-key="web.table.r2.b" data-gjs-type="text" style="padding:12px 16px;color:var(--sc-text-body);font-size:0.95rem;">Row 2 B</td>
              <td data-i18n-key="web.table.r2.c" data-gjs-type="text" style="padding:12px 16px;color:var(--sc-text-muted);font-size:0.9rem;">Row 2 C</td>
            </tr>
            <tr>
              <td data-i18n-key="web.table.r3.a" data-gjs-type="text" style="padding:12px 16px;color:var(--sc-text-body);font-size:0.95rem;">Row 3 A</td>
              <td data-i18n-key="web.table.r3.b" data-gjs-type="text" style="padding:12px 16px;color:var(--sc-text-body);font-size:0.95rem;">Row 3 B</td>
              <td data-i18n-key="web.table.r3.c" data-gjs-type="text" style="padding:12px 16px;color:var(--sc-text-muted);font-size:0.9rem;">Row 3 C</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>`,
      },
      {
        id: "striped-compact",
        labelKey: "builder.variants.data-table.stripedCompact",
        content: `<section class="aisha-data-table" style="padding:64px 24px;background:var(--sc-surface-light);">
      <div style="max-width:800px;margin:0 auto;">
        <h2 data-i18n-key="web.table.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 32px;color:var(--sc-ink);">Data Table</h2>
        <table style="width:100%;border-collapse:collapse;background:var(--sc-white);border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:var(--sc-brand);color:var(--sc-white);">
              <th data-i18n-key="web.table.col.a" data-gjs-type="text" style="padding:10px 12px;text-align:left;font-family:var(--sc-font-family);font-size:0.8rem;font-weight:700;">Column A</th>
              <th data-i18n-key="web.table.col.b" data-gjs-type="text" style="padding:10px 12px;text-align:left;font-family:var(--sc-font-family);font-size:0.8rem;font-weight:700;">Column B</th>
              <th data-i18n-key="web.table.col.c" data-gjs-type="text" style="padding:10px 12px;text-align:left;font-family:var(--sc-font-family);font-size:0.8rem;font-weight:700;">Column C</th>
            </tr>
          </thead>
          <tbody>
            <tr style="background:var(--sc-surface-light);">
              <td data-i18n-key="web.table.r1.a" data-gjs-type="text" style="padding:8px 12px;color:var(--sc-text-body);font-size:0.9rem;">Row 1 A</td>
              <td data-i18n-key="web.table.r1.b" data-gjs-type="text" style="padding:8px 12px;color:var(--sc-text-body);font-size:0.9rem;">Row 1 B</td>
              <td data-i18n-key="web.table.r1.c" data-gjs-type="text" style="padding:8px 12px;color:var(--sc-text-muted);font-size:0.85rem;">Row 1 C</td>
            </tr>
            <tr>
              <td data-i18n-key="web.table.r2.a" data-gjs-type="text" style="padding:8px 12px;color:var(--sc-text-body);font-size:0.9rem;">Row 2 A</td>
              <td data-i18n-key="web.table.r2.b" data-gjs-type="text" style="padding:8px 12px;color:var(--sc-text-body);font-size:0.9rem;">Row 2 B</td>
              <td data-i18n-key="web.table.r2.c" data-gjs-type="text" style="padding:8px 12px;color:var(--sc-text-muted);font-size:0.85rem;">Row 2 C</td>
            </tr>
            <tr style="background:var(--sc-surface-light);">
              <td data-i18n-key="web.table.r3.a" data-gjs-type="text" style="padding:8px 12px;color:var(--sc-text-body);font-size:0.9rem;">Row 3 A</td>
              <td data-i18n-key="web.table.r3.b" data-gjs-type="text" style="padding:8px 12px;color:var(--sc-text-body);font-size:0.9rem;">Row 3 B</td>
              <td data-i18n-key="web.table.r3.c" data-gjs-type="text" style="padding:8px 12px;color:var(--sc-text-muted);font-size:0.85rem;">Row 3 C</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "ordered-list",
    category: "web",
    descriptionKey: "builder.blocks.ordered-list.description",
    icon: ListOrdered,
    nameKey: "builder.blocks.ordered-list.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-ordered-list" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:700px;margin:0 auto;">
        <h2 data-i18n-key="web.steps.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">Steps</h2>
        <ol style="list-style:none;counter-reset:steps;padding:0;display:flex;flex-direction:column;gap:24px;">
          <li style="counter-increment:steps;display:flex;gap:16px;align-items:flex-start;">
            <span style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;font-family:var(--sc-font-family);font-weight:800;font-size:0.95rem;">1</span>
            <div>
              <h4 data-i18n-key="web.steps.1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Step One</h4>
              <p data-i18n-key="web.steps.1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.95rem;line-height:1.5;margin:0;">Description of the first step.</p>
            </div>
          </li>
          <li style="counter-increment:steps;display:flex;gap:16px;align-items:flex-start;">
            <span style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;font-family:var(--sc-font-family);font-weight:800;font-size:0.95rem;">2</span>
            <div>
              <h4 data-i18n-key="web.steps.2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Step Two</h4>
              <p data-i18n-key="web.steps.2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.95rem;line-height:1.5;margin:0;">Description of the second step.</p>
            </div>
          </li>
          <li style="counter-increment:steps;display:flex;gap:16px;align-items:flex-start;">
            <span style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);display:flex;align-items:center;justify-content:center;font-family:var(--sc-font-family);font-weight:800;font-size:0.95rem;">3</span>
            <div>
              <h4 data-i18n-key="web.steps.3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Step Three</h4>
              <p data-i18n-key="web.steps.3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.95rem;line-height:1.5;margin:0;">Description of the third step.</p>
            </div>
          </li>
        </ol>
      </div>
    </section>`,
      },
      {
        id: "card-steps",
        labelKey: "builder.variants.ordered-list.cardSteps",
        content: `<section class="aisha-ordered-list" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:900px;margin:0 auto;">
        <h2 data-i18n-key="web.steps.title" data-gjs-type="text" style="text-align:center;font-family:var(--sc-font-family);font-size:2rem;font-weight:800;text-transform:uppercase;margin:0 0 40px;color:var(--sc-ink);">Steps</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;">
          <div style="padding:24px;background:var(--sc-surface-light);border-radius:8px;text-align:center;border-top:3px solid var(--sc-brand);">
            <span style="display:inline-block;width:36px;height:36px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);line-height:36px;font-family:var(--sc-font-family);font-weight:800;margin-bottom:12px;">1</span>
            <h4 data-i18n-key="web.steps.1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Step One</h4>
            <p data-i18n-key="web.steps.1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description of the first step.</p>
          </div>
          <div style="padding:24px;background:var(--sc-surface-light);border-radius:8px;text-align:center;border-top:3px solid var(--sc-brand);">
            <span style="display:inline-block;width:36px;height:36px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);line-height:36px;font-family:var(--sc-font-family);font-weight:800;margin-bottom:12px;">2</span>
            <h4 data-i18n-key="web.steps.2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Step Two</h4>
            <p data-i18n-key="web.steps.2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description of the second step.</p>
          </div>
          <div style="padding:24px;background:var(--sc-surface-light);border-radius:8px;text-align:center;border-top:3px solid var(--sc-brand);">
            <span style="display:inline-block;width:36px;height:36px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);line-height:36px;font-family:var(--sc-font-family);font-weight:800;margin-bottom:12px;">3</span>
            <h4 data-i18n-key="web.steps.3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Step Three</h4>
            <p data-i18n-key="web.steps.3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Description of the third step.</p>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  // ----- Universal sections ported & neutralised from the aisha.guru template -----
  {
    blockType: "process-loop",
    category: "web",
    descriptionKey: "builder.blocks.process-loop.description",
    icon: RefreshCw,
    nameKey: "builder.blocks.process-loop.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-process-loop" style="padding:64px 24px;background:var(--sc-surface-light);">
      <div style="max-width:1000px;margin:0 auto;text-align:center;">
        <h2 data-i18n-key="web.processLoop.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;color:var(--sc-ink);margin:0 0 8px;text-transform:uppercase;">How The Loop Works</h2>
        <p data-i18n-key="web.processLoop.subtitle" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:1.05rem;max-width:560px;margin:0 auto 40px;">A continuous cycle that improves with every pass.</p>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
          <div style="padding:24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);font-family:var(--sc-font-family);font-weight:800;margin-bottom:12px;">1</span>
            <h4 data-i18n-key="web.processLoop.step.1.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Capture</h4>
            <p data-i18n-key="web.processLoop.step.1.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Gather the inputs and context for the task.</p>
          </div>
          <div style="padding:24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);font-family:var(--sc-font-family);font-weight:800;margin-bottom:12px;">2</span>
            <h4 data-i18n-key="web.processLoop.step.2.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Process</h4>
            <p data-i18n-key="web.processLoop.step.2.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Do the work with the right tool for the job.</p>
          </div>
          <div style="padding:24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);font-family:var(--sc-font-family);font-weight:800;margin-bottom:12px;">3</span>
            <h4 data-i18n-key="web.processLoop.step.3.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Review</h4>
            <p data-i18n-key="web.processLoop.step.3.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Check the result against what was asked.</p>
          </div>
          <div style="padding:24px;background:var(--sc-white);border-radius:8px;border:1px solid var(--sc-border);">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:var(--sc-brand);color:var(--sc-white);font-family:var(--sc-font-family);font-weight:800;margin-bottom:12px;">4</span>
            <h4 data-i18n-key="web.processLoop.step.4.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;color:var(--sc-ink);margin:0 0 4px;">Improve</h4>
            <p data-i18n-key="web.processLoop.step.4.desc" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.9rem;line-height:1.5;margin:0;">Feed the outcome back into the next pass.</p>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "layer-stack",
    category: "web",
    descriptionKey: "builder.blocks.layer-stack.description",
    icon: Layers,
    nameKey: "builder.blocks.layer-stack.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-layer-stack" style="padding:64px 24px;background:var(--sc-ink);color:var(--sc-white);">
      <div style="max-width:760px;margin:0 auto;">
        <h2 data-i18n-key="web.layerStack.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;margin:0 0 8px;text-transform:uppercase;text-align:center;">Built In Layers</h2>
        <p data-i18n-key="web.layerStack.subtitle" data-gjs-type="text" style="color:var(--sc-text-subtle);font-size:1.05rem;margin:0 auto 32px;text-align:center;max-width:520px;">Each layer builds on the one beneath it.</p>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="padding:20px 24px;background:var(--sc-surface-dark);border-left:4px solid var(--sc-brand);border-radius:6px;">
            <h4 data-i18n-key="web.layerStack.layer.1.name" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 4px;">Presentation</h4>
            <p data-i18n-key="web.layerStack.layer.1.desc" data-gjs-type="text" style="color:var(--sc-text-light);font-size:0.9rem;line-height:1.5;margin:0;">What people see and interact with.</p>
          </div>
          <div style="padding:20px 24px;background:var(--sc-surface-dark);border-left:4px solid var(--sc-brand);border-radius:6px;">
            <h4 data-i18n-key="web.layerStack.layer.2.name" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 4px;">Logic</h4>
            <p data-i18n-key="web.layerStack.layer.2.desc" data-gjs-type="text" style="color:var(--sc-text-light);font-size:0.9rem;line-height:1.5;margin:0;">The rules and orchestration that do the work.</p>
          </div>
          <div style="padding:20px 24px;background:var(--sc-surface-dark);border-left:4px solid var(--sc-brand);border-radius:6px;">
            <h4 data-i18n-key="web.layerStack.layer.3.name" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:700;margin:0 0 4px;">Data</h4>
            <p data-i18n-key="web.layerStack.layer.3.desc" data-gjs-type="text" style="color:var(--sc-text-light);font-size:0.9rem;line-height:1.5;margin:0;">The knowledge and records everything draws on.</p>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "signal-cards",
    category: "web",
    descriptionKey: "builder.blocks.signal-cards.description",
    icon: Activity,
    nameKey: "builder.blocks.signal-cards.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-signal-cards" style="padding:64px 24px;background:var(--sc-white);">
      <div style="max-width:1000px;margin:0 auto;text-align:center;">
        <h2 data-i18n-key="web.signals.title" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:2rem;font-weight:800;color:var(--sc-ink);margin:0 0 8px;text-transform:uppercase;">Live Signals</h2>
        <p data-i18n-key="web.signals.subtitle" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:1.05rem;max-width:560px;margin:0 auto 40px;">The numbers that matter, at a glance.</p>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
          <div style="padding:24px;background:var(--sc-surface-light);border-radius:8px;border:1px solid var(--sc-border);">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--sc-brand);margin-bottom:12px;"></span>
            <div data-i18n-key="web.signals.signal.1.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:1.8rem;font-weight:800;color:var(--sc-ink);line-height:1;">00</div>
            <p data-i18n-key="web.signals.signal.1.label" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;margin:6px 0 0;">Signal One</p>
          </div>
          <div style="padding:24px;background:var(--sc-surface-light);border-radius:8px;border:1px solid var(--sc-border);">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--sc-brand);margin-bottom:12px;"></span>
            <div data-i18n-key="web.signals.signal.2.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:1.8rem;font-weight:800;color:var(--sc-ink);line-height:1;">00</div>
            <p data-i18n-key="web.signals.signal.2.label" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;margin:6px 0 0;">Signal Two</p>
          </div>
          <div style="padding:24px;background:var(--sc-surface-light);border-radius:8px;border:1px solid var(--sc-border);">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--sc-brand);margin-bottom:12px;"></span>
            <div data-i18n-key="web.signals.signal.3.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:1.8rem;font-weight:800;color:var(--sc-ink);line-height:1;">00</div>
            <p data-i18n-key="web.signals.signal.3.label" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;margin:6px 0 0;">Signal Three</p>
          </div>
          <div style="padding:24px;background:var(--sc-surface-light);border-radius:8px;border:1px solid var(--sc-border);">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--sc-brand);margin-bottom:12px;"></span>
            <div data-i18n-key="web.signals.signal.4.value" data-gjs-type="text" style="font-family:var(--sc-font-family);font-size:1.8rem;font-weight:800;color:var(--sc-ink);line-height:1;">00</div>
            <p data-i18n-key="web.signals.signal.4.label" data-gjs-type="text" style="color:var(--sc-text-muted);font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;margin:6px 0 0;">Signal Four</p>
          </div>
        </div>
      </div>
    </section>`,
      }
    ],
  },
  {
    blockType: "announcement-bar",
    category: "web",
    descriptionKey: "builder.blocks.announcement-bar.description",
    icon: Megaphone,
    nameKey: "builder.blocks.announcement-bar.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-announcement-bar" style="padding:12px 24px;background:var(--sc-brand);color:var(--sc-white);text-align:center;">
      <div style="max-width:1000px;margin:0 auto;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;">
        <span data-i18n-key="web.announce.text" data-gjs-type="text" style="font-family:var(--sc-font-family);font-weight:600;font-size:0.95rem;">Something worth announcing goes here.</span>
        <a data-i18n-key="web.announce.link" class="aisha-btn" href="#" data-gjs-type="link" style="color:var(--sc-white);font-weight:700;text-decoration:underline;font-size:0.95rem;">Learn more →</a>
      </div>
    </section>`,
      }
    ],
  },
];
