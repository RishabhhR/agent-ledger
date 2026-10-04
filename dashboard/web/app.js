// Agent Ledger dashboard. Read-only.
//
// Everything in the ledger is untrusted text written by agents or people, so
// this file never uses innerHTML: nodes are built with createElement and
// textContent only. Attributes come from fixed names, never from ledger data.

const $ = (id) => document.getElementById(id);
const POLL_MS = 3000;
const DONE_PREVIEW = 8;

const SESSION_KEY = "agent-ledger.session";
const PORT_KEY = "agent-ledger.port";

// ---- tiny DOM helper ----------------------------------------------------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "text") el.textContent = value;
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

// ---- state --------------------------------------------------------------
let mode = "hosted";            // "local": served by the ledger server itself; "hosted": a separate page
let conn = null;                // { base, code, port }
let etag = null;
let lastData = null;
let lastOkAt = 0;
let pollTimer = null;
let showAllDone = false;
let polling = false;

const sessionGet = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null"); } catch { return null; } };
const sessionSet = (v) => { try { v ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)) : sessionStorage.removeItem(SESSION_KEY); } catch { /* storage may be blocked */ } };
const portGet = () => { try { return localStorage.getItem(PORT_KEY); } catch { return null; } };
const portSet = (v) => { try { localStorage.setItem(PORT_KEY, String(v)); } catch { /* ignore */ } };

class ConnError extends Error {
  constructor(kind, detail) { super(kind); this.kind = kind; this.detail = detail; }
}

// ---- talking to the server ------------------------------------------------
async function api(path, { code, ifNoneMatch } = {}) {
  const headers = {};
  if (code) headers.Authorization = `Bearer ${code}`;
  if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
  let res;
  try {
    res = await fetch(conn.base + path, { headers, cache: "no-store", credentials: "omit", redirect: "error" });
  } catch {
    // A refused connection, a CORS refusal and a browser block all look alike here.
    throw new ConnError("network");
  }
  return res;
}

async function connect(base, port, code) {
  conn = { base, port, code };
  const health = await api("/health");
  let info = null;
  try { info = await health.json(); } catch { /* not JSON */ }
  if (!health.ok || !info || info.app !== "agent-ledger-dashboard") throw new ConnError("not-ours");
  const res = await api("/state", { code });
  if (res.status === 401) throw new ConnError("bad-code");
  if (res.status === 429) throw new ConnError("locked");
  if (!res.ok) throw new ConnError("http", res.status);
  etag = res.headers.get("ETag");
  return res.json();
}

// ---- screens ---------------------------------------------------------------
function setStatus(state, text) {
  $("status").dataset.state = state;
  $("status-text").textContent = text;
}

function showConnect(message) {
  stopPolling();
  conn = null;
  etag = null;
  $("dash").hidden = true;
  $("connect").hidden = false;
  $("disconnect").hidden = true;
  $("repo-name").hidden = true;
  setStatus("idle", "Not connected");
  if (message) showError(message);
}

function showDashboard(data) {
  $("connect").hidden = true;
  $("dash").hidden = false;
  $("disconnect").hidden = false;
  $("repo-name").hidden = false;
  render(data);
}

function showError(kind, detail) {
  const box = $("connect-error");
  const port = conn?.port ?? $("port").value;
  const items = {
    network: () => [
      h("strong", { text: `Couldn't reach a ledger server${mode === "hosted" ? ` at 127.0.0.1:${port}` : ""}.` }),
      h("ul", {},
        h("li", { text: "Is the server running? Its terminal shows a pairing code." }),
        mode === "hosted" ? h("li", { text: "Does the port match the one it printed?" }) : null,
        mode === "hosted" ? h("li", { text: `Was it started with --allow-origin ${location.origin} ? Without that, your browser blocks this page from reading it.` }) : null,
        mode === "hosted" ? h("li", {},
          "Some browsers stop pages on the internet from reaching your own computer. Chrome and Edge may ask your permission; others may refuse. If that is happening, open the copy the server serves itself: ",
          h("a", { href: `http://127.0.0.1:${Number(port) || 4780}/`, text: `http://127.0.0.1:${Number(port) || 4780}/` })) : null),
    ],
    "not-ours": () => [h("strong", { text: "Something answered on that port, but it isn't the ledger server. Check the port number." })],
    "bad-code": () => [h("strong", { text: "That pairing code wasn't accepted." }), " Use the code printed in the terminal where the server is running. It changes every time the server starts."],
    locked: () => [h("strong", { text: "Too many wrong codes." }), " Wait a minute, then try again."],
    restarted: () => [h("strong", { text: "The server asked for the pairing code again." }), " It was probably restarted, which gives it a new code. Paste the new one."],
    port: () => [h("strong", { text: "Enter a port number between 1 and 65535." })],
    code: () => [h("strong", { text: "Paste the pairing code printed by the server." })],
    http: () => [h("strong", { text: `The server answered with an unexpected error (${detail}).` })],
  };
  box.replaceChildren(...(items[kind] ?? items.http)());
  box.hidden = false;
}

