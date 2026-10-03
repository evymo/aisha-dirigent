/**
 * Matrix Team Chat WebView — human-to-human chat panel backed by Matrix/Synapse.
 *
 * Appears as the lower tab in the secondary sidebar (aisha.dirigent.storyChat).
 * Provides an independent story selector so the chat project can differ from
 * the one active in the Story Panel above.
 *
 * Flow:
 *  1. resolveWebviewView → render shell HTML
 *  2. webview posts "ready" → initChat()
 *     a. Load stories list for dropdown
 *     b. If Matrix configured: exchange token via svc-matrix
 *     c. If story selected: discover/create Matrix room → load history → start sync
 *
 * @module
 */

import * as vscode from "vscode";
import { getDirigentConfig } from "./config";
import { getAuthState, fetchUserStories, type StoryItem } from "./auth";
import { authenticatedFetch, isApiReady, getBaseUrl } from "./authenticated-fetch";
import type { AishaPushEvent } from "./aisha-push";
import {
  type MatrixCredentials,
  type MatrixMessage,
  exchangeMatrixToken,
  createMatrixRoom,
  joinMatrixRoom,
  getRoomHistory,
  sendMatrixMessage,
  startSyncLoop,
  stopSyncLoop,
} from "./matrix-client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MatrixRoomRow {
  id: string;
  story_id: string;
  matrix_room_id: string;
  room_type: string;
  display_name: string | null;
  is_active: boolean;
}

