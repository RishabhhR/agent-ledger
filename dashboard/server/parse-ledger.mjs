// Parses .ledger/LEDGER.md into plain data for the dashboard.
//
// The ledger is hand-and-agent-edited markdown, not a schema, so this never
// throws: anything it can't understand is skipped and reported in `warnings`.
// All text in the result is untrusted. Renderers must treat it as text.

const MAX_CHARS = 1_000_000;
const MAX_ENTRIES = 500;
const MAX_BODY = 20_000;
const MAX_TITLE = 200;

const ENTRY_HEADER = /^###\s+\[((?:TASK|DEC)-\d+)\]\s*(.*)$/i;
const SECTION_HEADER = /^##\s+(.*?)\s*$/;
const CHECKPOINT_LINE = /^\s*([A-Za-z0-9_-]{1,40}):\s*([0-9a-f]{4,40})\s*$/i;
const META_KEYS = new Set(["status", "from", "to", "opened", "claimed", "closed"]);

function sectionOf(heading) {
  const h = heading.toLowerCase();
  if (h.startsWith("decision")) return "decisions";
  if (h.startsWith("task")) return "tasks";
  if (h.startsWith("done") || h.startsWith("resolved")) return "done";
  if (h.startsWith("checkpoint")) return "checkpoints";
  return "other";
}

function parseMeta(rest) {
  const meta = {};
  for (const token of rest.split(/\s+/)) {
    const i = token.indexOf(":");
    if (i <= 0) continue;
    const key = token.slice(0, i).toLowerCase();
    const value = token.slice(i + 1);
    if (META_KEYS.has(key) && value) meta[key] = value.slice(0, 120);
  }
  return meta;
}

function normaliseStatus(raw) {
  const s = (raw ?? "open").toLowerCase();
  return s === "done" || s === "resolved" || s === "closed" ? "done" : "open";
}

// A reviewer records "PASS: ..." on the entry; a failed review says "FAIL" or
// "DEFECT". The first such line wins.
function reviewOf(body) {
  for (const line of body.split("\n")) {
    const t = line.trim().replace(/^[*_>\s-]+/, "");
    if (/^pass\b/i.test(t)) return "pass";
    if (/^(fail|defect)\b/i.test(t)) return "defect";
  }
  return null;
}

function numeric(id) {
  return Number(id.split("-")[1]) || 0;
}

function sameCommit(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

export function parseLedger(input, { head = null } = {}) {
  const text = (typeof input === "string" ? input : "").slice(0, MAX_CHARS).replace(/\r\n?/g, "\n");
  // The template documents the entry format inside a comment; those example
  // headers must not become real entries. An unterminated "<!--" is left alone
  // so a typo can't hide the rest of the file.
  const lines = text.replace(/<!--[\s\S]*?-->/g, "").split("\n");

  const warnings = [];
  const entries = [];
  const seen = new Set();
  const checkpoints = [];
  let section = "other";
  let current = null;

  const finish = () => {
    if (!current) return;
    const body = current.lines.join("\n").trim().slice(0, MAX_BODY);
    const title = (body.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, MAX_TITLE);
    entries.push({
      id: current.id,
      kind: current.id.startsWith("DEC") ? "decision" : "task",
      status: normaliseStatus(current.meta.status),
      from: current.meta.from ?? "unknown",
      to: current.meta.to ?? "unknown",
      opened: current.meta.opened ?? null,
      claimed: current.meta.claimed ?? null,
      closed: current.meta.closed ?? null,
      section: current.section,
      title,
      body,
      review: reviewOf(body),
    });
    current = null;
  };

  for (const line of lines) {
    const sec = SECTION_HEADER.exec(line);
    if (sec && !line.startsWith("###")) {
      finish();
      section = sectionOf(sec[1]);
      continue;
    }
    const head3 = ENTRY_HEADER.exec(line);
    if (head3) {
      finish();
      const id = head3[1].toUpperCase();
      if (seen.has(id)) {
        warnings.push(`${id} appears more than once; only the first is shown.`);
        continue;
      }
      if (entries.length >= MAX_ENTRIES) {
        warnings.push(`More than ${MAX_ENTRIES} entries; the rest are not shown.`);
        break;
      }
      seen.add(id);
      current = { id, meta: parseMeta(head3[2]), section, lines: [] };
      continue;
    }
    if (line.startsWith("###")) {
      finish();
      warnings.push(`Ignored a heading that is not a valid entry: ${line.slice(0, 80)}`);
      continue;
    }
    if (section === "checkpoints") {
      const cp = CHECKPOINT_LINE.exec(line);
      if (cp) checkpoints.push({ agent: cp[1], sha: cp[2] });
      continue;
    }
    if (current) current.lines.push(line);
  }
  finish();

  const byId = (a, b) => numeric(a.id) - numeric(b.id);
  const open = entries.filter((e) => e.status === "open");
  const decisions = open.filter((e) => e.kind === "decision").sort(byId);
  const tasks = open.filter((e) => e.kind === "task").sort(byId);
  const done = entries
    .filter((e) => e.status === "done")
    .sort((a, b) => (b.closed ?? "").localeCompare(a.closed ?? "") || numeric(b.id) - numeric(a.id));

  const cps = checkpoints.map((c) => ({
    ...c,
    stale: head ? !sameCommit(c.sha, head) : null,
  }));

  const result = {
    decisions,
    tasks,
    done,
    checkpoints: cps,
    counts: { decisions: decisions.length, tasks: tasks.length, done: done.length },
    warnings,
  };
  result.attention = attention(result, entries.length);
  return result;
}

// What a person should do next, in plain words, most urgent first.
function attention({ decisions, tasks, done }, total) {
  const out = [];
  if (total === 0) {
    out.push({ level: "action", text: "The ledger has no entries yet. Add your first task to .ledger/LEDGER.md (the format is at the top of that file).", ids: [] });
    return out;
  }
  if (decisions.length > 0) {
    out.push({
      level: "action",
      text: `${decisions.length} decision${decisions.length > 1 ? "s" : ""} waiting for an answer. Work that depends on ${decisions.length > 1 ? "them" : "it"} is blocked.`,
      ids: decisions.map((d) => d.id),
    });
  }
  const defects = [...tasks.filter((t) => /^defect\b/i.test(t.title)), ...done.filter((d) => d.review === "defect")];
  if (defects.length > 0) {
    out.push({ level: "action", text: `${defects.length} defect${defects.length > 1 ? "s" : ""} filed by a reviewer and not yet fixed.`, ids: defects.map((d) => d.id) });
  }
  const unreviewed = done.filter((d) => d.kind === "task" && d.review === null);
  if (unreviewed.length > 0) {
    const names = [...new Set(unreviewed.map((d) => d.to))].join(", ");
    out.push({
      level: "action",
      text: `${unreviewed.length} finished task${unreviewed.length > 1 ? "s have" : " has"} not been reviewed (done by ${names}). Start a reviewer session, or check the evidence yourself.`,
      ids: unreviewed.map((d) => d.id),
    });
  }
  const perAgent = new Map();
  for (const t of tasks) perAgent.set(t.to, (perAgent.get(t.to) ?? 0) + 1);
  for (const [agent, n] of perAgent) {
    out.push({
      level: "info",
      text: `${agent} has ${n} open task${n > 1 ? "s" : ""}. Open ${agent} in this repo and say "pick up any work waiting for you".`,
      ids: tasks.filter((t) => t.to === agent).map((t) => t.id),
    });
  }
  if (out.length === 0) out.push({ level: "info", text: "Nothing is waiting. All finished work has been reviewed.", ids: [] });
  return out;
}
