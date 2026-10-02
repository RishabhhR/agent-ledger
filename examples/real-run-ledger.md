# A real run: human → Codex → Claude

This is the ledger exactly as it ended up after one real run on a toy task. The only setup was `install.sh`; there was no CLI and no automation.

1. A **human** added `TASK-001` addressed to `codex`.
2. **Codex** (headless, told only "pick up any work that is waiting for you") read `AGENTS.md`, then `.ledger/PROTOCOL.md`, did the task, ran the tests, and closed it. Its sandbox couldn't write `.git`, so a human committed its work, and its done note says so.
3. **Claude** (started with only "you have the role in `.ledger/roles/reviewer.md`") re-read the code, ran the tests itself, and recorded `PASS:` plus its checkpoint. Its commit touched only the ledger.

Two honest notes. Codex left the closed entry under `## Tasks` instead of moving it to `## Done`; the protocol wording was made more explicit afterwards. And this is one toy task, so it shows the mechanism works, not how it scales.

---

## Decisions needed

## Tasks

### [TASK-001] status:done from:human to:codex opened:2026-10-03 claimed:2026-10-03 closed:2026-10-03
Create src/slug.js exporting `slugify(text)`: lowercase, trim, replace each run of non-alphanumeric characters with a single "-", no leading or trailing "-". Add src/slug.test.js with node:test covering at least 4 cases. Check: `npm test` passes.
Done: added `src/slug.js` and four node:test cases in `src/slug.test.js`. Verified with `npm test` (4 passed, 0 failed). Not verified: Git commit, because `.git/index` is not writable in this workspace.
PASS: from:reviewer — re-read src/slug.js against the spec (lowercase, trim, collapse non-alphanumeric runs to one "-", no leading/trailing "-") and ran `npm test` myself: 4 passed, 0 failed, matching the done note. No defects found.

## Done

## Checkpoints

<!-- one line per agent: `name: <short git sha>` -->
codex: 04c9e58
reviewer: 08c532b
