/**
 * AISHA Setup Cockpit — Wizard Engine
 *
 * Pure vanilla JS (no build step, no dependencies).
 * Communicates with the local host server via fetch + SSE.
 */

// ── API helpers ─────────────────────────────────────────────────────────────
const API = "/api";

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

function runScript(scriptId, onLine, onDone) {
  const evtSource = new EventSource(`${API}/run?script=${encodeURIComponent(scriptId)}`);
  evtSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "done") {
      evtSource.close();
      onDone?.(parseInt(data.text, 10));
    } else {
      onLine?.(data.type, data.text);
    }
  };
  evtSource.onerror = () => {
    evtSource.close();
    onDone?.(1);
  };
  return evtSource;
}

// ── State ───────────────────────────────────────────────────────────────────
const state = {
  currentStep: 0,
  deployMode: null,   // "selfhost" | "central" — the two ways in (see CONNECTION_GUIDE.md)
  detect: null,       // OS/HW detection result
  prereqs: null,      // prerequisites check result
  status: null,       // project file status
  backendVariant: null, // "cloud" | "hybrid" | "local" | "minimal"
  aiBackend: null,    // "mlx" | "ollama" | "docker" | "none"
  providerKeys: {},   // { openai: "sk-...", ... }
  modelPreset: null,  // "cost-optimized" | "google-first" | ...
  cloudAuth: null,    // { email, token, storyId }
  web: null,          // { template, brandName, domain, primary, accent }
  consent: { telemetry: false, marketing: false, appDetect: false },
  rulesAccepted: false,
};

// ── Steps definition ────────────────────────────────────────────────────────
const STEPS = [
  { id: "welcome",    label: "Welcome",      render: renderWelcome },
  { id: "detect",     label: "Detection",    render: renderDetection },
  { id: "mode",       label: "Režim",        render: renderMode },
  { id: "prereqs",    label: "Prerequisites", render: renderPrereqs },
  { id: "extension",  label: "Extension",    render: renderExtension },
  { id: "variant",    label: "Backend",      render: renderVariant },
  { id: "providers",  label: "API Keys",     render: renderProviders },
  { id: "models",     label: "Models",       render: renderModels },
  { id: "deploy",     label: "Deploy config", render: renderDeploy },
  { id: "cloud",      label: "Cloud",        render: renderCloud },
  { id: "template",   label: "Šablona",      render: renderWeb },
  { id: "consent",    label: "Consent",      render: renderConsent },
  { id: "rules",      label: "Rules",        render: renderRules },
  { id: "recap",      label: "Recap",        render: renderRecap },
];

// ── DOM refs ────────────────────────────────────────────────────────────────
const $container = document.getElementById("step-container");
const $stepList = document.getElementById("step-list");
const $counter = document.getElementById("step-counter");
const $prev = document.getElementById("btn-prev");
const $next = document.getElementById("btn-next");

// ── Init ────────────────────────────────────────────────────────────────────
function init() {
  // Build progress bar
  $stepList.innerHTML = STEPS.map((s) =>
    `<li data-step="${s.id}">${s.label}</li>`
  ).join("");

  $prev.addEventListener("click", () => goStep(state.currentStep - 1));
  $next.addEventListener("click", () => handleNext());

  // Terminal close
  document.getElementById("terminal-close").addEventListener("click", hideTerminal);

  goStep(0);
}

function goStep(idx) {
  if (idx < 0 || idx >= STEPS.length) return;
  state.currentStep = idx;

  // Update progress
  const items = $stepList.querySelectorAll("li");
  items.forEach((li, i) => {
    li.className = i < idx ? "done" : i === idx ? "active" : "";
  });

  // Update counter (progress is shown by the per-step segment bars)
  $counter.textContent = `${String(idx + 1).padStart(2, "0")} / ${STEPS.length}`;
  $prev.disabled = idx === 0;
  $next.textContent = idx === STEPS.length - 1 ? "Spustit! 🚀" : "Pokračovat →";

  // Render step
  $container.innerHTML = "";
  const div = document.createElement("div");
  div.className = "step active";
  $container.appendChild(div);
  STEPS[idx].render(div);
}

async function handleNext() {
  const step = STEPS[state.currentStep];

  // Step-specific validation / auto-actions
  if (step.id === "welcome") {
    // Trigger detection on leaving welcome
    $next.disabled = true;
    state.detect = await api("/detect");
    state.status = await api("/status");
    $next.disabled = false;
  }

  if (step.id === "detect") {
    // Run prerequisites check
    $next.disabled = true;
    await runPrereqsAsync();
    $next.disabled = false;
  }

  if (step.id === "template") {
    // Persist the chosen starting template + brand values for cold-start/seed.
    // AISHA_SEED_DOMAIN is consumed by svc-web-artifact /seed-default (wired today);
    // the AISHA_BRAND_* values are captured for the branding bootstrap (next phase).
    const name = document.getElementById("brand-name")?.value.trim() || "";
    const domain = document.getElementById("brand-domain")?.value.trim() || "";
    const primary = document.getElementById("brand-primary")?.value || "";
    const accent = document.getElementById("brand-accent")?.value || "";
    state.web = { ...(state.web || {}), brandName: name, domain, primary, accent };
    if (state.web.template) {
      const updates = { AISHA_SEED_DOMAIN: state.web.template };
      if (name) updates.AISHA_BRAND_NAME = name;
      if (domain) updates.AISHA_BRAND_DOMAIN = domain;
      if (primary) updates.AISHA_BRAND_PRIMARY = primary;
      if (accent) updates.AISHA_BRAND_ACCENT = accent;
      try { await api("/env", { method: "POST", body: { file: ".env", updates } }); }
      catch (err) { console.warn("[cockpit] web env write failed", err); }
    }
  }

  if (step.id === "recap") {
    // Final step — run provisioning
    runProvisioning();
    return;
  }

  goStep(state.currentStep + 1);
}

// ── Terminal overlay ────────────────────────────────────────────────────────
function showTerminal(title) {
  document.getElementById("terminal-title").textContent = title;
  document.getElementById("terminal-output").textContent = "";
  document.getElementById("terminal-overlay").classList.remove("hidden");
}

function hideTerminal() {
  document.getElementById("terminal-overlay").classList.add("hidden");
}

function terminalAppend(text) {
  const $out = document.getElementById("terminal-output");
  $out.textContent += text + "\n";
  $out.scrollTop = $out.scrollHeight;
}

