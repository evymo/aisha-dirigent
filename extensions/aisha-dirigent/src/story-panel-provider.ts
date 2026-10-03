/**
 * Story Panel Provider — AISHA Story Feed webview.
 *
 * Renders as a panel in the secondary sidebar alongside Copilot / Claude Code / Codex.
 * Shows story list (project diary list) and detail thread when a story is selected.
 * Supports create story, post entry, per-story knowledge/rules display.
 *
 * Browse story selection in this panel does NOT change the active runtime story
 * used by orchestration. That requires an explicit "Set as Active" action.
 *
 * @module
 */

import * as vscode from "vscode";
import { getAuthState, onAuthStateChanged } from "./auth";
import { resolveStoryContext } from "./story-context";
import {
  listStories,
  listEntries,
  createStory,
  postEntry,
  getStoryContext,
  type Story,
  type StoryEntry,
  type StoryKnowledge,
} from "./story-service";
import { recordApiCall } from "./resource-tracker";
import type { AishaPushEvent } from "./aisha-push";

/** Messages FROM webview → extension */
interface WebviewMessage {
  type:
    | "ready"
    | "loadStories"
    | "openStory"
    | "postEntry"
    | "createStory"
    | "loadContext"
    | "setActiveStory"
    | "refresh"
    | "loadMoreEntries";
  storyId?: string;
  text?: string;
  title?: string;
  summary?: string;
  entryType?: string;
  offset?: number;
}

