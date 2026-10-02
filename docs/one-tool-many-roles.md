# Several agents inside one tool

The ledger doesn't care whether two agents are different products. An agent is just a **name** on the ledger. Two Claude Code sessions called `architect` and `builder` coordinate exactly as Claude and Codex would.

## How

1. Install the kit (`install.sh`), which includes role cards in `.ledger/roles/`: `architect`, `builder`, `reviewer`.
2. Start one session per role, handing each its card and, if you like, a different model:

```bash
claude --model opus   "Read .ledger/roles/architect.md and start."
claude --model sonnet "Read .ledger/roles/builder.md and start."
claude --model haiku  "Read .ledger/roles/reviewer.md and start."
```

3. Give the work to the architect. It writes tasks addressed `to:builder`; the builder implements and closes them with evidence; the reviewer verifies and files defects back to the builder. You answer decisions addressed to you.

The interactive form above is the standard way to start a session with a model and an opening message; the exercised path in this kit was the headless equivalent (`claude -p`, with a role card as the only instruction).

Each role card ends "Your agent name is `<role>`", which is what the session uses for `from:` and `to:`.

## Why bother with roles

- **Separation of duties.** The agent that wrote the code is not the one that signs it off.
- **Different strengths and costs.** Spend a larger model on design and review and a faster one on implementation, or the reverse; it is your call per project.
- **Focus.** A role card narrows what a session does, which keeps tasks small.

## Cautions

- **Same-model review is weaker.** Author and reviewer from the same model family tend to miss the same things. For risky changes, review with a different model or a different tool entirely.
- **A cheap reviewer is a choice, not a default.** It can be fine for a simple task and not for a subtle one; match the reviewer to the risk.
- **Roles are conventions.** Nothing stops a builder session from editing tests or the architect from writing feature code; the role card is guidance and the reviewer is the backstop.
- **Sequential is easiest.** Two sessions writing the ledger at the same instant can lose an entry. Start by running one role at a time. See [architecture.md](architecture.md#scaling-up).

## Adding your own role

Copy a card in `.ledger/roles/`, change what the agent is for, what its output is, and what it must not do, and end it with its name and a pointer to `PROTOCOL.md`. Roles worth considering: `security-reviewer`, `docs`, `release-manager`.