function runScriptInTerminal(scriptId, title) {
  return new Promise((resolve) => {
    showTerminal(title);
    runScript(scriptId,
      (type, text) => terminalAppend(text),
      (code) => {
        terminalAppend(code === 0 ? "\n✅ Done" : `\n❌ Exit code: ${code}`);
        resolve(code);
      }
    );
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// STEP RENDERERS
// ══════════════════════════════════════════════════════════════════════════════

// ── Step: Template selection (+ brand) ──────────────────────────────────────
// Lets the operator adopt one of the brand-neutral templates as the instance's
// REAL starting point (not just a throwaway demo) + capture brand values.
// Writes AISHA_SEED_DOMAIN (wired to svc-web-artifact /seed-default) on Continue.
async function renderWeb(el) {
  el.innerHTML = `
    <h2>Výběr šablony</h2>
    <p class="subtitle">Vyberte výchozí šablonu webu jako základ instance. Není to „jen demo“ — je to plnohodnotný start, který si rovnou upravíte. Volba i hodnoty značky se uloží pro nasazení (seed + branding).</p>
    <div id="tpl-gallery" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:20px">Načítám šablony…</div>
    <div class="form-group">
      <label>Název značky</label>
      <input class="input" id="brand-name" placeholder="Např. Moje kavárna">
    </div>
    <div class="form-group">
      <label>Doména</label>
      <input class="input" id="brand-domain" placeholder="např. mojekavarna.cz">
    </div>
    <div style="display:flex;gap:12px">
      <div class="form-group" style="flex:1">
        <label>Primární barva</label>
        <input type="color" class="input" id="brand-primary" value="#FF6A1A" style="height:42px;padding:4px">
      </div>
      <div class="form-group" style="flex:1">
        <label>Akcent</label>
        <input type="color" class="input" id="brand-accent" value="#0E0E10" style="height:42px;padding:4px">
      </div>
    </div>
    <div class="callout callout-info">ℹ️ Šablona se nasadí přes <code>AISHA_SEED_DOMAIN</code> do editoru webu (GrapeJS) včetně překladů a dynamických bloků. Hodnoty značky se uloží do <code>.env</code>.</div>
  `;
  const $gallery = el.querySelector("#tpl-gallery");
  let templates = [];
  try {
    const res = await api("/templates");
    templates = res.templates || [];
  } catch (err) {
    console.warn("[cockpit] Failed to load templates:", err);
    $gallery.textContent = "❌ Nelze načíst šablony.";
    return;
  }
  if (!templates.length) { $gallery.textContent = "Žádné šablony nenalezeny."; return; }
  $gallery.innerHTML = templates.map((t) => `
    <div class="card card-selectable ${state.web && state.web.template === t.slug ? "selected" : ""}" data-tpl="${t.slug}" style="cursor:pointer">
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <span style="width:20px;height:20px;border-radius:5px;display:inline-block;background:${t.primary || "#888"}"></span>
        <span style="width:20px;height:20px;border-radius:5px;display:inline-block;background:${t.accent || "#ccc"}"></span>
      </div>
      <strong style="display:block">${t.name}</strong>
      <p style="font-size:12px;color:var(--text-muted,#8b93a7);margin:6px 0 0">${t.description}</p>
      <span style="font-size:11px;opacity:.55;display:block;margin-top:6px">${t.slug}${t.pages > 1 ? " · " + t.pages + " stránky" : ""}</span>
    </div>
  `).join("");
  if (state.web) {
    el.querySelector("#brand-name").value = state.web.brandName || "";
    el.querySelector("#brand-domain").value = state.web.domain || "";
    if (state.web.primary) el.querySelector("#brand-primary").value = state.web.primary;
    if (state.web.accent) el.querySelector("#brand-accent").value = state.web.accent;
  }
  $gallery.querySelectorAll(".card-selectable").forEach((card) => {
    card.addEventListener("click", () => {
      $gallery.querySelectorAll(".card-selectable").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state.web = { ...(state.web || {}), template: card.dataset.tpl };
    });
  });
}

// ── Step 0: Welcome ─────────────────────────────────────────────────────────
function renderWelcome(el) {
  el.innerHTML = `
    <div class="hero">
      <span class="eyebrow"><span class="dot"></span>Vítejte</span>
      <h2 class="hero-title">Spusťme <span class="brand-slice">AISHA</span><br>na vašem stroji</h2>
      <p class="subtitle">Tento průvodce připraví vaše lokální prostředí, nainstaluje rozšíření do VS Code a pomůže s konfigurací AI backendu — krok za krokem, vše zůstává u vás.</p>
    </div>
    <div class="ahead">
      <h3 class="ahead-title">Co vás čeká</h3>
      <ol class="ahead-list">
        <li>Detekce platformy a hardwaru</li>
        <li>Kontrola prerequisites (Node.js, Docker, …)</li>
        <li>Kompilace a instalace AISHA Dirigent extension</li>
        <li>Výběr backend varianty (Cloud / Hybrid / Local / Minimal)</li>
        <li>Nastavení API klíčů (jen lokálně)</li>
        <li>Konfigurace modelů a presetů</li>
        <li>Volitelná cloud registrace + bezplatná story</li>
        <li>Souhlas s telemetrií a pravidla</li>
        <li>Rekapitulace a spuštění</li>
      </ol>
    </div>
    <div class="callout callout-info">
      🔒 Všechny API klíče zůstávají pouze na vašem počítači. Něco odesíláme jen s vaším výslovným souhlasem.
    </div>
  `;
}

// ── Step 1: Detection ───────────────────────────────────────────────────────
function renderDetection(el) {
  const d = state.detect;
  if (!d) { el.innerHTML = "<p>Načítání…</p>"; return; }

  const osLabel = d.platform === "darwin" ? "macOS" :
    d.platform === "win32" ? "Windows" :
    d.isWSL ? "Linux (WSL)" : "Linux";

  const strategy = d.isAppleSilicon ? "MLX → Ollama → Docker" :
    d.platform === "linux" ? "Ollama → Docker → vLLM" :
    d.platform === "win32" ? "Ollama → Docker Desktop" : "Ollama → Docker";

  el.innerHTML = `
    <h2>Detekce prostředí</h2>
    <p class="subtitle">Zjistili jsme následující o vašem systému:</p>
    <div class="card">
      <ul class="check-list">
        <li class="check-item check-ok">
          <span class="check-icon">🖥</span>
          <span class="check-label">${osLabel} (${d.arch})</span>
          <span class="check-version">${d.hostname}</span>
        </li>
        <li class="check-item check-ok">
          <span class="check-icon">💾</span>
          <span class="check-label">RAM</span>
          <span class="check-version">${d.ramGb} GB</span>
        </li>
        <li class="check-item check-ok">
          <span class="check-icon">🔧</span>
          <span class="check-label">CPU</span>
          <span class="check-version">${d.cpuCores}× ${d.cpuModel}</span>
        </li>
        ${d.isAppleSilicon ? `<li class="check-item check-ok"><span class="check-icon">🍎</span><span class="check-label">Apple Silicon</span><span class="check-version">Metal GPU k dispozici</span></li>` : ""}
        <li class="check-item check-ok">
          <span class="check-icon">📂</span>
          <span class="check-label">Projekt</span>
          <span class="check-version">${d.projectRoot}</span>
        </li>
        <li class="check-item check-ok">
          <span class="check-icon">🟢</span>
          <span class="check-label">Node.js</span>
          <span class="check-version">${d.nodeVersion}</span>
        </li>
      </ul>
    </div>
    <div class="callout callout-info">
      <strong>Doporučená AI strategie pro váš systém:</strong> ${strategy}
    </div>
  `;
}

// ── Step 2: Prerequisites ───────────────────────────────────────────────────
function renderPrereqs(el) {
  const p = state.prereqs;
  if (!p) {
    el.innerHTML = `
      <h2>Kontrola prerequisites</h2>
      <p class="subtitle">Probíhá kontrola…</p>
      <div class="card"><ul class="check-list"><li class="check-item check-spin"><span class="check-icon">⟳</span><span class="check-label">Testování dostupných nástrojů…</span></li></ul></div>
    `;
    return;
  }

  // Each item has an installable script ID (null = cannot auto-install)
  const items = [
    { key: "node", label: "Node.js ≥ 18", icon: "📦", scriptId: "prerequisites-install-node" },
    { key: "npm", label: "npm", icon: "📦", scriptId: "prerequisites-install-node" },
    { key: "docker", label: "Docker", icon: "🐳", scriptId: "prerequisites-install-docker" },
    { key: "dockerCompose", label: "Docker Compose", icon: "🐳", scriptId: "prerequisites-install-docker" },
    { key: "git", label: "Git", icon: "🔀", scriptId: "prerequisites-install-git" },
    { key: "vscode", label: "VS Code CLI (code)", icon: "💻", scriptId: "prerequisites-install-vscode" },
    { key: "ollama", label: "Ollama (optional)", icon: "🤖", scriptId: "prerequisites-install-ollama" },
  ];

  const allRequired = ["node", "npm", "docker", "dockerCompose", "git"];
  const allOk = allRequired.every(k => p[k]?.ok);

  el.innerHTML = `
    <h2>Kontrola prerequisites</h2>
    <p class="subtitle">${allOk ? "Všechny povinné nástroje jsou dostupné ✓" : "Některé nástroje chybí — klikněte Install pro automatickou instalaci"}</p>
    <div class="card">
      <ul class="check-list">
        ${items.map(({ key, label, icon, scriptId }) => {
          const item = p[key];
          if (!item) return "";
          const cls = item.ok ? "check-ok" : (key === "ollama" ? "check-warn" : "check-fail");
          const statusIcon = item.ok ? "✓" : (key === "ollama" ? "–" : "✗");
          const ver = item.version || (item.installed ? "installed" : "missing");
          const installBtn = !item.ok && scriptId
            ? `<button class="btn btn-small btn-action" data-install="${scriptId}" data-tool="${key}">⬇️ Install</button>`
            : "";
          return `<li class="check-item ${cls}"><span class="check-icon">${statusIcon}</span><span class="check-label">${icon} ${label}</span><span class="check-version">${ver}</span>${installBtn}</li>`;
        }).join("")}
      </ul>
    </div>
    ${!allOk ? `
      <div style="display:flex; gap:8px; margin-bottom:16px">
        <button class="btn btn-action" id="install-all-missing">⬇️ Nainstalovat vše chybějící</button>
        <button class="btn btn-secondary" id="recheck-prereqs">🔄 Znovu zkontrolovat</button>
      </div>
    ` : `
      <div style="margin-bottom:16px">
        <button class="btn btn-secondary" id="recheck-prereqs">🔄 Znovu zkontrolovat</button>
      </div>
    `}
  `;

  // Wire per-tool install buttons
  el.querySelectorAll("[data-install]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const scriptId = btn.dataset.install;
      const tool = btn.dataset.tool;
      btn.disabled = true;
      btn.textContent = "⏳…";
      await runScriptInTerminal(scriptId, `Instalace: ${tool}`);
      // Re-check and re-render
      await runPrereqsAsync();
      goStep(state.currentStep);
    });
  });

  // Wire "install all" button
  el.querySelector("#install-all-missing")?.addEventListener("click", async () => {
    await runScriptInTerminal("prerequisites-install", "Instalace chybějících nástrojů");
    await runPrereqsAsync();
    goStep(state.currentStep);
  });

  // Wire re-check button
  el.querySelector("#recheck-prereqs")?.addEventListener("click", async () => {
    state.prereqs = null;
    goStep(state.currentStep); // show spinner
    await runPrereqsAsync();
    goStep(state.currentStep); // re-render with results
  });
}

