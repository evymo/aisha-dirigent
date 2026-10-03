/**
 * Workflow block definitions for the AISHA Story Canvas builder (V2, variant-aware).
 *
 * 5 blocks: meeting, questionnaire, consent, action, info.
 *
 * @module
 */

import {
  CalendarDays,
  ClipboardList,
  Info,
  ShieldCheck,
  Zap,
} from "lucide-react";

import type { CanvasBlockEntryV2 } from "./blockRegistry.types";

/** Workflow blocks — dashed-border placeholders for backend-driven steps. */
export const WORKFLOW_BLOCKS_V2: CanvasBlockEntryV2[] = [
  {
    blockType: "meeting",
    category: "workflow",
    descriptionKey: "builder.blocks.meeting.description",
    icon: CalendarDays,
    nameKey: "builder.blocks.meeting.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-meeting" style="padding:24px;border:2px dashed var(--sc-wf-meeting);border-radius:8px;text-align:center;">
      <h3 data-gjs-type="text">Meeting</h3>
      <p data-gjs-type="text" style="color:var(--sc-wf-text);">Schedule and manage a meeting</p>
    </section>`,
      },
    ],
  },
  {
    blockType: "questionnaire",
    category: "workflow",
    descriptionKey: "builder.blocks.questionnaire.description",
    icon: ClipboardList,
    nameKey: "builder.blocks.questionnaire.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-questionnaire" style="padding:24px;border:2px dashed var(--sc-wf-questionnaire);border-radius:8px;text-align:center;">
      <h3 data-gjs-type="text">Questionnaire</h3>
      <p data-gjs-type="text" style="color:var(--sc-wf-text);">Dynamic survey or form</p>
    </section>`,
      },
    ],
  },
  {
    blockType: "consent",
    category: "workflow",
    descriptionKey: "builder.blocks.consent.description",
    icon: ShieldCheck,
    nameKey: "builder.blocks.consent.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-consent" style="padding:24px;border:2px dashed var(--sc-wf-consent);border-radius:8px;text-align:center;">
      <h3 data-gjs-type="text">Consent</h3>
      <p data-gjs-type="text" style="color:var(--sc-wf-text);">Data sharing and privacy consent</p>
    </section>`,
      },
    ],
  },
  {
    blockType: "action",
    category: "workflow",
    descriptionKey: "builder.blocks.action.description",
    icon: Zap,
    nameKey: "builder.blocks.action.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-action" style="padding:24px;border:2px dashed var(--sc-wf-action);border-radius:8px;text-align:center;">
      <h3 data-gjs-type="text">Action</h3>
      <p data-gjs-type="text" style="color:var(--sc-wf-text);">User action request</p>
    </section>`,
      },
    ],
  },
  {
    blockType: "info",
    category: "workflow",
    descriptionKey: "builder.blocks.info.description",
    icon: Info,
    nameKey: "builder.blocks.info.title",
    defaultVariant: "default",
    variants: [
      {
        id: "default",
        labelKey: "builder.variants.default",
        content: `<section class="aisha-info" style="padding:24px;border:2px dashed var(--sc-wf-info);border-radius:8px;text-align:center;">
      <h3 data-gjs-type="text">Info</h3>
      <p data-gjs-type="text" style="color:var(--sc-wf-text);">Static informational content</p>
    </section>`,
      },
    ],
  },
];
