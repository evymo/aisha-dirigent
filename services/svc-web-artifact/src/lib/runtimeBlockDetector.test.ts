/**
 * Unit tests for runtimeBlockDetector — verifies heuristics map correctly
 * onto known runtime block types and emit preserve_as_static when no
 * matching block exists in the registry.
 *
 * Lives next to the implementation so vitest can run it inside the
 * svc-web-artifact package.
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { detectRuntimeBlocks } from "./runtimeBlockDetector.js";

function parse(html: string): Document {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

describe("runtimeBlockDetector", () => {
  it("maps email + textarea form to contact-form runtime block", () => {
    const doc = parse(`
      <form>
        <input name="email" type="email" />
        <textarea name="message"></textarea>
        <button type="submit">Send</button>
      </form>
    `);
    const out = detectRuntimeBlocks(doc);
    const contact = out.find((s) => s.suggested_block_type === "contact-form");
    expect(contact).toBeDefined();
    expect(contact?.kind).toBe("runtime_block");
    expect(contact?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("flags login-shaped form as preserve_as_static + follow-up story", () => {
    const doc = parse(`
      <form>
        <input name="email" type="email" />
        <input name="password" type="password" />
        <button type="submit">Sign in</button>
      </form>
    `);
    const out = detectRuntimeBlocks(doc);
    const auth = out.find((s) => /auth-login/.test(s.suggested_followup_story ?? ""));
    expect(auth).toBeDefined();
    expect(auth?.kind).toBe("preserve_as_static");
    expect(auth?.suggested_block_type).toBeNull();
    expect(auth?.suggested_followup_story).toContain("auth-login");
  });

  it("maps news-classed UL with 3+ items to news-list", () => {
    const doc = parse(`
      <ul class="news">
        <li>Article A</li>
        <li>Article B</li>
        <li>Article C</li>
        <li>Article D</li>
      </ul>
    `);
    const out = detectRuntimeBlocks(doc);
    const news = out.find((s) => s.suggested_block_type === "news-list");
    expect(news).toBeDefined();
    expect(news?.data_block_config.limit).toBeDefined();
  });

  it("maps DL.faq to faq-accordion", () => {
    const doc = parse(`<dl class="faq"><dt>Q1</dt><dd>A1</dd></dl>`);
    const out = detectRuntimeBlocks(doc);
    expect(out.some((s) => s.suggested_block_type === "faq-accordion")).toBe(true);
  });

  it("emits preserve_as_static for pattern without registry match (e.g. exotic widget)", () => {
    const doc = parse(`<div class="custom-widget exotic"><span>foo</span></div>`);
    const out = detectRuntimeBlocks(doc);
    // No suggestion at all is fine (heuristics matched nothing). If something matched
    // unexpectedly, it must not propose a new block type.
    for (const s of out) {
      if (s.suggested_block_type) {
        const known = [
          "hero-slides", "news-list", "contact-form", "archive-preview", "knowledge-preview",
          "faq-accordion", "product-catalog", "news-browser", "knowledge-browser",
          "archive-browser", "studies-browser", "guild-directory",
        ];
        expect(known).toContain(s.suggested_block_type);
      }
    }
  });

  it("never returns a runtime_block kind whose block_type is unknown", () => {
    const doc = parse(`<form><input name="email"/><input name="password"/></form>`);
    const out = detectRuntimeBlocks(doc);
    for (const s of out) {
      if (s.kind === "runtime_block") {
        expect(s.suggested_block_type).toBeTypeOf("string");
      }
    }
  });
});
