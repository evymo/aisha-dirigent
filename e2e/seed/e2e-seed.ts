/**
 * E2E Deterministic Seed — ensures known test data exists before E2E run.
 *
 * This module creates minimum viable data for all spec files:
 * - Products (active, inactive, with/without images)
 * - News articles
 * - Hero slides
 * - Web pages (published, draft)
 * - Archive documents
 * - Study/program (active, closed)
 *
 * Uses service_role key via data-factory helpers.
 * Idempotent: checks existence before creating.
 */

const AISHA_POSTGREST_URL = process.env.VITE_AISHA_POSTGREST_URL || "http://127.0.0.1:3001";
const AISHA_POSTGREST_SERVICE_KEY =
  process.env.AISHA_POSTGREST_SERVICE_KEY || "";

async function api<T>(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: unknown
): Promise<T> {
  const response = await fetch(`${AISHA_POSTGREST_URL}${endpoint}`, {
    method,
    headers: {
      apikey: AISHA_POSTGREST_SERVICE_KEY,
      Authorization: `Bearer ${AISHA_POSTGREST_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Seed API ${method} ${endpoint}: ${response.status} — ${text}`);
  }
  return response.json();
}

async function exists(endpoint: string): Promise<boolean> {
  const res = await fetch(`${AISHA_POSTGREST_URL}${endpoint}`, {
    headers: {
      apikey: AISHA_POSTGREST_SERVICE_KEY,
      Authorization: `Bearer ${AISHA_POSTGREST_SERVICE_KEY}`,
      Prefer: "count=exact",
    },
  });
  const count = Number(res.headers.get("content-range")?.split("/")[1] ?? "0");
  return count > 0;
}

// ============================================================================
// SEED DATA DEFINITIONS
// ============================================================================

export const SEED_PRODUCTS = [
  {
    name: "E2E Starter Balíček",
    slug: "e2e-starter-balicek",
    description: "Testovací produkt pro E2E — Starter",
    price: 499,
    is_active: true,
    requires_prescription: false,
    stock_quantity: 50,
  },
  {
    name: "E2E Premium Konzultace",
    slug: "e2e-premium-konzultace",
    description: "Testovací produkt pro E2E — Premium",
    price: 2990,
    is_active: true,
    requires_prescription: false,
    stock_quantity: 10,
  },
  {
    name: "E2E Neaktivní Produkt",
    slug: "e2e-neaktivni-produkt",
    description: "Testovací neaktivní produkt",
    price: 100,
    is_active: false,
    requires_prescription: false,
    stock_quantity: 0,
  },
];

export const SEED_NEWS = [
  {
    title_key: "news.e2e.test.title",
    slug: "e2e-test-clanek",
    content_key: "news.e2e.test.content",
    is_published: true,
    published_at: new Date().toISOString(),
  },
  {
    title_key: "news.e2e.draft.title",
    slug: "e2e-draft-clanek",
    content_key: "news.e2e.draft.content",
    is_published: false,
  },
];

export const SEED_WEB_PAGES = [
  {
    slug: "e2e-testovaci-stranka",
    title_key: "web.e2e.test.title",
    description_key: "web.e2e.test.desc",
    status: "published",
    is_active: true,
    sort_order: 900,
    canvas_html: `<section class="aisha-hero" style="padding:80px 24px 64px;text-align:center;background:linear-gradient(135deg,#1A1A1A 0%,#2D2D2D 100%);color:#fff;">
  <div style="max-width:800px;margin:0 auto;">
    <h1 data-gjs-type="text" style="font-size:3rem;font-weight:800;margin:0 0 16px;">E2E Test Page</h1>
    <p data-gjs-type="text" style="font-size:1.2rem;color:#ccc;margin:0 0 32px;">Published content for E2E testing.</p>
    <a class="aisha-btn" href="#contact" data-gjs-type="link" style="display:inline-block;padding:14px 32px;background:#FF6A1A;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;">Get Started</a>
  </div>
</section>
<section style="padding:64px 24px;background:#fafafa;">
  <div style="max-width:800px;margin:0 auto;text-align:center;">
    <h2 data-gjs-type="text" style="font-size:2rem;font-weight:700;margin:0 0 16px;">Features Section</h2>
    <p data-gjs-type="text" style="color:#666;margin:0;">Three column features grid for testing.</p>
  </div>
</section>`,
    canvas_css: `body { font-family: "Nunito Sans", sans-serif; color: #1A1A1A; margin: 0; }
* { box-sizing: border-box; }
.evymo-btn { transition: opacity 0.2s; }
.evymo-btn:hover { opacity: 0.9; }`,
    page_settings: { background: "#fff" },
  },
  {
    slug: "e2e-draft-stranka",
    title_key: "web.e2e.draft.title",
    description_key: "web.e2e.draft.desc",
    status: "draft",
    is_active: true,
    sort_order: 901,
    canvas_html: `<section style="padding:64px 24px;background:#fff;">
  <div style="max-width:800px;margin:0 auto;">
    <h1 data-gjs-type="text" style="font-size:2rem;font-weight:700;">Draft Page</h1>
    <p data-gjs-type="text" style="color:#666;">This is a draft page for E2E testing.</p>
  </div>
</section>`,
    canvas_css: `body { font-family: "Nunito Sans", sans-serif; margin: 0; }`,
    page_settings: {},
  },
];

// ============================================================================
// SEED FUNCTIONS
// ============================================================================

async function seedProducts(): Promise<void> {
  for (const product of SEED_PRODUCTS) {
    if (await exists(`/rest/v1/products?slug=eq.${product.slug}`)) continue;
    await api("/rest/v1/products", "POST", product);
    console.log(`  [seed] Product: ${product.name}`);
  }
}

async function seedNews(): Promise<void> {
  for (const article of SEED_NEWS) {
    if (await exists(`/rest/v1/news_articles?slug=eq.${article.slug}`)) continue;
    await api("/rest/v1/news_articles", "POST", article);
    console.log(`  [seed] News: ${article.title}`);
  }
}

async function seedWebPages(): Promise<void> {
  for (const page of SEED_WEB_PAGES) {
    if (await exists(`/rest/v1/web_pages?slug=eq.${page.slug}`)) continue;
    await api("/rest/v1/web_pages", "POST", page);
    console.log(`  [seed] Web page: ${page.title}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

export async function runSeed(): Promise<void> {
  console.log("[e2e-seed] Seeding deterministic E2E data...");
  await seedProducts();
  await seedNews();
  await seedWebPages();
  console.log("[e2e-seed] Done.");
}

export async function cleanSeed(): Promise<void> {
  console.log("[e2e-seed] Cleaning E2E seed data...");
  for (const product of SEED_PRODUCTS) {
    await api(`/rest/v1/products?slug=eq.${product.slug}`, "DELETE").catch(() => {});
  }
  for (const article of SEED_NEWS) {
    await api(`/rest/v1/news_articles?slug=eq.${article.slug}`, "DELETE").catch(() => {});
  }
  for (const page of SEED_WEB_PAGES) {
    await api(`/rest/v1/web_pages?slug=eq.${page.slug}`, "DELETE").catch(() => {});
  }
  console.log("[e2e-seed] Clean done.");
}

// CLI entrypoint
if (process.argv[1]?.endsWith("e2e-seed.ts")) {
  const cmd = process.argv[2];
  if (cmd === "clean") {
    cleanSeed().catch(console.error);
  } else {
    runSeed().catch(console.error);
  }
}
