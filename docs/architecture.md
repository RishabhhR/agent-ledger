# Architecture

## The problem

Each AI coding tool is blind to the others. Without a shared place to coordinate you become the message bus: you paste results between windows, you re-explain context, and you can't tell whether two agents are about to edit the same files or whether "done" was ever checked.

## The shape

```
 you ──► task / decision ──► .ledger/LEDGER.md ◄── agents read and write it
                                   ▲
 CLAUDE.md ─┐                      │ rules
 AGENTS.md ─┼─► "read .ledger/PROTOCOL.md" ─► .ledger/PROTOCOL.md
 GEMINI.md ─┘
                      everything lives in git
```

Three layers, each replaceable:

1. **State**: `.ledger/LEDGER.md`. Decisions needed, open tasks, done tasks, per-agent checkpoints. Plain markdown, one heading per entry, so it is readable by people, greppable, and editable by any tool that can edit a file.
2. **Rules**: `.ledger/PROTOCOL.md`. One copy of how agents behave. It is the only place the protocol is written down.
3. **Pointers**: a few lines in each tool's own instruction file (`CLAUDE.md`, `AGENTS.md`, …) saying "read the protocol". They contain no rules, so they never drift out of sync.

## Design decisions, and why

**State is a file in git, not a service.** Every tool can read and write a file, and none needs to know the others exist. Git gives history, blame, review and sync for free, and the coordination survives you changing tools. The cost: no locking (see failure modes). `.ledger/validate.sh` provides a small, local structural check without turning the architecture into a service.

**One protocol, thin pointers.** Instruction files differ per tool and change over time. Keeping the rules in one place means adding a new tool is a single pointer, not a rewrite, and the rules can't contradict each other across tools.

**Claim before you code, in its own commit.** A written claim (what, which files, how it will be checked) is cheap, and committing it first makes it visible to other agents while the work is still in progress. It turns "two agents did the same thing" into a visible conflict you can resolve before code is written.

**Close with evidence, including what wasn't verified.** The most common failure with agents is a confident "done". Requiring the exact command, its output and an explicit "not verified" line turns a claim into something a reviewer can re-run, and makes honest gaps the normal case instead of an admission.

**The author is not the verifier.** A second agent re-runs the check and records `PASS:` or files a `DEFECT` task addressed to the author. The reviewer's output is findings, never fixes, so responsibility stays clear and nobody's code is silently rewritten. When it matters, make the verifier a different model or tool: an agent reviewing its own family's output tends to share its blind spots.

**Decisions are first-class and addressed.** A question that needs a human goes on the ledger, addressed to them, with options and a recommendation, and the blocked work stops. This replaces both silent guessing and silent waiting.

## Failure modes

| Failure | What happens | Mitigation in this kit |
|---|---|---|
| **Lost write** | Two agents save the ledger at the same instant; one entry is silently dropped. | One writer at a time; re-read after writing and confirm your entry is there. The validator catches the resulting duplicate/malformed structure, but cannot recover a lost entry. Scale-up option below. |
| **Protocol ignored** | Pointers are advice. An agent may skip the ledger or the evidence step. | You read the ledger; a reviewer re-runs checks; weak done notes are rejected as `DEFECT`s. |
| **Sandboxed tool can't commit** | Seen in the reference run: Codex couldn't write `.git`. | Protocol says report "not committed: sandbox" and leave changes for someone else to commit. |
| **Prompt injection through the ledger** | Ledger text is read as instructions by the next agent. | Protocol labels it trusted-input only; review ledger changes from anyone you don't trust. |
| **Same-model review** | Author and reviewer share blind spots. | Use a different model or tool as reviewer for risky work. |
| **Ledger bloat** | A long-lived ledger gets expensive to read. | Done entries can be archived to `.ledger/archive/` by a human or a housekeeping task; not automated here. |
| **Malformed coordination state** | A merge or manual edit leaves duplicate IDs, wrong sections, conflict markers, or broken pointer markers. | Run `.ledger/validate.sh`; the kit's installer also repairs malformed pointer markers. |

## Scaling up

- **More concurrency without lost writes:** replace the single file with one file per entry (`.ledger/tasks/TASK-007.md`, front-matter for status). Entries no longer collide and git merges cleanly, at the price of a harder overview (use `grep -l "status:open"`). Switch when two or more agents regularly work at once.
- **Parallel work:** give each agent its own git worktree and branch, and let the ledger live on the main branch. Not part of this kit.
- **Unattended operation:** see [automation.md](automation.md).
- **Seeing what is going on:** the optional [dashboard](../dashboard/README.md) renders the ledger in a browser through a read-only server on your own machine. It adds no new source of truth; the file stays the state.

## What this deliberately is not

It is not a sandbox, a permissions system, a scheduler, or a replacement for code review. It makes agent work *visible and checkable*; it does not make it correct. The validator checks syntax and structure, not implementation quality or the truth of an agent's evidence.