export class StoryPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aisha.dirigent.storyPanel";

  private webviewView: vscode.WebviewView | undefined;
  private browseStoryId: string | null = null;
  private stories: Story[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.renderHtml(webviewView.webview);

    const msgDisposable = webviewView.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => void this.handleMessage(msg),
    );

    const authDisposable = onAuthStateChanged(() => {
      void this.sendAuthState();
    });

    this.disposables.push(msgDisposable, authDisposable);

    webviewView.onDidDispose(() => {
      for (const d of this.disposables) d.dispose();
      this.disposables = [];
    });
  }

  /** Forward push events into the panel */
  handlePushEvent(event: AishaPushEvent): void {
    if (!this.webviewView) return;
    void this.webviewView.webview.postMessage({
      type: "pushEvent",
      title: event.title,
      body: event.body,
      eventType: event.type,
      storyId: (event.metadata as Record<string, unknown>)?.story_id,
    });
  }

  /** Refresh stories list from outside */
  async refreshStories(): Promise<void> {
    this.stories = await listStories();
    void this.webviewView?.webview.postMessage({
      type: "stories",
      stories: this.stories,
    });
  }

  // ── Message handler ───────────────────────

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendAuthState();
        await this.loadStories();
        break;

      case "loadStories":
        await this.loadStories();
        break;

      case "openStory":
        if (msg.storyId) {
          this.browseStoryId = msg.storyId;
          await this.loadStoryDetail(msg.storyId);
        }
        break;

      case "loadMoreEntries":
        if (msg.storyId && msg.offset != null) {
          const entries = await listEntries(msg.storyId, { offset: msg.offset });
          void this.webviewView?.webview.postMessage({
            type: "moreEntries",
            entries,
            storyId: msg.storyId,
          });
        }
        break;

      case "postEntry":
        if (msg.storyId && msg.text) {
          const entry = await postEntry({
            story_id: msg.storyId,
            content: msg.text,
            entry_type: msg.entryType ?? "note",
          });
          if (entry) {
            void this.webviewView?.webview.postMessage({
              type: "entryPosted",
              entry,
              storyId: msg.storyId,
            });
          } else {
            void this.webviewView?.webview.postMessage({
              type: "error",
              message: "Failed to post entry.",
            });
          }
        }
        break;

      case "createStory":
        if (msg.title) {
          const story = await createStory({
            title: msg.title,
            summary: msg.summary,
          });
          if (story) {
            this.stories.unshift(story);
            void this.webviewView?.webview.postMessage({
              type: "storyCreated",
              story,
              stories: this.stories,
            });
          } else {
            void this.webviewView?.webview.postMessage({
              type: "error",
              message: "Failed to create story.",
            });
          }
        }
        break;

      case "loadContext":
        if (msg.storyId) {
          const ctx = await getStoryContext(msg.storyId);
          void this.webviewView?.webview.postMessage({
            type: "storyContext",
            storyId: msg.storyId,
            context: ctx,
          });
        }
        break;

      case "setActiveStory":
        if (msg.storyId) {
          const { persistStoryId } = await import("./story-context.js");
          await persistStoryId(msg.storyId);
          void vscode.window.showInformationMessage(
            `AISHA: Active story set to ${this.stories.find((s) => s.id === msg.storyId)?.title ?? msg.storyId.slice(0, 8)}`,
          );
          void this.webviewView?.webview.postMessage({
            type: "activeStoryChanged",
            storyId: msg.storyId,
          });
        }
        break;

      case "refresh":
        await this.loadStories();
        if (this.browseStoryId) {
          await this.loadStoryDetail(this.browseStoryId);
        }
        break;
    }
  }

  private async sendAuthState(): Promise<void> {
    const auth = getAuthState();
    const story = await resolveStoryContext();
    void this.webviewView?.webview.postMessage({
      type: "authState",
      authenticated: auth.isAuthenticated,
      email: auth.email,
      activeStoryId: story.storyId,
    });
  }

  private async loadStories(): Promise<void> {
    void this.webviewView?.webview.postMessage({ type: "loading", target: "stories" });
    this.stories = await listStories();
    const activeStory = await resolveStoryContext();
    void this.webviewView?.webview.postMessage({
      type: "stories",
      stories: this.stories,
      activeStoryId: activeStory.storyId,
    });
  }

  private async loadStoryDetail(storyId: string): Promise<void> {
    void this.webviewView?.webview.postMessage({ type: "loading", target: "detail" });
    const entries = await listEntries(storyId);
    const story = this.stories.find((s) => s.id === storyId);
    void this.webviewView?.webview.postMessage({
      type: "storyDetail",
      story,
      entries,
      storyId,
    });
  }

  // ── HTML renderer ─────────────────────────

  private renderHtml(_webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AISHA Stories</title>
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border, rgba(128,128,128,.25));
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border, transparent);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --btn-secondary: var(--vscode-button-secondaryBackground);
      --btn-secondary-fg: var(--vscode-button-secondaryForeground);
      --badge-bg: var(--vscode-badge-background);
      --badge-fg: var(--vscode-badge-foreground);
      --muted: var(--vscode-descriptionForeground);
      --link: var(--vscode-textLink-foreground);
      --list-hover: var(--vscode-list-hoverBackground);
      --list-active: var(--vscode-list-activeSelectionBackground);
      --list-active-fg: var(--vscode-list-activeSelectionForeground);
      --error: var(--vscode-errorForeground);
      --success: var(--vscode-testing-iconPassed, #73c991);
      --warning: var(--vscode-editorWarning-foreground, #cca700);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; font: 13px/1.5 var(--vscode-font-family, system-ui); color: var(--fg); background: var(--bg); }
    button { font: inherit; cursor: pointer; }
    input, textarea { font: inherit; }

    .app { display: flex; flex-direction: column; height: 100%; }

    /* ── Header bar ── */
    .topbar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .topbar .title { font-weight: 600; font-size: 12px; flex-shrink: 0; }
    .topbar .spacer { flex: 1; }
    .icon-btn { background: none; border: none; color: var(--fg); padding: 2px 4px; border-radius: 3px; font-size: 14px; line-height: 1; }
    .icon-btn:hover { background: var(--list-hover); }

    /* ── Views ── */
    .view { display: none; flex-direction: column; flex: 1; overflow: hidden; }
    .view.active { display: flex; }

    /* ── Auth wall ── */
    .auth-wall { padding: 32px 16px; text-align: center; color: var(--muted); }
    .auth-wall h3 { color: var(--fg); margin-bottom: 8px; }

    /* ── Loading ── */
    .loading { padding: 24px; text-align: center; color: var(--muted); font-style: italic; }

    /* ── Story list ── */
    .story-list { flex: 1; overflow-y: auto; }
    .story-item { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-bottom: 1px solid var(--border); cursor: pointer; }
    .story-item:hover { background: var(--list-hover); }
    .story-item.active-story { border-left: 3px solid var(--link); padding-left: 9px; }
    .story-row { display: flex; align-items: center; gap: 6px; }
    .story-title { font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .story-badge { padding: 0 5px; border-radius: 8px; font-size: 10px; line-height: 1.6; white-space: nowrap; }
    .story-badge.status { background: var(--badge-bg); color: var(--badge-fg); }
    .story-badge.priority-high { background: var(--error); color: #fff; }
    .story-badge.priority-urgent { background: #d32f2f; color: #fff; }
    .story-badge.starred::before { content: "★ "; color: var(--warning); }
    .story-meta { font-size: 11px; color: var(--muted); display: flex; gap: 8px; }
    .story-preview { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .story-labels { display: flex; gap: 3px; flex-wrap: wrap; }
    .label-tag { font-size: 10px; padding: 0 4px; border-radius: 3px; }
    .unread-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--link); flex-shrink: 0; }
    .empty-list { padding: 24px 16px; text-align: center; color: var(--muted); }

    /* ── Story detail ── */
    .detail-header { padding: 8px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .detail-header .back-row { display: flex; align-items: center; gap: 6px; }
    .back-btn { background: none; border: none; color: var(--link); cursor: pointer; font-size: 12px; padding: 2px 0; }
    .detail-title { font-weight: 600; font-size: 14px; margin: 4px 0 2px; }
    .detail-meta { font-size: 11px; color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; }
    .detail-actions { display: flex; gap: 4px; margin-top: 4px; }
    .detail-actions button { font-size: 11px; padding: 2px 8px; border-radius: 3px; border: 1px solid var(--border); background: var(--btn-secondary); color: var(--btn-secondary-fg); }
    .detail-actions button:hover { background: var(--list-hover); }
    .detail-actions button.primary { background: var(--btn-bg); color: var(--btn-fg); border-color: transparent; }

    /* ── Entries feed ── */
    .entries-feed { flex: 1; overflow-y: auto; padding: 8px 0; }
    .entry { padding: 6px 12px; }
    .entry + .entry { border-top: 1px solid var(--border); }
    .entry.pinned { background: rgba(204, 167, 0, 0.05); border-left: 2px solid var(--warning); }
    .entry-header { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); margin-bottom: 2px; }
    .entry-type { padding: 0 4px; border-radius: 3px; background: var(--badge-bg); color: var(--badge-fg); font-size: 10px; }
    .entry-content { white-space: pre-wrap; word-wrap: break-word; font-size: 13px; }
    .entry-content code { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15)); padding: 1px 4px; border-radius: 3px; font-size: 12px; }

    /* ── Post input ── */
    .post-area { padding: 8px 12px; border-top: 1px solid var(--border); flex-shrink: 0; display: flex; gap: 6px; align-items: flex-end; }
    .post-area textarea { flex: 1; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 4px; padding: 6px 8px; resize: none; min-height: 36px; max-height: 120px; }
    .post-area textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
    .post-actions { display: flex; flex-direction: column; gap: 4px; }
    .post-actions select { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; padding: 1px 4px; font-size: 11px; }
    .send-btn { background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 4px; padding: 6px 10px; font-size: 12px; white-space: nowrap; }
    .send-btn:hover { background: var(--btn-hover); }
    .send-btn:disabled { opacity: .5; cursor: default; }

    /* ── Create story dialog ── */
    .create-form { padding: 16px 12px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
    .create-form label { font-size: 12px; font-weight: 500; }
    .create-form input, .create-form textarea { width: 100%; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 4px; padding: 6px 8px; }
    .create-form textarea { min-height: 60px; resize: vertical; }
    .create-form .form-actions { display: flex; gap: 6px; margin-top: 4px; }
    .create-form .form-actions button { padding: 6px 14px; border-radius: 4px; border: none; font-size: 12px; }
    .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
    .btn-primary:hover { background: var(--btn-hover); }
    .btn-secondary { background: var(--btn-secondary); color: var(--btn-secondary-fg); }

    /* ── Knowledge panel ── */
    .knowledge-panel { padding: 12px; flex: 1; overflow-y: auto; }
    .knowledge-panel h4 { margin-bottom: 6px; font-size: 12px; }
    .rule-item { padding: 4px 8px; margin-bottom: 4px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,.1)); border-radius: 4px; font-size: 12px; }
    .knowledge-item { margin-bottom: 8px; }
    .knowledge-item .ki-title { font-weight: 500; font-size: 12px; }
    .knowledge-item .ki-content { font-size: 12px; color: var(--muted); margin-top: 2px; }

    /* ── Toast ── */
    .toast { position: fixed; bottom: 12px; left: 12px; right: 12px; padding: 8px 12px; border-radius: 4px; font-size: 12px; z-index: 100; display: none; }
    .toast.error { background: var(--error); color: #fff; }
    .toast.success { background: var(--success); color: #000; }
    .toast.visible { display: block; }
  </style>
</head>
<body>
  <div class="app">
    <!-- Top bar -->
    <div class="topbar">
      <span class="title">AISHA Stories</span>
      <span class="spacer"></span>
      <button class="icon-btn" id="btnCreate" title="New story">+</button>
      <button class="icon-btn" id="btnRefresh" title="Refresh">↻</button>
    </div>

    <!-- Auth wall -->
    <div class="view" id="viewAuth">
      <div class="auth-wall">
        <h3>Sign in to AISHA</h3>
        <p>Use the <strong>AISHA Dirigent: Login</strong> command to authenticate.</p>
      </div>
    </div>

    <!-- Story list view -->
    <div class="view" id="viewList">
      <div class="story-list" id="storyList"></div>
    </div>

    <!-- Story detail view -->
    <div class="view" id="viewDetail">
      <div class="detail-header">
        <div class="back-row">
          <button class="back-btn" id="btnBack">← Stories</button>
          <span class="spacer" style="flex:1"></span>
          <button class="icon-btn" id="btnContext" title="Knowledge & Rules">📋</button>
          <button class="icon-btn" id="btnSetActive" title="Set as active story">📌</button>
        </div>
        <div class="detail-title" id="detailTitle"></div>
        <div class="detail-meta" id="detailMeta"></div>
      </div>
      <div class="entries-feed" id="entriesFeed">
        <div class="loading" id="entriesLoading">Loading entries…</div>
      </div>
      <div class="post-area">
        <textarea id="postInput" rows="1" placeholder="Add to the story…"></textarea>
        <div class="post-actions">
          <select id="entryTypeSelect">
            <option value="note">Note</option>
            <option value="decision">Decision</option>
            <option value="milestone">Milestone</option>
            <option value="question">Question</option>
            <option value="blocker">Blocker</option>
          </select>
          <button class="send-btn" id="btnPost">Post</button>
        </div>
      </div>
    </div>

    <!-- Create story view -->
    <div class="view" id="viewCreate">
      <div class="create-form">
        <div class="back-row">
          <button class="back-btn" id="btnBackCreate">← Stories</button>
        </div>
        <label>Project title</label>
        <input id="createTitle" placeholder="My New Project" />
        <label>Summary (optional)</label>
        <textarea id="createSummary" placeholder="Brief project description…"></textarea>
        <div class="form-actions">
          <button class="btn-primary" id="btnSubmitCreate">Create Story</button>
          <button class="btn-secondary" id="btnCancelCreate">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Knowledge view -->
    <div class="view" id="viewKnowledge">
      <div class="detail-header">
        <div class="back-row">
          <button class="back-btn" id="btnBackKnowledge">← Story</button>
        </div>
        <div class="detail-title">Knowledge & Rules</div>
      </div>
      <div class="knowledge-panel" id="knowledgeContent">
        <div class="loading">Loading…</div>
      </div>
    </div>

    <div class="toast" id="toast"></div>
  </div>

  <script nonce="${nonce}">
    const vsc = acquireVsCodeApi();

    // ── DOM refs ──
    const viewAuth = document.getElementById('viewAuth');
    const viewList = document.getElementById('viewList');
    const viewDetail = document.getElementById('viewDetail');
    const viewCreate = document.getElementById('viewCreate');
    const viewKnowledge = document.getElementById('viewKnowledge');
    const storyListEl = document.getElementById('storyList');
    const entriesFeed = document.getElementById('entriesFeed');
    const entriesLoading = document.getElementById('entriesLoading');
    const detailTitle = document.getElementById('detailTitle');
    const detailMeta = document.getElementById('detailMeta');
    const postInput = document.getElementById('postInput');
    const entryTypeSelect = document.getElementById('entryTypeSelect');
    const createTitle = document.getElementById('createTitle');
    const createSummary = document.getElementById('createSummary');
    const toastEl = document.getElementById('toast');

    let currentView = 'auth';
    let activeStoryId = null;
    let browseStoryId = null;
    let stories = [];
    let entryCount = 0;
    let posting = false;

    function showView(name) {
      currentView = name;
      for (const v of [viewAuth, viewList, viewDetail, viewCreate, viewKnowledge]) {
        v.classList.remove('active');
      }
      const map = { auth: viewAuth, list: viewList, detail: viewDetail, create: viewCreate, knowledge: viewKnowledge };
      if (map[name]) map[name].classList.add('active');
    }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s || '';
      return d.innerHTML;
    }

    function relTime(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const diff = Date.now() - d.getTime();
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
      return d.toLocaleDateString();
    }

    function toast(msg, type) {
      toastEl.textContent = msg;
      toastEl.className = 'toast visible ' + (type || 'error');
      setTimeout(() => { toastEl.classList.remove('visible'); }, 3000);
    }

    // ── Render story list ──
    function renderStories(list, activeId) {
      stories = list;
      activeStoryId = activeId;
      if (!list.length) {
        storyListEl.innerHTML = '<div class="empty-list">No stories yet.<br><br>Click <strong>+</strong> to create your first project story.</div>';
        showView('list');
        return;
      }
      let html = '';
      for (const s of list) {
        const isActive = s.id === activeId;
        const cls = isActive ? ' active-story' : '';
        const star = s.is_starred ? '<span class="story-badge starred"></span>' : '';
        const priorityCls = s.priority === 'high' ? ' priority-high' : s.priority === 'urgent' ? ' priority-urgent' : '';
        const unread = s.unread_count > 0 ? '<span class="unread-dot"></span>' : '';
        const labels = (s.labels || []).map(l =>
          '<span class="label-tag" style="background:' + escapeHtml(l.color || '#666') + ';color:#fff">' + escapeHtml(l.label) + '</span>'
        ).join('');

        html += '<div class="story-item' + cls + '" data-id="' + s.id + '">'
          + '<div class="story-row">'
          + unread
          + star
          + '<span class="story-title">' + escapeHtml(s.title) + '</span>'
          + '<span class="story-badge status">' + escapeHtml(s.status) + '</span>'
          + (priorityCls ? '<span class="story-badge' + priorityCls + '">' + escapeHtml(s.priority) + '</span>' : '')
          + '</div>'
          + '<div class="story-meta">'
          + (s.user_display_name ? '<span>' + escapeHtml(s.user_display_name) + '</span>' : '')
          + '<span>' + relTime(s.last_activity_at) + '</span>'
          + (s.study_name ? '<span>' + escapeHtml(s.study_name) + '</span>' : '')
          + '</div>'
          + (s.last_entry_preview ? '<div class="story-preview">' + escapeHtml(s.last_entry_preview) + '</div>' : '')
          + (labels ? '<div class="story-labels">' + labels + '</div>' : '')
          + '</div>';
      }
      storyListEl.innerHTML = html;
      showView('list');
    }

    // ── Render story detail / entries ──
    function renderDetail(story, entries) {
      if (story) {
        detailTitle.textContent = story.title;
        const parts = [];
        if (story.status) parts.push(story.status);
        if (story.priority && story.priority !== 'normal') parts.push(story.priority);
        if (story.user_display_name) parts.push(story.user_display_name);
        parts.push(relTime(story.last_activity_at));
        detailMeta.textContent = parts.join(' · ');
      }
      renderEntries(entries, true);
      showView('detail');
    }

    function renderEntries(entries, replace) {
      if (replace) {
        entriesFeed.querySelectorAll('.entry').forEach(el => el.remove());
        entryCount = 0;
      }
      entriesLoading.style.display = 'none';
      if (!entries || !entries.length) {
        if (replace) {
          entriesFeed.innerHTML = '<div class="loading">No entries yet. Post the first update.</div>';
        }
        return;
      }
      for (const e of entries) {
        const div = document.createElement('div');
        div.className = 'entry' + (e.is_pinned ? ' pinned' : '');
        div.innerHTML =
          '<div class="entry-header">'
          + '<span class="entry-type">' + escapeHtml(e.entry_type) + '</span>'
          + '<span>' + (e.author_name ? escapeHtml(e.author_name) : (e.created_by ? e.created_by.slice(0, 8) : 'system')) + '</span>'
          + '<span>' + relTime(e.created_at) + '</span>'
          + (e.is_pinned ? '<span title="Pinned">📌</span>' : '')
          + '</div>'
          + '<div class="entry-content">' + escapeHtml(e.content) + '</div>';
        entriesFeed.appendChild(div);
        entryCount++;
      }
      entriesFeed.scrollTop = entriesFeed.scrollHeight;
    }

    // ── Render knowledge ──
    function renderKnowledge(ctx) {
      const panel = document.getElementById('knowledgeContent');
      if (!ctx) {
        panel.innerHTML = '<div class="loading">Could not load context.</div>';
        return;
      }
      let html = '';
      if (ctx.rules && ctx.rules.length) {
        html += '<h4>Rules (' + ctx.rules.length + ')</h4>';
        for (const r of ctx.rules) {
          html += '<div class="rule-item">' + escapeHtml(r) + '</div>';
        }
      }
      if (ctx.knowledge_items && ctx.knowledge_items.length) {
        html += '<h4 style="margin-top:12px">Knowledge (' + ctx.knowledge_items.length + ')</h4>';
        for (const ki of ctx.knowledge_items) {
          html += '<div class="knowledge-item"><div class="ki-title">' + escapeHtml(ki.title) + '</div>'
            + '<div class="ki-content">' + escapeHtml(ki.content) + '</div></div>';
        }
      }
      if (!html) {
        html = '<div class="loading">No knowledge or rules configured for this story.</div>';
      }
      panel.innerHTML = html;
    }

    // ── Events ──
    storyListEl.addEventListener('click', (e) => {
      const item = e.target.closest('.story-item');
      if (item) {
        browseStoryId = item.dataset.id;
        vsc.postMessage({ type: 'openStory', storyId: browseStoryId });
      }
    });

    document.getElementById('btnBack').addEventListener('click', () => showView('list'));
    document.getElementById('btnBackCreate').addEventListener('click', () => showView('list'));
    document.getElementById('btnCancelCreate').addEventListener('click', () => showView('list'));
    document.getElementById('btnBackKnowledge').addEventListener('click', () => showView('detail'));
    document.getElementById('btnRefresh').addEventListener('click', () => vsc.postMessage({ type: 'refresh' }));

    document.getElementById('btnCreate').addEventListener('click', () => {
      createTitle.value = '';
      createSummary.value = '';
      showView('create');
      createTitle.focus();
    });

    document.getElementById('btnContext').addEventListener('click', () => {
      if (browseStoryId) {
        showView('knowledge');
        vsc.postMessage({ type: 'loadContext', storyId: browseStoryId });
      }
    });

    document.getElementById('btnSetActive').addEventListener('click', () => {
      if (browseStoryId) {
        vsc.postMessage({ type: 'setActiveStory', storyId: browseStoryId });
      }
    });

    document.getElementById('btnSubmitCreate').addEventListener('click', () => {
      const title = createTitle.value.trim();
      if (!title) { toast('Title is required', 'error'); return; }
      vsc.postMessage({ type: 'createStory', title, summary: createSummary.value.trim() });
    });

    document.getElementById('btnPost').addEventListener('click', doPost);
    postInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doPost(); }
    });
    postInput.addEventListener('input', () => {
      postInput.style.height = 'auto';
      postInput.style.height = Math.min(postInput.scrollHeight, 120) + 'px';
    });

    function doPost() {
      const text = postInput.value.trim();
      if (!text || posting || !browseStoryId) return;
      posting = true;
      document.getElementById('btnPost').disabled = true;
      vsc.postMessage({ type: 'postEntry', storyId: browseStoryId, text, entryType: entryTypeSelect.value });
    }

    // ── Message from extension ──
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'authState':
          activeStoryId = msg.activeStoryId;
          if (!msg.authenticated) {
            showView('auth');
          } else if (currentView === 'auth') {
            vsc.postMessage({ type: 'loadStories' });
          }
          break;

        case 'loading':
          if (msg.target === 'detail') {
            entriesLoading.style.display = '';
          }
          break;

        case 'stories':
          renderStories(msg.stories || [], msg.activeStoryId || activeStoryId);
          break;

        case 'storyDetail':
          renderDetail(msg.story, msg.entries || []);
          break;

        case 'moreEntries':
          renderEntries(msg.entries || [], false);
          break;

        case 'entryPosted':
          posting = false;
          document.getElementById('btnPost').disabled = false;
          postInput.value = '';
          postInput.style.height = 'auto';
          renderEntries([msg.entry], false);
          toast('Entry posted', 'success');
          break;

        case 'storyCreated':
          toast('Story created: ' + msg.story.title, 'success');
          renderStories(msg.stories || stories, activeStoryId);
          break;

        case 'storyContext':
          renderKnowledge(msg.context);
          break;

        case 'activeStoryChanged':
          activeStoryId = msg.storyId;
          // Re-render list to show new active indicator
          renderStories(stories, activeStoryId);
          break;

        case 'error':
          posting = false;
          document.getElementById('btnPost').disabled = false;
          toast(msg.message || 'An error occurred', 'error');
          break;

        case 'pushEvent':
          if (msg.storyId === browseStoryId && currentView === 'detail') {
            // Reload entries for current story
            vsc.postMessage({ type: 'openStory', storyId: browseStoryId });
          }
          break;
      }
    });

    // Signal ready
    vsc.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

/**
 * Generate a Content-Security-Policy nonce. MUST use crypto-strong RNG
 * (RFC 8264 / CSP3) — Math.random() is forbidden because predictable
 * nonces let attackers bypass CSP by anticipating future values.
 */
function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let nonce = "";
  for (let i = 0; i < bytes.length; i++) {
    nonce += chars.charAt(bytes[i] % chars.length);
  }
  return nonce;
}
