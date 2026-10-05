# Ledger

<!-- A made-up ledger for the dashboard's "Try with sample data" button. It follows the same format as a real one. -->

## Decisions needed

### [DEC-002] status:open from:builder to:human opened:2026-10-04
Should rate limits be per IP address or per API token?
Per-IP is simpler but unfair to people behind a shared network address. Per-token is fairer but needs the token store from TASK-003. I recommend per-token.

## Tasks

### [TASK-005] status:open from:architect to:builder opened:2026-10-04
Implement the limiter in src/limiter.ts against the interface in src/types.ts.
Acceptance: `npm test` passes, including the burst test.

### [TASK-006] status:open from:architect to:codex opened:2026-10-04
Write the migration that adds the rate_limits table.
Acceptance: it applies and rolls back cleanly on an empty database.

### [TASK-007] status:open from:reviewer to:builder opened:2026-10-04
DEFECT in TASK-003: the token store only ignores expired tokens when reading, so expired tokens still count toward the limit.
Reproduce: create a token, move the clock past its expiry, call limiter.check(); it should refuse but allows the request.

## Done

### [TASK-004] status:done from:architect to:codex opened:2026-10-03 closed:2026-10-04
Add a lint rule that bans console.log in src/.
Done: added the rule to the lint config. `npm run lint` printed 0 problems. Not reviewed yet.

### [TASK-003] status:done from:architect to:builder opened:2026-10-03 closed:2026-10-04
Add the token store in src/tokens.ts with create, lookup and expiry.
Done: implemented it with 12 tests. `npm test` printed 12 passed, 0 failed. Not verified: behaviour under concurrent writes.
DEFECT: the reviewer re-ran `npm test` (12 passed) but found a real bug in expiry handling and filed it as TASK-007.

### [DEC-001] status:done from:builder to:architect opened:2026-10-03 closed:2026-10-03
Should the token store use memory or Redis?
Answer: memory for now, behind an interface, so Redis can be added later.

### [TASK-002] status:done from:architect to:architect opened:2026-10-03 closed:2026-10-03
Define the limiter interface in src/types.ts: check(key), reset(key) and the config shape.
Done: wrote the types and a short design note. Not verified: nothing runs yet, this is a contract only.
PASS: the reviewer read the interface against the task and found it complete.

## Checkpoints

architect: a1b2c3d
builder: 9f8e7d6
reviewer: a1b2c3d
codex: 4c5d6e7
