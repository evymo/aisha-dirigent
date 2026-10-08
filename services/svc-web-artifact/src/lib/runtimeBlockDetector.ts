/**
 * Runtime block detector — heuristic mapping of static HTML patterns
 * onto existing AISHA runtime block types.
 *
 * KEY INVARIANT (per plan meta-principle): if a pattern matches a heuristic
 * but no existing block type fits, we emit `preserve_as_static` rather than
 * suggesting a new block. The "new block" case becomes an Aisha-driven
 * dev follow-up story, not an inline addition.
 *
 * Known block types (must match src/lib/builder/blockRegistry.web-blocks.ts +
 * blockRegistry.runtime-blocks.ts):
 *   page-body, hero-slides, news-list, contact-form, discussion-thread, archive-preview,
 *   knowledge-preview, faq-accordion, product-catalog, news-browser, knowledge-browser,
 *   archive-browser, studies-browser, guild-directory, aisha-pruvodce,
 *   community-counter, article-detail, language-switcher, app-banner.
 */
import type { RuntimeBlockSuggestion } from '../schemas.js';

const KNOWN_BLOCKS = new Set([
  'page-body',
  'hero-slides',
  'news-list',
  'article-detail',
  'language-switcher',
  'contact-form',
  'discussion-thread',
  'archive-preview',
  'knowledge-preview',
  'faq-accordion',
  'product-catalog',
  'news-browser',
  'knowledge-browser',
  'archive-browser',
  'studies-browser',
  'guild-directory',
  'aisha-pruvodce',
  'community-counter',
  'app-banner',
]);

interface DetectedPattern {
  element_path: string;
  suggested_block_type: string | null;
  confidence: number;
  data_block_config: Record<string, unknown>;
  original_html_snippet: string;
  reason: string;
}

function elementPath(el: Element): string {
  const segments: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && segments.length < 12) {
    const tag = cur.tagName.toLowerCase();
    const id = cur.id ? `#${cur.id}` : '';
    const cls = cur.classList?.length ? `.${Array.from(cur.classList).slice(0, 2).join('.')}` : '';
    segments.unshift(`${tag}${id}${cls}`);
    cur = cur.parentElement;
  }
  return segments.join(' > ');
}

function snippet(el: Element, maxLen = 320): string {
  const html = el.outerHTML ?? '';
  return html.length <= maxLen ? html : html.slice(0, maxLen) + '…';
}

function matchesClass(el: Element, re: RegExp): boolean {
  const cls = (el.getAttribute('class') ?? '').toLowerCase();
  return re.test(cls);
}

function detectContactForm(form: HTMLFormElement): DetectedPattern | null {
  const inputs = Array.from(form.querySelectorAll('input, textarea'));
  const hasEmail = inputs.some((i) => (i.getAttribute('name') ?? '').toLowerCase().includes('email') || i.getAttribute('type') === 'email');
  const hasMessage = inputs.some((i) => {
    const name = (i.getAttribute('name') ?? '').toLowerCase();
    return i.tagName === 'TEXTAREA' || /message|inquiry|contact|note/.test(name);
  });
  const hasPassword = inputs.some((i) => i.getAttribute('type') === 'password');

  if (hasEmail && hasMessage && !hasPassword) {
    return {
      element_path: elementPath(form),
      suggested_block_type: 'contact-form',
      confidence: 0.85,
      data_block_config: {},
      original_html_snippet: snippet(form),
      reason: 'form with email + textarea-like message field, no password — matches contact-form pattern',
    };
  }
  return null;
}

function detectAuthLoginForm(form: HTMLFormElement): DetectedPattern | null {
  const inputs = Array.from(form.querySelectorAll('input'));
  const hasEmail = inputs.some((i) => (i.getAttribute('name') ?? '').toLowerCase().includes('email') || i.getAttribute('type') === 'email');
  const hasPassword = inputs.some((i) => i.getAttribute('type') === 'password');
  if (hasEmail && hasPassword) {
    // `auth-login` is NOT in KNOWN_BLOCKS so toSuggestion() falls through
    // to the `preserve_as_static` branch and emits a
    // `suggested_followup_story: "Develop new auth-login block with Aisha…"`
    // string. Setting `suggested_block_type: null` here (as it used to be)
    // produced the generic fallback story without the "auth-login" tag,
    // breaking the rule that login flows MUST surface as a follow-up.
    return {
      element_path: elementPath(form),
      suggested_block_type: 'auth-login',
      confidence: 0.7,
      data_block_config: {},
      original_html_snippet: snippet(form),
      reason: 'login-shaped form (email + password) — no auth-login runtime block in registry; preserve_as_static + flag for follow-up Aisha-driven dev story',
    };
  }
  return null;
}

