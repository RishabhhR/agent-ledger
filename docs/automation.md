# From manual relay to an unattended loop

The kit works with you as the dispatcher: you open an agent, it reads the ledger and does its work. This page describes how to automate that step, and what to watch for. **No loop is shipped with this kit**; this is design guidance plus the two headless commands that were exercised.

## The two headless commands that were verified

```bash
# Claude Code: prompt on stdin, explicit tool allowlist, spending cap
echo "<prompt>" | claude -p --output-format json --model sonnet \
  --permission-mode acceptEdits --max-budget-usd 1 \
  --allowedTools Read Edit Write Glob Grep "Bash(git status:*)" "Bash(npm test:*)"

# Codex: prompt on stdin, workspace-write sandbox, last message to a file
echo "<prompt>" | codex exec --cd "$PWD" --sandbox workspace-write --color never -o last.txt -
```

(`codex` may not be on your `PATH`; some installs bundle it inside the desktop app.) Headless means nobody can answer a permission prompt, so anything not on the allowlist is denied. Widen it deliberately.

## The loop

```
repeat:
  read the ledger
  if a decision is addressed to a human  → pause and notify; resume when answered
  take the oldest open task addressed to an agent
  run that agent headlessly with: the task, "follow .ledger/PROTOCOL.md", the test command
  re-read the ledger: is the task now done?         ← the check
  commit the work
  if the author isn't the verifier → add a "VERIFY TASK-n" task for the reviewer
until nothing is open, or a step/attempt/budget limit is hit
```

## Lessons that shaped it

- **Check the ledger, not the exit code.** An agent can exit 0 without closing the task, or fail after closing it. The ledger is the record, so the loop trusts only the ledger.
- **Let the loop do the committing.** Sandboxed agents (Codex, above) can't write `.git`, and uncommitted work from several agents gets tangled. Tell agents not to commit; the loop commits each closed task as `TASK-n: <title>`, and refuses to start on a dirty tree so it doesn't commit your unrelated edits.
- **Cap everything.** Maximum steps, maximum attempts per task, a spending cap and a timeout per run. An unattended loop without limits is a bill waiting to happen.
- **Close the verification loop.** A failed review becomes a `DEFECT` task for the author, which the same loop picks up, so fixing needs no special case.
- **Pause for humans only on real decisions.** Anything addressed to a person stops the loop; everything else keeps going.
- **Run one agent at a time** until you have a plan for the shared-file write race.

## Before you automate

Run the manual version on a real task first. If an agent mishandles the protocol while you are watching, it will mishandle it faster while you are not.