async function runPrereqsAsync() {
  return new Promise((resolve) => {
    const lines = [];
    runScript("prerequisites",
      (type, text) => { lines.push(text); },
      (code) => {
        try {
          state.prereqs = JSON.parse(lines.join("\n"));
        } catch (err) {
          console.warn("[cockpit] Failed to parse prerequisites output:", err);
          state.prereqs = { error: true };
        }
        resolve();
      }
    );
  });
}

// ── Step 3: Extension ───────────────────────────────────────────────────────
function renderExtension(el) {
  const hasDist = state.status?.hasExtensionDist;

  el.innerHTML = `
    <h2>AISHA Dirigent Extension</h2>
    <p class="subtitle">Zkompilujeme a nainstalujeme rozšíření do VS Code.</p>
    <div class="card">
      <ul class="check-list">
        <li class="check-item ${hasDist ? "check-ok" : "check-warn"}">
          <span class="check-icon">${hasDist ? "✓" : "–"}</span>
          <span class="check-label">Zkompilovaný dist</span>
          <span class="check-version">${hasDist ? "extensions/aisha-dirigent/dist/" : "ještě ne"}</span>
        </li>
      </ul>
    </div>
    <div style="display:flex; gap:8px; margin-bottom:16px">
      <button class="btn btn-action" id="ext-compile">🔧 Compile</button>
      <button class="btn btn-action" id="ext-package">📦 Package .vsix</button>
      <button class="btn btn-action" id="ext-install">⬇️ Install to VS Code</button>
    </div>
    <div class="callout callout-info">
      ℹ️ Po instalaci budete vyzváni k Reload okna ve VS Code, aby se rozšíření aktivovalo.
    </div>
  `;

  el.querySelector("#ext-compile").addEventListener("click", async () => {
    if (!state.status?.hasNodeModules) {
      await runScriptInTerminal("npm-install", "npm install (root)");
    }
    // The extension is NOT a root workspace member, so root `npm install` never
    // installs its deps — install them in the extension dir before compiling,
    // otherwise esbuild is missing and compile → package → install all fail.
    if (!state.status?.hasExtensionNodeModules) {
      await runScriptInTerminal("extension-install-deps", "npm install (extension deps)");
    }
    await runScriptInTerminal("extension-compile", "Kompilace TypeScript → dist/");
    state.status = await api("/status");
    goStep(state.currentStep); // re-render
  });

  el.querySelector("#ext-package").addEventListener("click", async () => {
    await runScriptInTerminal("extension-package", "Balení .vsix");
  });

  el.querySelector("#ext-install").addEventListener("click", async () => {
    await runScriptInTerminal("extension-install", "Instalace do VS Code");
  });
}