function detectNewsList(el: Element): DetectedPattern | null {
  const cls = (el.getAttribute('class') ?? '').toLowerCase();
  const section = el.getAttribute('data-section')?.toLowerCase() ?? '';
  if (matchesClass(el, /\b(news|articles|posts|blog)\b/) || /(news|articles|blog)/.test(section)) {
    const items = el.querySelectorAll(':scope > li, :scope > article, :scope > .item, :scope > a');
    if (items.length >= 3) {
      return {
        element_path: elementPath(el),
        suggested_block_type: 'news-list',
        confidence: 0.7,
        data_block_config: { limit: Math.min(items.length, 12), columns: 3 },
        original_html_snippet: snippet(el),
        reason: `repeating ${items.length} items in a news/blog-classed container`,
      };
    }
  }
  return null;
}

function detectFaqAccordion(el: Element): DetectedPattern | null {
  if (el.tagName === 'DL' && matchesClass(el, /\bfaq\b/)) {
    return {
      element_path: elementPath(el),
      suggested_block_type: 'faq-accordion',
      confidence: 0.75,
      data_block_config: {},
      original_html_snippet: snippet(el),
      reason: 'definition list with faq class',
    };
  }
  if (el.tagName === 'DIV' || el.tagName === 'SECTION') {
    const detailsCount = el.querySelectorAll(':scope > details, :scope > * > details').length;
    if (detailsCount >= 3) {
      return {
        element_path: elementPath(el),
        suggested_block_type: 'faq-accordion',
        confidence: 0.65,
        data_block_config: {},
        original_html_snippet: snippet(el),
        reason: `${detailsCount} adjacent <details> elements`,
      };
    }
  }
  return null;
}

function detectHero(el: Element): DetectedPattern | null {
  if (!matchesClass(el, /\bhero\b/)) return null;
  const heading = el.querySelector('h1, h2');
  const cta = el.querySelector('a.cta, a.button, button.cta, button.primary, [role=button]');
  if (heading && cta) {
    return {
      element_path: elementPath(el),
      suggested_block_type: 'hero-slides',
      confidence: 0.6,
      data_block_config: { autoplay: false, interval: 5000 },
      original_html_snippet: snippet(el, 480),
      reason: 'hero-classed block with heading + CTA — single-slide variant of hero-slides',
    };
  }
  return null;
}

function detectProductCatalog(el: Element): DetectedPattern | null {
  if (!matchesClass(el, /\b(products|catalog|shop)\b/)) return null;
  const cards = el.querySelectorAll(':scope > * img, :scope > * > * img');
  if (cards.length >= 4) {
    return {
      element_path: elementPath(el),
      suggested_block_type: 'product-catalog',
      confidence: 0.6,
      data_block_config: {},
      original_html_snippet: snippet(el),
      reason: 'products/catalog-classed grid with ≥4 image cards',
    };
  }
  return null;
}

function detectTestimonials(el: Element): DetectedPattern | null {
  if (matchesClass(el, /\b(testimonials|reviews)\b/)) {
    return {
      element_path: elementPath(el),
      suggested_block_type: 'archive-preview',
      confidence: 0.55,
      data_block_config: { limit: 6 },
      original_html_snippet: snippet(el),
      reason: 'testimonials/reviews container — surfaces as archive-preview variant',
    };
  }
  return null;
}

/**
 * Main entry. Walks the body looking for known patterns.
 */
export function detectRuntimeBlocks(doc: Document): RuntimeBlockSuggestion[] {
  const out: RuntimeBlockSuggestion[] = [];

  doc.querySelectorAll('form').forEach((form) => {
    const auth = detectAuthLoginForm(form as HTMLFormElement);
    if (auth) {
      out.push(toSuggestion(auth));
      return;
    }
    const contact = detectContactForm(form as HTMLFormElement);
    if (contact) out.push(toSuggestion(contact));
  });

  const containers = doc.querySelectorAll('ul, ol, section, div, dl');
  containers.forEach((el) => {
    const detectors = [detectNewsList, detectFaqAccordion, detectHero, detectProductCatalog, detectTestimonials];
    for (const fn of detectors) {
      const hit = fn(el);
      if (hit) {
        out.push(toSuggestion(hit));
        break;
      }
    }
  });

  return out;
}

function toSuggestion(p: DetectedPattern): RuntimeBlockSuggestion {
  const block = p.suggested_block_type;
  if (block && KNOWN_BLOCKS.has(block)) {
    return {
      kind: 'runtime_block',
      element_path: p.element_path,
      suggested_block_type: block,
      confidence: p.confidence,
      data_block_config: p.data_block_config,
      original_html_snippet: p.original_html_snippet,
      reason: p.reason,
    };
  }
  return {
    kind: 'preserve_as_static',
    element_path: p.element_path,
    suggested_block_type: null,
    confidence: p.confidence,
    data_block_config: {},
    original_html_snippet: p.original_html_snippet,
    reason: p.reason,
    suggested_followup_story: block ? `Develop new ${block} block with Aisha (no matching runtime block in registry)` : 'Pattern detected without runtime-block match; spin off Aisha-driven dev story',
  };
}