// ---- rendering --------------------------------------------------------------
function badge(entry) {
  if (entry.review === "pass") return h("span", { class: "badge", "data-kind": "pass", text: "reviewed ✓" });
  if (entry.review === "defect") return h("span", { class: "badge", "data-kind": "defect", text: "defect found" });
  return h("span", { class: "badge", "data-kind": "none", text: "not reviewed" });
}

function card(entry, { review = false } = {}) {
  const hasMore = entry.body && entry.body.trim() !== entry.title.trim();
  const meta = [`${entry.from} → ${entry.to}`, entry.opened && `opened ${entry.opened}`, entry.closed && `closed ${entry.closed}`].filter(Boolean).join(" · ");
  return h("article", { class: "card" },
    h("div", { class: "row" },
      h("span", { class: "id", text: entry.id }),
      h("span", { class: "title", text: entry.title || "(no description)" }),
      review && entry.kind === "task" ? badge(entry) : null),
    h("div", { class: "meta", text: meta }),
    hasMore ? h("details", { "data-id": entry.id }, h("summary", { text: "Details" }), h("pre", { text: entry.body })) : null);
}

function empty(text) { return h("p", { class: "empty", text }); }

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

function render(data) {
  const openDetails = new Set([...document.querySelectorAll("#dash details[data-id][open]")].map((d) => d.dataset.id));

  $("repo-name").textContent = data.repo;

  $("next").replaceChildren(...data.attention.map((a) =>
    h("li", { "data-level": a.level },
      h("span", { class: "mark", "aria-hidden": "true", text: a.level === "action" ? "!" : "→" }),
      h("div", {}, h("div", { text: a.text }), a.ids.length ? h("div", { class: "ids", text: a.ids.join(", ") }) : null))));

  $("decisions-count").textContent = data.decisions.length ? `(${data.decisions.length})` : "";
  $("decisions").replaceChildren(...(data.decisions.length ? data.decisions.map((d) => card(d)) : [empty("No decisions are waiting.")]));

  $("open-count").textContent = data.tasks.length ? `(${data.tasks.length})` : "";
  const byAgent = new Map();
  for (const t of data.tasks) byAgent.set(t.to, [...(byAgent.get(t.to) ?? []), t]);
  $("open").replaceChildren(...(byAgent.size
    ? [...byAgent].map(([agent, tasks]) => h("div", { class: "col" }, h("h3", { text: `${agent} (${tasks.length})` }), h("div", { class: "cards" }, tasks.map((t) => card(t)))))
    : [empty("No open tasks.")]));

  $("done-count").textContent = data.done.length ? `(${data.done.length})` : "";
  const doneShown = showAllDone ? data.done : data.done.slice(0, DONE_PREVIEW);
  $("done").replaceChildren(...(doneShown.length ? doneShown.map((d) => card(d, { review: true })) : [empty("Nothing finished yet.")]));
  $("done-more").hidden = data.done.length <= DONE_PREVIEW;
  $("done-more").textContent = showAllDone ? "Show fewer" : `Show all ${data.done.length}`;

  $("checkpoints").replaceChildren(...(data.checkpoints.length
    ? data.checkpoints.map((c) => h("li", {},
      h("strong", { text: c.agent }),
      h("code", { text: c.sha }),
      h("span", { class: "hint", text: c.stale === null ? "current commit unknown" : c.stale ? "behind the repo's latest commit" : "up to date" })))
    : [h("li", { class: "hint", text: "No agent has recorded a checkpoint yet." })]));

  $("warnings-box").hidden = data.warnings.length === 0;
  $("warnings-count").textContent = data.warnings.length ? `(${data.warnings.length})` : "";
  $("warnings").replaceChildren(...data.warnings.map((w) => h("li", { text: w })));

  for (const d of document.querySelectorAll("#dash details[data-id]")) if (openDetails.has(d.dataset.id)) d.open = true;
}

// ---- polling ------------------------------------------------------------------
function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
  polling = false;
}

function schedule() {
  clearTimeout(pollTimer);
  if (polling) pollTimer = setTimeout(poll, POLL_MS);
}