// ── Step 4: Backend variant ─────────────────────────────────────────────────
function renderVariant(el) {
  const variants = [
    { id: "cloud", name: "☁️ Full Cloud", desc: "Vše přes AISHA Cloud. Nejjednodušší setup, žádné lokální LLM.", requires: "Internet, API klíče" },
    { id: "hybrid", name: "🔀 Hybrid", desc: "Lokální LLM pro jednoduché úlohy, cloud pro složitější. Optimální poměr cena/výkon.", requires: "Docker, 8+ GB RAM" },
    { id: "local", name: "🏠 Plně lokální", desc: "Kompletně izolované řešení bez odesílání dat. Vyžaduje silnější HW.", requires: "Docker, 16+ GB RAM, lokální LLM" },
    { id: "minimal", name: "⚡ Minimalist", desc: "Pouze frontend + Postgres stack. Bez AI funkcí, pro ruční vývoj.", requires: "Docker" },
  ];

  el.innerHTML = `
    <h2>Výběr backend varianty</h2>
    <p class="subtitle">Jak chcete provozovat AI infrastrukturu?</p>
    <div class="card-grid">
      ${variants.map(v => `
        <div class="card card-selectable ${state.backendVariant === v.id ? "selected" : ""}" data-variant="${v.id}">
          <h3>${v.name}</h3>
          <p>${v.desc}</p>
          <p style="margin-top:8px; font-size:11px; color: var(--yellow)">Vyžaduje: ${v.requires}</p>
        </div>
      `).join("")}
    </div>
    <table class="cap-table">
      <tr><th>Funkce</th><th>Cloud</th><th>Hybrid</th><th>Local</th><th>Minimal</th></tr>
      <tr><td>AI Chat</td><td>✅</td><td>✅</td><td>✅</td><td>❌</td></tr>
      <tr><td>Story routing</td><td>✅</td><td>✅</td><td>✅</td><td>❌</td></tr>
      <tr><td>Model auto-select</td><td>✅</td><td>✅</td><td>✅ (lokální)</td><td>❌</td></tr>
      <tr><td>Edge processing</td><td>❌</td><td>✅</td><td>✅</td><td>❌</td></tr>
      <tr><td>Privátní data</td><td>⚠️ cloud</td><td>✅ lokální</td><td>✅ plně</td><td>✅</td></tr>
      <tr><td>Zero dependencies</td><td>✅</td><td>❌</td><td>❌</td><td>✅</td></tr>
    </table>
  `;

  el.querySelectorAll("[data-variant]").forEach(card => {
    card.addEventListener("click", () => {
      state.backendVariant = card.dataset.variant;
      el.querySelectorAll("[data-variant]").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
    });
  });
}

// ── Step 5: Provider API keys ───────────────────────────────────────────────
function renderProviders(el) {
  if (state.backendVariant === "minimal") {
    el.innerHTML = `
      <h2>API klíče</h2>
      <p class="subtitle">Minimalistická varianta nevyžaduje API klíče.</p>
      <div class="callout callout-ok">✅ Tento krok přeskočte kliknutím na Next.</div>
    `;
    return;
  }

  const providers = [
    { id: "openai", name: "OpenAI", prefix: "sk-", envKey: "OPENAI_API_KEY" },
    { id: "anthropic", name: "Anthropic", prefix: "sk-ant-", envKey: "ANTHROPIC_API_KEY" },
    { id: "google", name: "Google AI (Gemini)", prefix: "AI", envKey: "GOOGLE_AI_API_KEY" },
    { id: "xai", name: "xAI (Grok)", prefix: "xai-", envKey: "XAI_API_KEY" },
  ];

  el.innerHTML = `
    <h2>API klíče providerů</h2>
    <p class="subtitle">Klíče se uloží <strong>pouze do lokálního .env</strong> a nikam se neodešlou.</p>
    ${providers.map(p => `
      <div class="form-group">
        <label>${p.name} <span style="color:var(--text-dim)">(${p.envKey})</span></label>
        <div class="input-row">
          <input type="password" class="input" id="key-${p.id}" placeholder="${p.prefix}…" value="${state.providerKeys[p.id] || ""}">
          <button class="btn btn-action" data-provider="${p.id}">Validate</button>
        </div>
        <div id="key-status-${p.id}" style="font-size:12px; margin-top:4px"></div>
      </div>
    `).join("")}
    <div class="callout callout-info">
      ℹ️ Stačí zadat klíče pro jednoho providera. Doporučujeme minimálně OpenAI nebo Google AI pro základní funkce.
    </div>
    <button class="btn btn-action" id="save-keys">💾 Uložit do .env</button>
    <span id="save-keys-status" style="font-size:12px; margin-left:8px"></span>
  `;

  // Validate buttons
  el.querySelectorAll("[data-provider]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const pid = btn.dataset.provider;
      const key = el.querySelector(`#key-${pid}`).value.trim();
      if (!key) return;
      const $status = el.querySelector(`#key-status-${pid}`);
      $status.textContent = "Validating…";
      $status.style.color = "var(--text-dim)";
      const result = await api("/validate-key", { method: "POST", body: { provider: pid, key } });
      if (result.valid) {
        $status.textContent = "✅ Valid";
        $status.style.color = "var(--green)";
        state.providerKeys[pid] = key;
      } else {
        $status.textContent = "❌ Invalid key";
        $status.style.color = "var(--red)";
      }
    });
  });

  // Save to .env
  el.querySelector("#save-keys").addEventListener("click", async () => {
    const updates = {};
    for (const p of providers) {
      const key = el.querySelector(`#key-${p.id}`).value.trim();
      if (key) {
        updates[p.envKey] = key;
        state.providerKeys[p.id] = key;
      }
    }
    if (Object.keys(updates).length === 0) return;
    const result = await api("/env", { method: "POST", body: { file: ".env", updates } });
    const $s = el.querySelector("#save-keys-status");
    $s.textContent = result.ok ? "✅ Uloženo do .env" : "⚠️ .env neexistuje — spusťte nejdřív setup";
  });
}

