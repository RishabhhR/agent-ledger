import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseLedger } from "../server/parse-ledger.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

test("the empty template yields no entries: its example header sits inside a comment", () => {
  const parsed = parseLedger(read("../../template/.ledger/LEDGER.md"));
  assert.equal(parsed.counts.tasks + parsed.counts.decisions + parsed.counts.done, 0);
  assert.match(parsed.attention[0].text, /no entries yet/);
});

test("the real Codex -> Claude ledger: status comes from the header, not the section", () => {
  // Codex left a finished task under "## Tasks"; it must still count as done.
  const parsed = parseLedger(read("../../examples/real-run-ledger.md"), { head: "08c532b" });
  assert.equal(parsed.counts.tasks, 0);
  assert.equal(parsed.done.length, 1);
  const task = parsed.done[0];
  assert.equal(task.id, "TASK-001");
  assert.equal(task.to, "codex");
  assert.equal(task.closed, "2026-10-03");
  assert.equal(task.review, "pass");
  assert.deepEqual(parsed.checkpoints.map((c) => [c.agent, c.sha, c.stale]), [["codex", "04c9e58", true], ["reviewer", "08c532b", false]]);
  assert.match(parsed.attention[0].text, /Nothing is waiting/);
});

const LEDGER = `# Ledger

## Decisions needed

### [DEC-001] status:open from:builder to:human opened:2026-10-03
Per-IP or per-token limits?

## Tasks

### [TASK-003] status:open from:architect to:builder opened:2026-10-03
Implement the limiter.
Second line.

### [TASK-002] status:open from:lead to:codex opened:2026-10-03
DEFECT in TASK-001: off by one.

## Done

### [TASK-001] status:done from:human to:codex opened:2026-10-02 closed:2026-10-02
Add the schema.
Done: ran npm test, 4 passed.

## Checkpoints

codex: abc1234
`;

test("groups open work, orders by id, and flags what a person must do", () => {
  const p = parseLedger(LEDGER, { head: "abc1234deadbeef" });
  assert.deepEqual(p.decisions.map((d) => d.id), ["DEC-001"]);
  assert.deepEqual(p.tasks.map((t) => t.id), ["TASK-002", "TASK-003"]);
  assert.equal(p.tasks[1].title, "Implement the limiter.");
  assert.match(p.tasks[1].body, /Second line\./);
  assert.equal(p.checkpoints[0].stale, false, "a short sha matches a longer head");
  const text = p.attention.map((a) => a.text).join("\n");
  assert.match(text, /1 decision waiting for an answer/);
  assert.match(text, /1 defect filed/);
  assert.match(text, /1 finished task has not been reviewed \(done by codex\)/);
  assert.match(text, /builder has 1 open task\. Open builder in this repo/);
  assert.equal(p.attention[0].level, "action");
});

test("never throws on junk, and reports what it skipped", () => {
  for (const junk of [undefined, null, 42, {}, "", "### [TASK-1\n", "## \n### \n###[TASK-9]", "\u0000\u0001", "x".repeat(50)]) {
    const p = parseLedger(junk);
    assert.ok(Array.isArray(p.tasks));
  }
  const p = parseLedger("## Tasks\n### broken heading\ntext\n### [TASK-001] status:open from:a to:b\nGood.\n");
  assert.equal(p.tasks.length, 1);
  assert.equal(p.tasks[0].title, "Good.");
  assert.match(p.warnings[0], /not a valid entry/);
});

test("a malformed heading cannot swallow the next real entry", () => {
  const p = parseLedger("## Tasks\n### [TASK-001] status:open from:a to:b\nOne.\n### nonsense\n### [TASK-002] status:open from:a to:b\nTwo.\n");
  assert.deepEqual(p.tasks.map((t) => t.id), ["TASK-001", "TASK-002"]);
  assert.equal(p.tasks[0].body, "One.");
});

test("an unterminated comment does not hide the rest of the file", () => {
  const p = parseLedger("<!-- oops\n## Tasks\n### [TASK-001] status:open from:a to:b\nStill here.\n");
  assert.equal(p.tasks.length, 1);
});

test("duplicate ids keep the first and warn; entries are capped", () => {
  const dup = parseLedger("## Tasks\n### [TASK-001] status:open from:a to:b\nFirst.\n### [TASK-001] status:open from:a to:b\nSecond.\n");
  assert.equal(dup.tasks.length, 1);
  assert.equal(dup.tasks[0].title, "First.");
  assert.match(dup.warnings[0], /TASK-001 appears more than once/);

  const many = parseLedger("## Tasks\n" + Array.from({ length: 600 }, (_, i) => `### [TASK-${i + 1}] status:open from:a to:b\nx\n`).join(""));
  assert.equal(many.tasks.length, 500);
  assert.ok(many.warnings.some((w) => /More than 500/.test(w)));
});

test("agent-authored markup is returned as inert text, never interpreted", () => {
  const evil = '<img src=x onerror="alert(1)"> <script>alert(2)</script>';
  const p = parseLedger(`## Tasks\n### [TASK-001] status:open from:a to:b\n${evil}\n`);
  assert.equal(p.tasks[0].title, evil, "kept verbatim as data; the renderer must use textContent");
});

test("review markers: PASS, FAIL and DEFECT are recognised wherever the line starts", () => {
  const p = parseLedger("## Done\n### [TASK-001] status:done from:a to:b\nDone.\n**PASS:** ran it.\n### [TASK-002] status:done from:a to:b\nDone.\nFAIL: broken.\n### [TASK-003] status:done from:a to:b\nDone.\n");
  assert.deepEqual(p.done.map((d) => [d.id, d.review]).sort(), [["TASK-001", "pass"], ["TASK-002", "defect"], ["TASK-003", null]]);
});

test("status aliases: resolved and closed count as done; unknown means open", () => {
  const p = parseLedger("## Decisions needed\n### [DEC-001] status:resolved from:a to:b\nQ\n### [DEC-002] status:weird from:a to:b\nQ2\n");
  assert.deepEqual(p.done.map((d) => d.id), ["DEC-001"]);
  assert.deepEqual(p.decisions.map((d) => d.id), ["DEC-002"]);
});

test("one defect is counted once even though a reviewer records it twice (on the finished task and as a DEFECT task)", () => {
  const p = parseLedger(`## Tasks
### [TASK-007] status:open from:reviewer to:builder opened:2026-10-04
DEFECT in TASK-003: expiry is only checked on read.

## Done
### [TASK-003] status:done from:architect to:builder opened:2026-10-03 closed:2026-10-04
Add the token store.
FAIL: found a bug, filed as TASK-007.
`);
  const defect = p.attention.find((a) => /defect/.test(a.text));
  assert.match(defect.text, /^1 defect filed/);
  assert.deepEqual(defect.ids, ["TASK-007"]);
  // Two genuinely different defects still count as two.
  const two = parseLedger("## Tasks\n### [TASK-008] status:open from:r to:b\nDEFECT in TASK-001: a.\n### [TASK-009] status:open from:r to:b\nDEFECT in TASK-002: b.\n");
  assert.match(two.attention.find((a) => /defect/.test(a.text)).text, /^2 defects filed/);
});