async function poll() {
  if (!conn) return;
  if (document.hidden) return schedule();
  try {
    const res = await api("/state", { code: conn.code, ifNoneMatch: etag });
    if (res.status === 304) {
      lastOkAt = Date.now();
    } else if (res.status === 401) {
      sessionSet(null);
      return showConnect("restarted");
    } else if (res.ok) {
      etag = res.headers.get("ETag");
      lastData = await res.json();
      lastOkAt = Date.now();
      render(lastData);
    } else {
      throw new ConnError("http", res.status);
    }
    $("stale").hidden = true;
    $("status").dataset.state = "live"; // recovered from a drop, if there was one
    tick();
  } catch {
    setStatus("offline", "Connection lost, retrying");
    if (lastData) {
      $("stale").hidden = false;
      $("stale").textContent = `Lost the connection to the server. Showing what it last sent (${ago(lastOkAt)}). Retrying…`;
    }
  }
  schedule();
}

function tick() {
  if (!conn || $("status").dataset.state === "offline") return;
  // Polling pauses while the tab is hidden; don't call old data "live".
  if (Date.now() - lastOkAt > POLL_MS * 3) setStatus("connecting", `Checking… last update ${ago(lastOkAt)}`);
  else setStatus("live", `Live · updated ${ago(lastOkAt)}`);
}

// ---- wiring ----------------------------------------------------------------------
async function start(base, port, code, { fromSaved = false } = {}) {
  const btn = $("connect-btn");
  btn.disabled = true;
  $("connect-error").hidden = true;
  setStatus("connecting", "Connecting…");
  try {
    lastData = await connect(base, port, code);
    lastOkAt = Date.now();
    sessionSet({ base, port, code });
    if (mode === "hosted") portSet(port);
    showDashboard(lastData);
    polling = true;
    tick();
    schedule();
  } catch (err) {
    setStatus("idle", "Not connected");
    const kind = err instanceof ConnError ? err.kind : "network";
    if (kind === "bad-code") sessionSet(null); // never keep a code the server rejected
    // A saved code that stops working almost always means the server restarted.
    showConnect(kind === "bad-code" && fromSaved ? "restarted" : kind);
    if (kind === "http") showError("http", err.detail);
  } finally {
    btn.disabled = false;
  }
}

function onSubmit(event) {
  event.preventDefault();
  const code = $("code").value.trim();
  const port = Number($("port").value);
  if (mode === "hosted" && !(Number.isInteger(port) && port >= 1 && port <= 65535)) return showError("port");
  if (!code) return showError("code");
  start(mode === "local" ? "" : `http://127.0.0.1:${port}`, mode === "local" ? Number(location.port) : port, code);
}

async function detectMode() {
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) return "hosted";
  try {
    const res = await fetch("/health", { cache: "no-store" });
    const info = await res.json();
    return info.app === "agent-ledger-dashboard" ? "local" : "hosted";
  } catch {
    return "hosted";
  }
}

async function init() {
  mode = await detectMode();
  const hosted = mode === "hosted";
  $("port-field").hidden = !hosted;
  $("port").value = portGet() ?? "4780";
  if (hosted) {
    $("cmd-text").textContent = `node dashboard/server/ledger-server.mjs --repo . --allow-origin ${location.origin}`;
    $("cmd-hint").textContent = "Run it from the kit's folder, or adjust the path. The --allow-origin part tells your server to accept this page.";
    $("footer-mode").textContent = "This page is hosted, has no backend, and its security policy only lets it connect to your own machine.";
  } else {
    $("cmd-text").textContent = "node dashboard/server/ledger-server.mjs --repo .";
    $("cmd-hint").textContent = "This page was served by that server, so it is already running. Paste the code from its terminal.";
    $("footer-mode").textContent = "This page is served by the server on your own machine.";
  }

  $("connect-form").addEventListener("submit", onSubmit);
  $("disconnect").addEventListener("click", () => { sessionSet(null); lastData = null; showConnect(); });
  $("done-more").addEventListener("click", () => { showAllDone = !showAllDone; if (lastData) render(lastData); });
  $("copy-cmd").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("cmd-text").textContent); $("copy-cmd").textContent = "Copied"; setTimeout(() => ($("copy-cmd").textContent = "Copy"), 1500); } catch { /* clipboard unavailable */ }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && conn) poll(); });
  setInterval(tick, 1000);

  const saved = sessionGet();
  if (saved && ((saved.base === "") === !hosted)) start(saved.base, saved.port, saved.code, { fromSaved: true });
}

init();