// ── Step 6: Models ──────────────────────────────────────────────────────────
function renderModels(el) {
  if (state.backendVariant === "minimal") {
    el.innerHTML = `
      <h2>Konfigurace modelů</h2>
      <p class="subtitle">Minimalistická varianta nepoužívá AI modely.</p>
      <div class="callout callout-ok">✅ Přeskočte tento krok.</div>
    `;
    return;
  }

  // Preset definitions — descriptions are user-facing labels, keys loaded from registry
  const allProviders = "openai,google,anthropic".split(",");
  const presets = [
    { id: "cost-optimized", name: "💰 Cost-Optimized", desc: "Nejlevnější modely všech poskytovatelů v kaskádě", keys: allProviders },
    { id: "google-first", name: "🔵 Google-First", desc: "Pouze Google modely, 1M context", keys: ["google"] },
    { id: "openai-only", name: "🟢 OpenAI-Only", desc: "Pouze OpenAI modely", keys: ["openai"] },
    { id: "anthropic-focused", name: "🟠 Anthropic-Focused", desc: "Nejlepší kvalita kódu, jeden poskytovatel", keys: ["anthropic"] },
    { id: "self-hosted", name: "🏠 Self-Hosted", desc: "Lokální vLLM/Ollama, nulové náklady", keys: [] },
  ];

  el.innerHTML = `
    <h2>Konfigurace modelů</h2>
    <p class="subtitle">Vyberte preset nebo si přizpůsobte výběr modelů pro různé úrovně složitosti.</p>
    <div class="card-grid">
      ${presets.map(p => `
        <div class="card card-selectable ${state.modelPreset === p.id ? "selected" : ""}" data-preset="${p.id}">
          <h3>${p.name}</h3>
          <p>${p.desc}</p>
          ${p.keys.length > 0 ? `<p style="font-size:11px; color:var(--text-dim); margin-top:6px">Vyžaduje: ${p.keys.join(", ")}</p>` : ""}
        </div>
      `).join("")}
    </div>
    <button class="btn btn-action" id="apply-preset">📝 Aplikovat preset do .env</button>
    <span id="preset-status" style="font-size:12px; margin-left:8px"></span>
  `;

  el.querySelectorAll("[data-preset]").forEach(card => {
    card.addEventListener("click", () => {
      state.modelPreset = card.dataset.preset;
      el.querySelectorAll("[data-preset]").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
    });
  });

  el.querySelector("#apply-preset").addEventListener("click", async () => {
    if (!state.modelPreset) return;
    await runScriptInTerminal("models-wizard-show", "Aktuální konfigurace modelů");
  });
}

// ── Step 7: Cloud ───────────────────────────────────────────────────────────
// ── Mode choice: the two ways in (self-host vs connect to central) ────────────
function renderMode(el) {
  const pick = (mode) => {
    state.deployMode = mode;
    el.querySelectorAll("[data-mode]").forEach((c) =>
      c.classList.toggle("selected", c.getAttribute("data-mode") === mode));
    el.querySelector("#mode-hint").textContent =
      mode === "selfhost"
        ? "→ Doplníš infra/topology inputy (krok „Deploy config“) a spustíš cold-start. Krok „Cloud“ přeskoč."
        : "→ Přeskoč „Deploy config“. V kroku „Cloud“ se přihlásíš ke své AISHA (výchozí: gateway lokálního stacku z local-warmup) a napojíš editor přes PAT.";
  };
  el.innerHTML = `
    <h2>Jak chceš AISHA používat?</h2>
    <p class="subtitle">Dvě cesty. Vyber jednu — průvodce ti pak ukáže jen kroky té cesty. Detaily: <code>docs/onboarding/CONNECTION_GUIDE.md</code>.</p>
    <div class="card-grid">
      <div class="card card-selectable" data-mode="selfhost">
        <h3>🏠 Vlastní instance (self-host)</h3>
        <p>Rozjedeš CELÝ stack na svém Coolify — vlastní domény, data, uživatelé. Fork.</p>
        <p style="font-size:12px">Dodáš: Coolify creds (+ GitHub token pro git operace), 3 TLD, admin e-mail, profil. Zbytek se generuje/derivuje.</p>
      </div>
      <div class="card card-selectable" data-mode="central">
        <h3>🔌 Napojení na existující AISHA</h3>
        <p>Doplněk (Dirigent) řídí TVŮJ projekt proti AISHA, která už běží — lokální stack (gateway z <code>local-warmup</code>) nebo tvoje nasazená instance.</p>
        <p style="font-size:12px">Dodáš: jen přihlášení → PAT pro tvou story. Editor napojíš přes base-URL + token.</p>
      </div>
    </div>
    <div id="mode-hint" class="callout callout-info" style="margin-top:14px">Vyber režim výše.</div>`;
  el.querySelectorAll("[data-mode]").forEach((card) =>
    card.addEventListener("click", () => pick(card.getAttribute("data-mode"))));
  if (state.deployMode) pick(state.deployMode);
}