export class StoryChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aisha.dirigent.storyChat";

  private webviewView: vscode.WebviewView | undefined;

  /** Story selected in THIS panel (independent from Story Panel above) */
  private chatStoryId: string | null = null;
  /** Active Matrix room for the selected story */
  private matrixRoomId: string | null = null;
  /** Matrix credentials (in-memory, not persisted) */
  private matrixCreds: MatrixCredentials | null = null;
  /** Whether Matrix init has already been attempted this session */
  private matrixInitDone = false;

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

    webviewView.webview.onDidReceiveMessage(
      async (msg: {
        type: string;
        text?: string;
        storyId?: string;
      }) => {
        switch (msg.type) {
          case "ready":
            await this.initChat();
            break;
          case "switchStory":
            if (msg.storyId !== undefined) {
              await this.switchStory(msg.storyId || null);
            }
            break;
          case "send":
            if (msg.text?.trim()) {
              await this.sendMessage(msg.text.trim());
            }
            break;
          case "refresh":
            await this.loadHistory();
            break;
          case "createRoom":
            await this.createRoomForStory();
            break;
        }
      },
    );

    // Stop sync when panel is hidden, restart when visible
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        stopSyncLoop();
      } else if (this.matrixRoomId && this.matrixCreds) {
        void this.startLiveSync();
      }
    });
  }

  // ── Public API (called from extension.ts) ─────────────────────────────────

  /** Forward push events into the webview */
  handlePushEvent(event: AishaPushEvent): void {
    if (!this.webviewView) return;
    if (event.type === "story_share" || event.type === "alert" || event.type === "recommendation" || event.type === "info") {
      void this.webviewView.webview.postMessage({
        type: "pushEvent",
        title: event.title,
        body: event.body,
        eventType: event.type,
      });
    }
  }

  /**
   * Called when active story changes in the Story Panel.
   * Only pre-selects the story if the chat hasn't been explicitly set by the user.
   */
  handleStoryChanged(storyId: string | null): void {
    if (!this.webviewView) return;
    // Don't override a user-selected story in the chat panel
    if (this.chatStoryId !== null) return;
    void this.switchStory(storyId);
  }

  async refreshStoryList(): Promise<void> {
    const auth = getAuthState();
    const config = getDirigentConfig();
    if (!auth.isAuthenticated || !auth.accessToken || !config.aishaUrl) return;
    try {
      const stories = await fetchUserStories(
        config.aishaUrl,
        auth.accessToken,
        config.anonKey ?? "",
      );
      void this.webviewView?.webview.postMessage({ type: "stories", stories });
    } catch {
      /* best effort */
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  private async initChat(): Promise<void> {
    const auth = getAuthState();
    const config = getDirigentConfig();

    // Load story list for dropdown
    let stories: StoryItem[] = [];
    if (auth.isAuthenticated && auth.accessToken && config.aishaUrl) {
      try {
        stories = await fetchUserStories(
          config.aishaUrl,
          auth.accessToken,
          config.anonKey ?? "",
        );
      } catch {
        /* best effort */
      }
    }

    void this.webviewView?.webview.postMessage({
      type: "init",
      storyId: this.chatStoryId,
      stories,
      authenticated: auth.isAuthenticated,
      email: auth.email,
      matrixConfigured: !!(config.matrixUrl && config.matrixServiceUrl),
    });

    // Attempt Matrix token exchange (once per session)
    if (!this.matrixInitDone && auth.isAuthenticated && auth.accessToken) {
      this.matrixInitDone = true;
      await this.initMatrix(auth.accessToken);
    }

    if (this.chatStoryId) {
      await this.loadRoomAndHistory();
    }
  }

  private async initMatrix(accessToken: string): Promise<void> {
    const config = getDirigentConfig();
    if (!config.matrixUrl || !config.matrixServiceUrl) {
      this.postStatus("not_configured");
      return;
    }
    this.postStatus("connecting");
    const creds = await exchangeMatrixToken(config.matrixServiceUrl, accessToken);
    if (!creds) {
      this.postStatus("matrix_unavailable");
      return;
    }
    this.matrixCreds = creds;
    this.postStatus("connected");
  }

  // ── Story switching ──────────────────────────────────────────────────────

  private async switchStory(storyId: string | null): Promise<void> {
    stopSyncLoop();
    this.chatStoryId = storyId;
    this.matrixRoomId = null;
    void this.webviewView?.webview.postMessage({ type: "selectStory", storyId });
    if (!storyId) {
      void this.webviewView?.webview.postMessage({ type: "messages", messages: [] });
      return;
    }
    await this.loadRoomAndHistory();
  }

  // ── Room discovery ───────────────────────────────────────────────────────

  private async loadRoomAndHistory(): Promise<void> {
    if (!this.chatStoryId) return;

    if (!this.matrixCreds) {
      const auth = getAuthState();
      if (auth.isAuthenticated && auth.accessToken && !this.matrixInitDone) {
        this.matrixInitDone = true;
        await this.initMatrix(auth.accessToken);
      }
      if (!this.matrixCreds) {
        this.postStatus("not_connected");
        return;
      }
    }

    if (!isApiReady()) {
      this.postStatus("not_authenticated");
      return;
    }

    void this.webviewView?.webview.postMessage({ type: "loading", active: true });
    const roomId = await this.resolveRoom(this.chatStoryId);
    void this.webviewView?.webview.postMessage({ type: "loading", active: false });

    if (!roomId) {
      void this.webviewView?.webview.postMessage({ type: "noRoom" });
      return;
    }

    this.matrixRoomId = roomId;
    const config = getDirigentConfig();
    await joinMatrixRoom(config.matrixUrl, this.matrixCreds, roomId);
    await this.loadHistory();
    await this.startLiveSync();
  }

  private async resolveRoom(storyId: string): Promise<string | null> {
    const result = await authenticatedFetch<MatrixRoomRow[]>(
      `${getBaseUrl()}/rest/v1/rpc/get_story_matrix_rooms`,
      { body: { p_story_id: storyId } },
    );
    if (!result.ok) return null;
    const general = result.data.find((r) => r.room_type === "general" && r.is_active);
    return general?.matrix_room_id ?? null;
  }

  private async createRoomForStory(): Promise<void> {
    if (!this.chatStoryId || !this.matrixCreds) return;
    const config = getDirigentConfig();
    void this.webviewView?.webview.postMessage({ type: "loading", active: true });

    const roomId = await createMatrixRoom(
      config.matrixUrl,
      this.matrixCreds,
      `Story Chat — ${this.chatStoryId.slice(0, 8)}`,
    );

    void this.webviewView?.webview.postMessage({ type: "loading", active: false });

    if (!roomId) {
      this.postStatus("create_failed");
      return;
    }

    const regResult = await authenticatedFetch<unknown>(
      `${getBaseUrl()}/rest/v1/rpc/create_story_matrix_room`,
      {
        body: {
          p_story_id: this.chatStoryId,
          p_matrix_room_id: roomId,
          p_room_type: "general",
        },
      },
    );

    if (!regResult.ok) {
      this.postStatus("create_failed");
      return;
    }

    this.matrixRoomId = roomId;
    await joinMatrixRoom(config.matrixUrl, this.matrixCreds, roomId);
    await this.loadHistory();
    await this.startLiveSync();
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  private async loadHistory(): Promise<void> {
    if (!this.matrixRoomId || !this.matrixCreds) return;
    const config = getDirigentConfig();
    const messages = await getRoomHistory(config.matrixUrl, this.matrixCreds, this.matrixRoomId);
    void this.webviewView?.webview.postMessage({ type: "messages", messages });
  }

  private async sendMessage(text: string): Promise<void> {
    if (!this.matrixRoomId || !this.matrixCreds) return;
    const config = getDirigentConfig();

    const optimistic: MatrixMessage = {
      event_id: `~local-${Date.now()}`,
      sender: this.matrixCreds.user_id,
      origin_server_ts: Date.now(),
      content: { msgtype: "m.text", body: text },
    };
    void this.webviewView?.webview.postMessage({ type: "appendMessage", message: optimistic });

    await sendMatrixMessage(config.matrixUrl, this.matrixCreds, this.matrixRoomId, text);
  }

  private async startLiveSync(): Promise<void> {
    if (!this.matrixRoomId || !this.matrixCreds) return;
    const config = getDirigentConfig();
    startSyncLoop({
      homeserverUrl: config.matrixUrl,
      credentials: this.matrixCreds,
      roomId: this.matrixRoomId,
      onMessages: (msgs) => {
        const incoming = msgs.filter((m) => m.sender !== this.matrixCreds?.user_id);
        if (incoming.length > 0) {
          void this.webviewView?.webview.postMessage({ type: "appendMessages", messages: incoming });
        }
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private postStatus(status: string): void {
    void this.webviewView?.webview.postMessage({ type: "status", status });
  }

  // ── Webview HTML ─────────────────────────────────────────────────────────

  private renderHtml(_webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Team Chat</title>
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border, rgba(128,128,128,.22));
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border, transparent);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --btn2-bg: var(--vscode-button-secondaryBackground, rgba(128,128,128,.15));
      --btn2-fg: var(--vscode-button-secondaryForeground, var(--fg));
      --muted: var(--vscode-descriptionForeground);
      --error: var(--vscode-editorError-foreground, #f44);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; font: 13px/1.5 var(--vscode-font-family, system-ui); color: var(--fg); background: var(--bg); }
    .container { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    .header { padding: 6px 10px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 6px; flex-shrink: 0; min-width: 0; }
    .header-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
    .header select { flex: 1; min-width: 0; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; padding: 2px 6px; font-size: 12px; }
    .conn-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--muted); }
    .conn-dot.ok { background: #4caf50; }
    .conn-dot.err { background: var(--error); }
    .conn-dot.busy { background: #ff9800; }

    .messages { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
    .msg { display: flex; flex-direction: column; max-width: 95%; }
    .msg.self { align-self: flex-end; align-items: flex-end; }
    .msg.other { align-self: flex-start; align-items: flex-start; }
    .msg .sender { font-size: 11px; color: var(--muted); margin-bottom: 2px; }
    .msg .bubble { padding: 5px 9px; border-radius: 6px; word-wrap: break-word; white-space: pre-wrap; line-height: 1.45; }
    .msg.self .bubble { background: var(--btn-bg); color: var(--btn-fg); }
    .msg.other .bubble { background: var(--vscode-textBlockQuote-background, rgba(128,128,128,.12)); }
    .msg .time { font-size: 10px; color: var(--muted); margin-top: 2px; }

    .overlay { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px 14px; text-align: center; color: var(--muted); gap: 10px; }
    .overlay .title { font-size: 13px; color: var(--fg); }
    .overlay .hint { font-size: 12px; }
    .overlay .action-btn { margin-top: 6px; padding: 5px 14px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .overlay .action-btn:hover { background: var(--btn-hover); }

    .loading-bar { height: 2px; background: var(--btn-bg); animation: loadbar 1.2s ease-in-out infinite; display: none; flex-shrink: 0; }
    .loading-bar.active { display: block; }
    @keyframes loadbar { 0%,100%{opacity:.3} 50%{opacity:1} }

    .input-area { padding: 7px 10px; border-top: 1px solid var(--border); display: flex; gap: 6px; align-items: flex-end; flex-shrink: 0; }
    .input-area textarea { flex: 1; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 4px; padding: 5px 8px; font: inherit; resize: none; min-height: 32px; max-height: 110px; line-height: 1.4; }
    .input-area textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
    .input-area textarea:disabled { opacity: .5; }
    .send-btn { background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 4px; padding: 5px 11px; cursor: pointer; font-size: 12px; white-space: nowrap; flex-shrink: 0; }
    .send-btn:hover { background: var(--btn-hover); }
    .send-btn:disabled { opacity: .45; cursor: default; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="header-label">Chat</span>
      <select id="storySelect"><option value="">— project —</option></select>
      <span class="conn-dot" id="connDot" title="Matrix connection"></span>
    </div>
    <div class="loading-bar" id="loadingBar"></div>
    <div class="messages" id="msgArea">
      <div class="overlay" id="overlay">
        <div class="title" id="overlayTitle">Team Chat</div>
        <div class="hint" id="overlayHint">Select a project to load the chat.</div>
        <button class="action-btn" id="overlayBtn" style="display:none"></button>
      </div>
    </div>
    <div class="input-area">
      <textarea id="msgInput" rows="1" placeholder="Type a message…" disabled></textarea>
      <button class="send-btn" id="sendBtn" disabled>Send</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const storySelect  = document.getElementById('storySelect');
    const connDot      = document.getElementById('connDot');
    const loadingBar   = document.getElementById('loadingBar');
    const msgArea      = document.getElementById('msgArea');
    const overlay      = document.getElementById('overlay');
    const overlayTitle = document.getElementById('overlayTitle');
    const overlayHint  = document.getElementById('overlayHint');
    const overlayBtn   = document.getElementById('overlayBtn');
    const msgInput     = document.getElementById('msgInput');
    const sendBtn      = document.getElementById('sendBtn');
    let myUserId = null;
    let currentStoryId = null;

    function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function fmtSender(s) { return s.replace(/^@([^:]+):.*$/, '$1'); }
    function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    function scrollBottom() { msgArea.scrollTop = msgArea.scrollHeight; }
    function setLoading(on) { loadingBar.classList.toggle('active', on); }
    function setDot(state) {
      connDot.className = 'conn-dot' + (state === 'ok' ? ' ok' : state === 'err' ? ' err' : state === 'busy' ? ' busy' : '');
    }
    function setSendEnabled(on) { sendBtn.disabled = !on; msgInput.disabled = !on; }
    function hideOverlay() { overlay.style.display = 'none'; }
    function showOverlay(title, hint, btnLabel, btnAction) {
      overlayTitle.textContent = title;
      overlayHint.textContent = hint;
      if (btnLabel) { overlayBtn.textContent = btnLabel; overlayBtn.style.display = ''; overlayBtn.onclick = btnAction; }
      else { overlayBtn.style.display = 'none'; }
      overlay.style.display = '';
    }

    function renderMsg(msg) {
      const isSelf = myUserId && msg.sender === myUserId;
      const div = document.createElement('div');
      div.className = 'msg ' + (isSelf ? 'self' : 'other');
      if (!isSelf) {
        const s = document.createElement('div'); s.className = 'sender';
        s.textContent = fmtSender(msg.sender); div.appendChild(s);
      }
      const b = document.createElement('div'); b.className = 'bubble';
      b.innerHTML = escHtml(msg.content.body); div.appendChild(b);
      const t = document.createElement('div'); t.className = 'time';
      t.textContent = fmtTime(msg.origin_server_ts); div.appendChild(t);
      return div;
    }
    function clearMessages() { msgArea.querySelectorAll('.msg').forEach(el => el.remove()); }

    storySelect.addEventListener('change', () => {
      const id = storySelect.value || null;
      currentStoryId = id;
      setSendEnabled(false);
      clearMessages();
      showOverlay('Loading\u2026', '', null, null);
      vscode.postMessage({ type: 'switchStory', storyId: id || '' });
    });

    function doSend() {
      const text = msgInput.value.trim();
      if (!text || sendBtn.disabled) return;
      vscode.postMessage({ type: 'send', text });
      msgInput.value = '';
      autoResize();
    }
    sendBtn.addEventListener('click', doSend);
    msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
    function autoResize() { msgInput.style.height = 'auto'; msgInput.style.height = Math.min(msgInput.scrollHeight, 110) + 'px'; }
    msgInput.addEventListener('input', autoResize);

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'init': {
          myUserId = null; currentStoryId = msg.storyId || null;
          storySelect.innerHTML = '<option value="">— project —</option>';
          for (const s of (msg.stories || [])) {
            const opt = document.createElement('option');
            opt.value = s.id; opt.textContent = s.title + (s.is_shared ? ' (shared)' : '');
            if (s.id === currentStoryId) opt.selected = true;
            storySelect.appendChild(opt);
          }
          if (!msg.authenticated) { setDot('err'); showOverlay('Not logged in', 'Use AISHA Dirigent: Login to connect.', null, null); }
          else if (!msg.matrixConfigured) { setDot('err'); showOverlay('Matrix not configured', 'Set matrix_homeserver_url in .well-known/app-config.json.', null, null); }
          else { setDot('busy'); if (!currentStoryId) showOverlay('Team Chat', 'Select a project to load the chat.', null, null); }
          break;
        }
        case 'status': {
          const m = { connecting:{dot:'busy'}, connected:{dot:'ok'}, not_configured:{dot:'err',o:['Matrix not configured','Configure matrix_homeserver_url in .well-known/app-config.json.']}, matrix_unavailable:{dot:'err',o:['Matrix unavailable','Could not reach the Matrix server. Check svc-matrix.']}, not_connected:{dot:'',o:['Not connected','Matrix auth failed. Try reloading.']}, not_authenticated:{dot:'err',o:['Not logged in','Use AISHA Dirigent: Login.']}, create_failed:{dot:'err',o:['Room creation failed','Could not create Matrix room.']} }[msg.status];
          if (!m) break;
          setDot(m.dot);
          if (m.o) showOverlay(m.o[0], m.o[1], null, null);
          break;
        }
        case 'loading': setLoading(msg.active); break;
        case 'noRoom': { showOverlay('No chat room', 'This project has no Matrix room yet.', 'Create room', () => vscode.postMessage({ type: 'createRoom' })); setSendEnabled(false); break; }
        case 'stories': {
          const prev = storySelect.value;
          storySelect.innerHTML = '<option value="">— project —</option>';
          for (const s of msg.stories) {
            const opt = document.createElement('option');
            opt.value = s.id; opt.textContent = s.title + (s.is_shared ? ' (shared)' : '');
            if (s.id === prev) opt.selected = true;
            storySelect.appendChild(opt);
          }
          break;
        }
        case 'messages': {
          clearMessages();
          if (msg.messages && msg.messages.length > 0) {
            hideOverlay();
            for (const m of msg.messages) msgArea.appendChild(renderMsg(m));
            setSendEnabled(true); scrollBottom();
          } else {
            showOverlay('No messages yet', 'Be the first to write something!', null, null);
            setSendEnabled(true);
          }
          break;
        }
        case 'appendMessage': {
          const wasAtBottom = msgArea.scrollHeight - msgArea.scrollTop - msgArea.clientHeight < 60;
          hideOverlay(); msgArea.appendChild(renderMsg(msg.message));
          setSendEnabled(true); if (wasAtBottom) scrollBottom();
          break;
        }
        case 'appendMessages': {
          const wasAtBottom = msgArea.scrollHeight - msgArea.scrollTop - msgArea.clientHeight < 60;
          hideOverlay();
          for (const m of (msg.messages || [])) msgArea.appendChild(renderMsg(m));
          setSendEnabled(true); if (wasAtBottom) scrollBottom();
          break;
        }
        case 'selectStory': {
          currentStoryId = msg.storyId || null;
          storySelect.value = msg.storyId || '';
          break;
        }
        case 'pushEvent': {
          const div = document.createElement('div'); div.className = 'msg other';
          const b = document.createElement('div'); b.className = 'bubble'; b.style.fontStyle = 'italic'; b.style.opacity = '0.75';
          b.innerHTML = '<strong>' + escHtml(msg.title) + '</strong>' + (msg.body ? '<br>' + escHtml(msg.body) : '');
          div.appendChild(b); msgArea.appendChild(div); scrollBottom();
          break;
        }
      }
    });

    vscode.postMessage({ type: 'ready' });
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