// ── Self-host: operator inputs (schema-driven from /api/operator-inputs) ───────
async function renderDeploy(el) {
  if (state.deployMode === "central") {
    el.innerHTML = `<h2>Deploy config</h2>
      <div class="callout callout-ok">✅ Režim „napojení na centrálu“ — tenhle krok přeskoč (kliknutím na Pokračovat). Instanci nehostuješ.</div>`;
    return;
  }
  el.innerHTML = `<h2>Deploy config (fork inputs)</h2>
    <p class="subtitle">To, co MUSÍ dodat operátor pro vlastní instanci — vše ostatní se generuje/derivuje. Uloží se jen do lokálního <code>.env.local</code>.</p>
    <div id="deploy-body">Načítám schéma…</div>`;
  let data;
  try { data = await api("/operator-inputs"); }
  catch (e) { el.querySelector("#deploy-body").innerHTML = `<div class="callout callout-warn">Nelze načíst schéma: ${e.message}</div>`; return; }
  const groups = {};
  for (const i of data.inputs) (groups[i.category] ||= []).push(i);
  const body = el.querySelector("#deploy-body");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  body.innerHTML = Object.entries(data.categories).map(([cat, meta]) => {
    const items = (groups[cat] || []).filter((i) => !i.file);
    if (!items.length) return "";
    return `<h3 style="margin-top:18px">${esc(meta.split(" — ")[0])}</h3>
      ${items.map((i) => `
        <div class="form-group">
          <label>${esc(i.label)} <span style="color:var(--text-dim)">(${esc(i.key)})</span>
            ${i.required ? '<span class="badge badge-ok">required</span>' : '<span style="color:var(--text-dim);font-size:11px">optional</span>'}
            ${data.present[i.key] ? '<span style="color:var(--text-dim)">· ✓ set</span>' : ""}</label>
          <input type="${i.secret ? "password" : "text"}" class="input" id="di-${esc(i.key)}" placeholder="${esc(i.secret ? "•••" : (i.example || ""))}">
          <div style="font-size:12px;color:var(--text-dim)">${esc(i.description)}</div>
        </div>`).join("")}`;
  }).join("");
  body.innerHTML += `
    <button class="btn btn-action" id="deploy-save">💾 Uložit do .env.local</button>
    <span id="deploy-save-status" style="font-size:12px;margin-left:8px"></span>
    <button class="btn btn-action" id="deploy-verify" style="margin-left:12px">🔎 Ověřit lokálně</button>
    <div class="callout callout-info" style="margin-top:12px">ℹ️ Po uložení spusť deploy: <code>bash scripts/aisha-cold-start.sh</code>. Viz <code>CONNECTION_GUIDE.md</code>.</div>`;
  body.querySelector("#deploy-save").addEventListener("click", async () => {
    // Secrets go to .env-prod-backup (the secrets home cold-start reads);
    // non-secret config to .env.local — mirrors cold-start's own split.
    const secretKeys = new Set(data.inputs.filter((i) => i.secret && !i.file).map((i) => i.key));
    const secretUpd = {}, configUpd = {};
    for (const i of data.inputs) {
      if (i.file) continue;
      const v = document.getElementById(`di-${i.key}`)?.value.trim();
      if (!v) continue;
      (secretKeys.has(i.key) ? secretUpd : configUpd)[i.key] = v;
    }
    const st = body.querySelector("#deploy-save-status");
    const n = Object.keys(secretUpd).length + Object.keys(configUpd).length;
    if (!n) { st.textContent = "nic k uložení"; return; }
    try {
      if (Object.keys(secretUpd).length) await api("/env", { method: "POST", body: { file: ".env-prod-backup", updates: secretUpd } });
      if (Object.keys(configUpd).length) await api("/env", { method: "POST", body: { file: ".env.local", updates: configUpd } });
      st.textContent = `✅ uloženo ${n} (secrets→.env-prod-backup, config→.env.local)`;
    } catch (e) {
      console.error("operator-inputs save failed:", e); // surface + log, don't swallow
      st.textContent = "✗ " + e.message;
    }
  });
  body.querySelector("#deploy-verify").addEventListener("click", () =>
    runScriptInTerminal("operator-setup-verify", "Ověřuji lokálně…"));
}

async function renderCloud(el) {
  if (state.backendVariant === "local" || state.backendVariant === "minimal") {
    el.innerHTML = `
      <h2>Cloud připojení</h2>
      <p class="subtitle">Vámi zvolená varianta (${state.backendVariant}) nepotřebuje cloud připojení.</p>
      <div class="callout callout-ok">✅ Přeskočte tento krok. Pokud chcete cloud kdykoliv později, použijte <code>@aisha /connect</code> v extension.</div>
    `;
    return;
  }

  el.innerHTML = `
    <h2>AISHA Cloud</h2>
    <p class="subtitle">Připojení ke cloud backendu a vytvoření bezplatné story.</p>
    <div class="card">
      <h3>Co získáte:</h3>
      <ul style="padding-left:20px; color:var(--text-dim); font-size:14px; line-height:2">
        <li>Přístup k AISHA Cloud API (MCP Knowledge Server)</li>
        <li>Jedna bezplatná unnamed story pro libovolný projekt</li>
        <li>Konfigurovatelná pravidla pro vývoj</li>
        <li>Synchronizace nastavení s mobilní appkou</li>
      </ul>
    </div>

    <div class="form-group">
      <label>E-mail</label>
      <input type="email" class="input" id="cloud-email" placeholder="your@email.com">
    </div>
    <div class="form-group">
      <label>Heslo</label>
      <input type="password" class="input" id="cloud-password" placeholder="Min. 8 znaků">
    </div>
    <div style="display:flex; gap:8px; margin-bottom:16px">
      <button class="btn btn-action" id="cloud-signup">📝 Registrace</button>
      <button class="btn btn-action" id="cloud-login">🔑 Přihlášení</button>
    </div>
    <div id="cloud-status" style="font-size:13px; margin-bottom:16px"></div>

    <!-- After login: pick a story + mint a PAT → wire the editor to ask.<tld>/v1 -->
    <div id="cloud-napoj" style="display:none; margin-bottom:16px"></div>

    <div class="callout callout-info">
      ℹ️ Přihlášení běží přes zabezpečený AISHA gateway endpoint (Keycloak SSO). Heslo se v tomto lokálním cockpitu nikdy neukládá. Registrace nového účtu se otevře v prohlížeči.
    </div>
  `;

  // Cloud config (gateway URL + public anon key) is fetched by the host from the
  // backend's public .well-known bootstrap — no hardcoded URLs/keys in the repo.
  let CLOUD_URL, CLOUD_ANON_KEY, CLOUD_WEB_URL, CLOUD_ASK_URL;
  try {
    const cfg = await api("/cloud-config");
    CLOUD_URL = cfg.url;
    CLOUD_ANON_KEY = cfg.anonKey;
    CLOUD_WEB_URL = cfg.webUrl;
    CLOUD_ASK_URL = cfg.askUrl;
    if (!CLOUD_ANON_KEY) {
      // The anon key is SERVED BY a running stack — empty just means the backend
      // is not reachable / not deployed yet, not a hard failure.
      el.querySelector("#cloud-status").textContent =
        cfg.source === "unreachable"
          ? `⚠️ Backend ${CLOUD_URL} není dostupný. Nahoď stack (nebo deployuj vlastní) a zkus znovu.`
          : `⚠️ Backend zatím neposkytuje anon klíč — až poběží stack, načte se automaticky.`;
    }
  } catch (err) {
    console.warn("[cockpit] Failed to load cloud config:", err);
    el.querySelector("#cloud-status").textContent = "❌ Nelze načíst konfiguraci cloudu (host neodpověděl).";
    return;
  }

  async function cloudAuth(endpoint) {
    const email = el.querySelector("#cloud-email").value.trim();
    const password = el.querySelector("#cloud-password").value;
    const $status = el.querySelector("#cloud-status");

    if (!email || !password) { $status.textContent = "⚠️ Vyplňte e-mail a heslo."; return; }
    $status.textContent = "⏳ Probíhá…";

    try {
      const resp = await fetch(`${CLOUD_URL}/auth/v1/${endpoint}?grant_type=password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: CLOUD_ANON_KEY,
        },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.access_token) {
        state.cloudAuth = { email, token: data.access_token, userId: data.user?.id };
        $status.textContent = `✅ Přihlášen jako ${email}`;
        // Write cloud config to .env
        await api("/env", { method: "POST", body: {
          file: ".env",
          updates: {
            VITE_AISHA_GATEWAY_URL: CLOUD_URL,
            VITE_AISHA_GATEWAY_KEY: CLOUD_ANON_KEY,
          }
        }});
        // Now offer to mint a story-scoped PAT + wire the editor to ask.<tld>/v1.
        await showNapoj();
      } else {
        $status.textContent = `❌ ${data.error_description || data.msg || "Chyba autentifikace"}`;
      }
    } catch (e) {
      $status.textContent = `❌ Připojení selhalo: ${e.message}`;
    }
  }

  // ── PAT-mint + editor napoj (after login) ────────────────────────────────
  // Call a PostgREST RPC with the logged-in user's KC bearer (RLS applies).
  async function cloudRpc(fn, body) {
    const resp = await fetch(`${CLOUD_URL.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CLOUD_ANON_KEY,
        Authorization: `Bearer ${state.cloudAuth.token}`,
      },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`${fn}: HTTP ${resp.status}`);
    return resp.json();
  }

  // Escape every value interpolated into innerHTML — story titles are
  // user-controlled (self-XSS otherwise), askUrl comes off the backend.
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function showNapoj() {
    const box = el.querySelector("#cloud-napoj");
    box.style.display = "block";
    const askUrl = CLOUD_ASK_URL || "";
    if (!askUrl) {
      box.innerHTML = `<div style="font-size:13px; color:#c60">⚠️ Backend zatím neposkytuje model URL (ask_url). Až poběží aktuální stack, napoj se zpřístupní.</div>`;
      return;
    }
    box.innerHTML = `<div style="font-size:13px; color:var(--text-dim)">⏳ Načítám tvé story…</div>`;
    let stories = [];
    try {
      stories = await cloudRpc("get_my_stories", {});
      if (!Array.isArray(stories)) stories = [];
      if (stories.length === 0) {
        await cloudRpc("ensure_member_story_exists", {}); // create the member's default story
        stories = await cloudRpc("get_my_stories", {});
      }
    } catch (e) {
      box.innerHTML = `<div style="font-size:13px; color:#c60">⚠️ Nepodařilo se načíst story: ${esc(e.message)}</div>`;
      return;
    }
    const opts = (stories || [])
      .map((s) => `<option value="${esc(s.id)}">${esc(s.title || s.id)}</option>`)
      .join("");
    box.innerHTML = `
      <div class="card">
        <h3>🔌 Napojit editor na AISHU (model)</h3>
        <p style="font-size:12px; color:var(--text-dim)">Vyber story, na kterou se PAT naváže. Editor pak jede přes <code>${esc(askUrl)}</code>.</p>
        <div class="form-group">
          <label>Story</label>
          <select class="input" id="napoj-story">${opts}</select>
        </div>
        <div class="form-group">
          <label>…nebo vytvoř novou (název)</label>
          <input class="input" id="napoj-new" placeholder="Nechte prázdné pro vybranou výše">
        </div>
        <button class="btn btn-action" id="napoj-go">🔑 Vytvořit PAT + napojit</button>
        <div id="napoj-status" style="font-size:13px; margin-top:10px"></div>
      </div>`;
    el.querySelector("#napoj-go").addEventListener("click", () => doNapoj(askUrl));
  }

  async function doNapoj(askUrl) {
    const $s = el.querySelector("#napoj-status");
    $s.textContent = "⏳ Mintování PATu…";
    try {
      let storyId = el.querySelector("#napoj-story")?.value || "";
      const newName = (el.querySelector("#napoj-new")?.value || "").trim();
      if (newName) {
        try {
          storyId = await cloudRpc("create_story_audited", { p_title: newName, p_user_id: state.cloudAuth.userId });
        } catch (e) {
          $s.textContent = `⚠️ Novou story se nepodařilo vytvořit (${e.message}); použij vybranou z nabídky.`;
          return;
        }
      }
      if (!storyId) { $s.textContent = "⚠️ Vyber nebo vytvoř story."; return; }
      const resp = await fetch(`${CLOUD_URL.replace(/\/$/, "")}/auth/v1/pats`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.cloudAuth.token}` },
        body: JSON.stringify({ story_id: storyId }),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`mint PAT: HTTP ${resp.status}`);
      const pat = await resp.json();
      const token = pat.raw_token || pat.token;
      if (!token) throw new Error("mint vrátil prázdný token");
      // The PAT never leaves this local cockpit → .env (gitignored operator file).
      await api("/env", { method: "POST", body: {
        file: ".env",
        updates: {
          ANTHROPIC_BASE_URL: askUrl,
          ANTHROPIC_AUTH_TOKEN: token,
          AISHA_MODEL_STORY_ID: storyId,
        }
      }});
      $s.textContent = `✅ Napojeno. Editor jede přes ${askUrl} (PAT zapsán do .env). Restartuj editor / terminál.`;
    } catch (e) {
      $s.textContent = `❌ ${e.message}`;
    }
  }

  // KC self-registration happens in the browser (the gateway has no ROPC signup
  // — /auth/v1 proxies KC OIDC, which registers via the hosted login page).
  el.querySelector("#cloud-signup").addEventListener("click", () => {
    const target = CLOUD_WEB_URL || CLOUD_URL;
    window.open(target, "_blank", "noopener");
    el.querySelector("#cloud-status").textContent =
      `🌐 Registrace probíhá v prohlížeči na ${target}. Po dokončení se sem vrať a přihlas se.`;
  });
  el.querySelector("#cloud-login").addEventListener("click", () => cloudAuth("token"));
}

// ── Step 8: Consent ─────────────────────────────────────────────────────────
function renderConsent(el) {
  el.innerHTML = `
    <h2>Souhlas a telemetrie</h2>
    <p class="subtitle">Vše je defaultně vypnuté. Zapnete jen to, co chcete.</p>

    <div class="card">
      <div class="checkbox-row">
        <input type="checkbox" id="consent-telemetry" ${state.consent.telemetry ? "checked" : ""}>
        <label for="consent-telemetry">
          <strong>Anonymizovaná diagnostika</strong><br>
          <span style="font-size:12px; color:var(--text-dim)">Pomáhá nám zlepšovat onboarding. Neobsahuje žádná osobní data ani API klíče.</span>
        </label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="consent-marketing" ${state.consent.marketing ? "checked" : ""}>
        <label for="consent-marketing">
          <strong>Novinky a tipy</strong><br>
          <span style="font-size:12px; color:var(--text-dim)">Občas vám pošleme zprávu o novinkách AISHA platformy.</span>
        </label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="consent-appdetect" ${state.consent.appDetect ? "checked" : ""}>
        <label for="consent-appdetect">
          <strong>Detekce mobilní appky</strong><br>
          <span style="font-size:12px; color:var(--text-dim)">Zjistíme, zda máte nainstalovanou AISHA mobilní aplikaci pro lepší integraci.</span>
        </label>
      </div>
    </div>

    <div class="callout callout-info">
      🎁 <strong>Bonus:</strong> Pokud zapnete anonymizovanou diagnostiku, získáte jednu extra bezplatnou story pro další projekt.
    </div>
  `;

  el.querySelector("#consent-telemetry").addEventListener("change", (e) => { state.consent.telemetry = e.target.checked; });
  el.querySelector("#consent-marketing").addEventListener("change", (e) => { state.consent.marketing = e.target.checked; });
  el.querySelector("#consent-appdetect").addEventListener("change", (e) => { state.consent.appDetect = e.target.checked; });
}

// ── Step 9: Rules ───────────────────────────────────────────────────────────
function renderRules(el) {
  el.innerHTML = `
    <h2>Vývojová pravidla</h2>
    <p class="subtitle">AISHA obsahuje sadu expertních pravidel pro kvalitní vývoj. Můžete je přijmout a nasadit jako baseline.</p>

    <div class="card">
      <h3>Co pravidla obsahují:</h3>
      <ul style="padding-left:20px; color:var(--text-dim); font-size:14px; line-height:2">
        <li>OWASP Top 10 bezpečnostní kontroly</li>
        <li>TypeScript best practices (no <code>any</code>, no <code>console.log</code>)</li>
        <li>i18n povinnost — žádný hardcoded text v JSX</li>
        <li>RLS policies na nové tabulky</li>
        <li>Audit journal pro citlivé operace</li>
        <li>Gate testy před pushem</li>
      </ul>
    </div>

    <div class="checkbox-row" style="margin-top:12px">
      <input type="checkbox" id="rules-accept" ${state.rulesAccepted ? "checked" : ""}>
      <label for="rules-accept"><strong>Přijmout a nainstalovat vývojová pravidla</strong></label>
    </div>

    <div class="callout callout-info">
      ℹ️ Pravidla se uloží do <code>.github/copilot-instructions.md</code> a <code>AGENTS.md</code>. Můžete je kdykoliv upravit nebo odebrat.
    </div>
  `;

  el.querySelector("#rules-accept").addEventListener("change", (e) => { state.rulesAccepted = e.target.checked; });
}

// ── Step 10: Recap ──────────────────────────────────────────────────────────
function renderRecap(el) {
  const variant = { cloud: "☁️ Cloud", hybrid: "🔀 Hybrid", local: "🏠 Local", minimal: "⚡ Minimal" }[state.backendVariant] ?? "—";
  const preset = state.modelPreset ?? "—";
  const cloud = state.cloudAuth ? `✅ ${state.cloudAuth.email}` : "❌ Nepřipojeno";
  const keys = Object.keys(state.providerKeys).filter(k => state.providerKeys[k]).join(", ") || "žádné";
  const consent = [
    state.consent.telemetry && "diagnostika",
    state.consent.marketing && "novinky",
    state.consent.appDetect && "detekce appky"
  ].filter(Boolean).join(", ") || "žádný";

  el.innerHTML = `
    <h2>Rekapitulace</h2>
    <p class="subtitle">Zkontrolujte nastavení před spuštěním.</p>
    <div class="card">
      <table class="cap-table">
        <tr><td><strong>Backend varianta</strong></td><td>${variant}</td></tr>
        <tr><td><strong>Model preset</strong></td><td>${preset}</td></tr>
        <tr><td><strong>API klíče</strong></td><td>${keys}</td></tr>
        <tr><td><strong>Cloud account</strong></td><td>${cloud}</td></tr>
        <tr><td><strong>Souhlas</strong></td><td>${consent}</td></tr>
        <tr><td><strong>Pravidla</strong></td><td>${state.rulesAccepted ? "✅ Přijata" : "❌ Odmítnuta"}</td></tr>
      </table>
    </div>

    <div class="callout callout-info">
      🚀 Po kliknutí na <strong>Launch!</strong> se spustí provisioning — instalace závislostí, konfigurace, migrace databáze a nastavení AI backendu. Průběh uvidíte v terminálu.
    </div>
  `;
}

// ── Provisioning ────────────────────────────────────────────────────────────
async function runProvisioning() {
  const steps = [];

  // 1. npm install if needed
  if (!state.status?.hasNodeModules) {
    steps.push(["npm-install", "npm install"]);
  }

  // 2. Core setup variant
  if (state.backendVariant === "minimal" || state.backendVariant === "cloud") {
    steps.push(["setup-core", "Core setup (stack + env)"]);
  } else if (state.backendVariant === "hybrid") {
    steps.push(["setup-core", "Core setup"]);
  } else if (state.backendVariant === "local") {
    steps.push(["setup-backend", "Full local setup (+ backend)"]);
  }

  // 3. AI backend setup for non-minimal
  if (state.backendVariant !== "minimal") {
    if (state.modelPreset === "self-hosted") {
      steps.push(["ai-auto-install", "Auto-install lokální LLM backend"]);
    }
    // Set AI mode
    const mode = state.backendVariant === "cloud" ? "ai-mode-cloud" :
      state.backendVariant === "hybrid" ? "ai-mode-hybrid" : "ai-mode-local";
    steps.push([mode, `Nastavení AI režimu: ${state.backendVariant}`]);
  }

  // 4. Model preset
  if (state.modelPreset && state.backendVariant !== "minimal") {
    steps.push(["models-wizard-show", `Model preset: ${state.modelPreset}`]);
  }

  // 5. Dirigent bootstrap
  if (state.cloudAuth || state.backendVariant !== "minimal") {
    steps.push(["dirigent-bootstrap", "Bootstrap Dirigent config"]);
  }

  // Run all steps sequentially
  showTerminal("🚀 Provisioning");
  for (const [scriptId, label] of steps) {
    terminalAppend(`\n━━━ ${label} ━━━\n`);
    const code = await new Promise((resolve) => {
      runScript(scriptId,
        (type, text) => terminalAppend(text),
        (code) => resolve(code)
      );
    });
    if (code !== 0) {
      terminalAppend(`\n❌ Krok "${label}" selhal (exit ${code}). Detaily viz výstup výše. Manuální postup: README.md.`);
      return;
    }
  }

  terminalAppend("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  terminalAppend("✅ Setup dokončen!");
  terminalAppend("");
  terminalAppend("Další kroky:");
  terminalAppend("  1. Reload VS Code okna (Cmd/Ctrl+Shift+P → Reload Window)");
  terminalAppend("  2. Otevřete chat: @aisha /status");
  terminalAppend("  3. Začněte pracovat: @aisha /onboard");
  terminalAppend("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

// ── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);
